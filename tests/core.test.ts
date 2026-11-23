/**
 * Testes unitários. Usam SOMENTE cenas de calibração/treino (C1, C2, train_00):
 * as tarefas de validação nunca são exercitadas antes do congelamento.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { allowedActions, initialState, step } from "../src/app/fsm.js";
import type { Scene } from "../src/app/types.js";
import { RulesAgent } from "../src/agent/rules.js";
import { ROOT, ValidationLockError, loadConfig, loadScene, loadTaskForController } from "../src/core/config.js";
import { runSession } from "../src/core/session.js";
import { Mechanisms } from "../src/mechanisms/mechanisms.js";
import { Rng, sampleParams } from "../src/sampler/sampler.js";
import { loadCriteria, readJsonl, verifyEvents } from "../src/verifier/verify.js";
import { detectBreakdowns } from "../src/analysis/mac.js";
import { forbiddenTerms, scanText } from "../src/cli/check-leak.js";

const scene = (id: string) => YAML.parse(readFileSync(path.join(ROOT, "scenes/calib", `${id}.yaml`), "utf8")) as Scene;
const { cfg, hash } = loadConfig();

describe("amostrador", () => {
  it("é determinístico por semente", () => {
    const a = sampleParams(new Rng(42), cfg.distributions);
    const b = sampleParams(new Rng(42), cfg.distributions);
    expect(a).toEqual(b);
    expect(sampleParams(new Rng(43), cfg.distributions)).not.toEqual(a);
  });
  it("Beta(3,7) tem média ≈ 0,3", () => {
    const r = new Rng(1);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += r.beta(3, 7);
    expect(s / 20000).toBeCloseTo(0.3, 1);
  });
  it("respeita os domínios declarados", () => {
    for (let i = 0; i < 200; i++) {
      const p = sampleParams(new Rng(i), cfg.distributions);
      expect([3, 4, 5]).toContain(p.buffer_k);
      expect(p.theta).toBeGreaterThanOrEqual(0.6);
      expect(p.theta).toBeLessThanOrEqual(0.8);
      expect(p.q_accept).toBeLessThanOrEqual(0.2);
      expect([1, 2]).toContain(p.r_verif);
    }
  });
});

describe("FSM MoLIC", () => {
  it("método KLM de C1 termina com a caneca azul confirmada", () => {
    const sc = scene("kitchen_01");
    let s = initialState(sc);
    for (const a of ["ativar", "mirar_direita", "mirar_direita", "capturar", "confirmar"]) s = step(s, sc, a).state;
    expect(s.ended).toBe("confirmed");
    expect(s.confirmed).toBe("mug_blue");
  });
  it("método KLM de C2 termina com a dipirona confirmada", () => {
    const sc = scene("meds_01");
    let s = initialState(sc);
    for (const a of ["ativar", "capturar", "mais_detalhes", "voltar", "nova_captura", "pegar_proxima", "capturar", "mais_detalhes", "confirmar"])
      s = step(s, sc, a).state;
    expect(s.confirmed).toBe("box_dipirona");
  });
  it("as falas u: do FSM estão todas declaradas em design/molic.yaml", () => {
    const molic = YAML.parse(readFileSync(path.join(ROOT, "design/molic.yaml"), "utf8")).scenes;
    const sc = scene("kitchen_01");
    let s = initialState(sc);
    const check = () => {
      const declared = Object.keys(molic[s.screen].u);
      for (const a of allowedActions(s, sc, { serial: true })) expect(declared).toContain(a);
    };
    check();
    s = step(s, sc, "ativar").state;
    check();
    s = step(s, sc, "afastar").state;
    s = step(s, sc, "capturar").state;
    check();
    s = step(s, sc, "mais_detalhes").state;
    check();
  });
  it("captura com quadro deslocado (AimNoise) muda os objetos reconhecidos", () => {
    const sc = scene("kitchen_01");
    let s = step(initialState(sc), sc, "ativar").state;
    const ok = step(s, sc, "capturar").state;
    const shifted = step(s, sc, "capturar", { captureShift: 1 }).state;
    expect(ok.frame).toEqual(["thermos"]);
    expect(shifted.frame).toEqual(["sugar_jar"]);
  });
  it("lança erro para fala fora do espaço de ações", () => {
    const sc = scene("kitchen_01");
    expect(() => step(initialState(sc), sc, "capturar")).toThrow();
  });
});

describe("mecanismos", () => {
  const p = { ...sampleParams(new Rng(1), cfg.distributions), theta: 0.7, r_verif: 1, q_accept: 0, buffer_k: 2 };
  it("TrustGate remove Confirmar quando c < θ sem verificação", () => {
    const sc = scene("meds_01");
    let s = initialState(sc);
    s = step(s, sc, "ativar").state;
    s = step(s, sc, "capturar").state; // c = 0,55
    const m = new Mechanisms(new Set(["TrustGate"]), p, new Rng(1));
    const acts = m.filterActions(allowedActions(s, sc, { serial: true }), s, m.init(), []);
    expect(acts).not.toContain("confirmar");
    s = step(s, sc, "mais_detalhes").state; // 1 verificação
    expect(m.filterActions(allowedActions(s, sc, { serial: true }), s, m.init(), [])).toContain("confirmar");
  });
  it("AudioBuffer retém só os últimos k itens do anúncio", () => {
    const m = new Mechanisms(new Set(["AudioBuffer"]), p, new Rng(1));
    const t = "3 objetos reconhecidos: a, 90 por cento; b, 80 por cento; c, 70 por cento.";
    expect(m.bufferAnnouncement(t, false, [])).toBe("3 objetos reconhecidos: … b, 80 por cento; c, 70 por cento.");
    expect(m.bufferAnnouncement(t, true, [])).toBe(t);
  });
  it("mecanismo desligado não altera nada (agente de comparação)", () => {
    const m = new Mechanisms(new Set(), p, new Rng(1));
    expect(m.perturb("capturar", initialState(scene("kitchen_01")), scene("kitchen_01"), m.init(), [])).toEqual({});
  });
});

describe("trava de validação", () => {
  it("bloqueia cenas de validação sem --validation", () => {
    expect(() => loadScene("sofa_01", { allowValidation: false, configHash: hash })).toThrow(ValidationLockError);
    expect(() => loadScene("cans_01", { allowValidation: false, configHash: hash })).toThrow(ValidationLockError);
  });
  it("controlador não recebe o critério de sucesso", () => {
    expect(Object.keys(loadTaskForController("C1"))).not.toContain("success");
  });
});

describe("sessão + verificador externo + MAC", () => {
  it("executa C1 (perfil, regras), registra eventos e o verificador decide pelo estado", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "uxagent-"));
    const task = loadTaskForController("C1");
    const s = await runSession({ cfg, configHash: hash, task, scene: scene("kitchen_01"), condition: "perfil", agent: new RulesAgent("caneca azul"), seed: 7, outDir: out, maxActions: 15 });
    const ev = readJsonl(s.events_file);
    expect(ev[0].event_type).toBe("task_start");
    expect(ev.at(-1)!.event_type).toBe("task_end");
    for (const e of ev) {
      expect(e.synthetic).toBe(true);
      expect(e.config_hash).toBe(hash);
    }
    const v = verifyEvents(ev, loadCriteria());
    expect(["success", "wrong_object", "give_up", "interrupted"]).toContain(v.verdict);
    // nenhum prompt contém instrumentos do analista
    const terms = forbiddenTerms();
    for (const p of readJsonl(s.prompts_file)) expect(scanText(p.system + p.user, terms)).toEqual([]);
  });
  it("verificador: objeto errado, desistência e sessão incompleta", () => {
    const crit = loadCriteria();
    const base = { run_id: "x", task_id: "C1", condition: "perfil", agent: "llm", seed: 1 };
    const mk = (state: object) => [{ ...base, event_type: "task_start" }, { ...base, event_type: "task_end", state_after: state }];
    expect(verifyEvents(mk({ ended: "confirmed", confirmed: "mug_blue" }), crit).verdict).toBe("success");
    expect(verifyEvents(mk({ ended: "confirmed", confirmed: "cup_white" }), crit).verdict).toBe("wrong_object");
    expect(verifyEvents(mk({ ended: "give_up", confirmed: null }), crit).verdict).toBe("give_up");
    expect(verifyEvents([{ ...base, event_type: "task_start" }], crit).verdict).toBe("unknown");
  });
  it("MAC: 'Para mim está bom' e 'E agora?' por assinatura no log", () => {
    const sb = { result: [{ id: "cup_white", label: "caneca branca", conf: 0.88 }], result_focus: 0, verifications: {} };
    const ev = [
      { origin: "agent", step: 1, event_type: "support", support: "repeat", executed_action: "repetir" },
      { origin: "agent", step: 2, event_type: "support", support: "repeat", executed_action: "repetir" },
      { origin: "agent", step: 3, event_type: "confirm", executed_action: "confirmar", state_before: sb, state_after: { confirmed: "cup_white" } },
    ];
    const tags = detectBreakdowns(ev, "mug_blue").map((b) => b.tag);
    expect(tags).toContain("E agora?");
    expect(tags).toContain("Para mim está bom");
  });
});

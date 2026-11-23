/**
 * Interface web da aplicação instrumentada (E5 — demonstração; também permite uma
 * pessoa operar o MESMO app e gerar o MESMO esquema de log, com origin="human").
 *   npm run web   → http://localhost:5173
 * Modo "assistir agente": roda uma sessão (regras ou LLM) e transmite os eventos ao vivo (SSE).
 */
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { INICIO_CONTROLS, LAUNCHER_APPS, allowedActions, initialState, step } from "../app/fsm.js";
import type { AppState, Scene } from "../app/types.js";
import { ClaudeAgent } from "../agent/llm.js";
import { OllamaAgent } from "../agent/ollama.js";
import { RulesAgent } from "../agent/rules.js";
import { ROOT, baselineActions, loadConfig, loadScene, loadTaskForController } from "../core/config.js";
import { runSession, snapshot } from "../core/session.js";
import { RunLogger } from "../logger/logger.js";
import { Mechanisms } from "../mechanisms/mechanisms.js";
import { SCREEN_TITLES, actionLabel, translate } from "../observation/translator.js";
import { Rng, sampleParams } from "../sampler/sampler.js";
import { verifyEvents, loadCriteria, readJsonl } from "../verifier/verify.js";

if (existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
const { cfg, hash } = loadConfig();
const app = express();
app.use(express.json());

// ---- sessão humana (mesmo FSM, mesmo logger) ----
interface HumanSession {
  scene: Scene;
  state: AppState;
  log: RunLogger;
  step: number;
  base: Record<string, unknown>;
}
const human = new Map<string, HumanSession>();
const RULE_KEYWORDS: Record<string, string> = { C1: "caneca azul", C2: "dipirona" };

/** Dica "o que fazer agora" do modo humano (só na interface web; nunca vai ao agente). */
function hint(st: AppState, scene: Scene): string {
  switch (st.screen) {
    case "launcher":
      return "Você está na tela inicial do celular. Use “Deslizar para a direita” até o foco chegar em “Reconhecer objetos” e então “Tocar duas vezes no item em foco” para abrir o app.";
    case "inicio":
      return st.focus === 0
        ? "O foco está no botão “Reconhecer objeto”. Clique em “Tocar duas vezes no item em foco” para abrir a câmera."
        : "O foco está em “Ajuda”. Use “Deslizar para a esquerda” para voltar ao botão “Reconhecer objeto” (ou toque duas vezes para ler a ajuda).";
    case "camera":
      return scene.mode === "table"
        ? "Câmera aberta. Mova o celular para a esquerda/direita até ele apontar para o objeto pedido (veja a mesa acima) e clique em “Botão Capturar”."
        : "Câmera aberta. Use “Pegar o próximo objeto” até segurar o objeto certo e clique em “Botão Capturar”.";
    case "resultado":
      return st.result.length === 0
        ? "O app não reconheceu nada. Clique em “Nova captura” e mire melhor."
        : `O app reconheceu ${st.result.length} objeto(s) (lista no celular acima). O item em foco agora é “${st.result[st.resultFocus]?.label ?? "?"}”. ` +
          (st.result.length > 1 ? "Use “Deslizar” para mudar o foco. " : "") +
          "Se o item em foco for o objeto pedido, clique em “Botão Confirmar objeto”. Se não for, use “Botão Nova captura” e mire em outro lugar.";
    case "detalhes":
      return "Detalhes do objeto em foco. Se for o objeto pedido, clique em “Confirmar”; senão, “Voltar”.";
    case "ajuda":
      return "Escolha um tópico de ajuda para ouvir, ou “Voltar”.";
    default:
      return "";
  }
}

function view(h: HumanSession) {
  const mech = new Mechanisms(new Set(), sampleParams(new Rng(0), cfg.distributions), new Rng(0));
  const acts = allowedActions(h.state, h.scene, { serial: true });
  return {
    observation: translate(h.state, h.scene, "full_visual", mech, [], []),
    actions: acts.map((id) => ({ id, label: actionLabel(id, h.state) })),
    ended: h.state.ended,
    // dados extras só para desenhar o "celular" no modo humano
    ui: {
      screen: h.state.screen,
      title: SCREEN_TITLES[h.state.screen],
      announcement: h.state.announcement,
      hint: hint(h.state, h.scene),
      controls: h.state.screen === "launcher" ? LAUNCHER_APPS : h.state.screen === "inicio" ? INICIO_CONTROLS : [],
      focus: h.state.focus,
      table: h.scene.mode === "table" && h.state.screen === "camera" ? { aim: h.state.aim, zoom: h.state.zoom, objects: h.scene.objects.map((o) => ({ label: o.label, pos: (o as { pos?: number }).pos ?? 0 })) } : null,
      result: h.state.screen === "resultado" ? h.state.result.map((d) => `${d.label} (${Math.round(d.conf * 100)}%)`) : [],
      resultFocus: h.state.resultFocus,
    },
  };
}

app.post("/api/human/start", (req, res) => {
  const taskId = String(req.body.task ?? "C1");
  const task = loadTaskForController(taskId);
  const scene = loadScene(task.scene, { allowValidation: false, configHash: hash });
  const id = `${taskId}_human_${Date.now()}`;
  const log = new RunLogger(path.join(ROOT, "runs/human"), id);
  const base = { run_id: id, session_id: id, persona_id: "participante", task_id: taskId, condition: "humano", agent: "human", seed: 0, config_hash: hash, versions: { interface: "app-sim-1.0.0" }, synthetic: false };
  const h: HumanSession = { scene, state: initialState(scene), log, step: 0, base };
  human.set(id, h);
  log.event({ ...(base as any), t_sim_s: 0, step: 0, event_type: "task_start", origin: "controller", result: "pending", state_after: snapshot(h.state), event_data: { instruction: task.instruction } });
  res.json({ id, instruction: task.instruction, ...view(h) });
});

app.post("/api/human/act", (req, res) => {
  const h = human.get(String(req.body.id));
  if (!h) return void res.status(404).json({ error: "sessão inexistente" });
  const action = String(req.body.action);
  const acts = allowedActions(h.state, h.scene, { serial: true });
  if (!acts.includes(action)) return void res.status(400).json({ error: "ação não permitida" });
  const before = snapshot(h.state);
  const r = step(h.state, h.scene, action);
  h.step++;
  h.log.event({ ...(h.base as any), t_sim_s: 0, step: h.step, event_type: r.event_type, origin: "human", scene_before: before.screen, scene_after: r.state.screen, executed_action: action, u: actionLabel(action, h.state), d: r.d, result: "ok", support: r.support, state_before: before, state_after: snapshot(r.state) });
  h.state = r.state;
  if (h.state.ended) {
    h.log.event({ ...(h.base as any), t_sim_s: 0, step: h.step, event_type: "task_end", origin: "controller", result: "pending", state_after: snapshot(h.state) });
    const v = verifyEvents(readJsonl(h.log.eventsFile), loadCriteria());
    return void res.json({ ...view(h), verdict: v.verdict });
  }
  res.json(view(h));
});

// ---- assistir uma execução do agente ao vivo ----
app.get("/api/agent/run", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  const taskId = String(req.query.task ?? "C1");
  const condition = String(req.query.condition ?? "perfil");
  const kind = String(req.query.agent ?? "rules");
  const seed = Number(req.query.seed ?? 1000);
  const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    if (kind === "llm" && !process.env.ANTHROPIC_API_KEY) throw new Error("defina ANTHROPIC_API_KEY no .env para usar o LLM");
    const task = loadTaskForController(taskId);
    const scene = loadScene(task.scene, { allowValidation: false, configHash: hash });
    if (kind === "ollama") await new OllamaAgent(cfg.ollama).check();
    const agent = kind === "llm" ? new ClaudeAgent(cfg.llm) : kind === "ollama" ? new OllamaAgent(cfg.ollama) : new RulesAgent(RULE_KEYWORDS[taskId]);
    const outDir = path.join(ROOT, "runs/demo");
    const maxActions = Math.min(cfg.limits.max_actions, cfg.limits.baseline_multiplier * baselineActions(taskId));
    send("task", { instruction: task.instruction, condition, agent: kind, seed });
    const s = await runSession({ cfg, configHash: hash, task, scene, condition, agent, seed, outDir, maxActions, onEvent: (e) => send("log", e), onPrompt: (p) => send("prompt", p) });
    // prompts enviados (para mostrar o que o agente "vê")
    const prompts = readFileSync(s.prompts_file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    send("prompts", prompts.map((p) => ({ step: p.step, user: p.user, response: p.response_raw })));
    const v = verifyEvents(readJsonl(s.events_file), loadCriteria());
    send("verdict", v);
  } catch (e) {
    send("error", { message: (e as Error).message });
  }
  res.end();
});

app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "src/web/index.html")));
const port = Number(process.env.PORT ?? 5173);
app.listen(port, () => console.log(`UX-Agent web em http://localhost:${port}`));

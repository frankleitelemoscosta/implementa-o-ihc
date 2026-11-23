/**
 * Mecanismos parametrizados FORA do prompt (Atividade 2.2; Modelagem Seç. VI, Tab. VIII).
 * Cada mecanismo tem chave liga-desliga (config.yaml → conditions.<c>.mechanisms) e
 * parâmetros sorteados por execução (PersonaParams). Eles atuam em três pontos do ciclo:
 *   (a) filtros de affordance sobre a lista de falas u: (ExpertShortcuts, TrustGate);
 *   (b) transformação da observação o_t (SerialChannel, AudioBuffer);
 *   (c) perturbação da execução da ação (AimNoise, Slip) e regras de parada (AttemptLimit),
 *       mais o tempo simulado (Hesitation).
 * O LLM nunca vê parâmetros, nomes de mecanismos nem o efeito "por trás" — só o resultado.
 */
import type { AppState, Perturbation, Scene } from "../app/types.js";
import type { PersonaParams, Rng } from "../sampler/sampler.js";

export const ALL_MECHANISMS = [
  "SerialChannel",
  "AudioBuffer",
  "AimNoise",
  "TrustGate",
  "ExpertShortcuts",
  "TactileCheck",
  "Slip",
  "Hesitation",
  "AttemptLimit",
] as const;
export type MechanismName = (typeof ALL_MECHANISMS)[number];

export interface MechanismTrace {
  mechanism: MechanismName;
  effect: string;
}

/** Estado interno dos mecanismos ao longo de uma execução (não observável pelo agente). */
export interface MechState {
  p_enq_current: number;
  /** ação anterior — usada pelo KLM/Hesitation */
  lastAction: string | null;
  /** atalhos disponíveis neste passo (sorteio ExpertShortcuts) */
  shortcutsNow: boolean;
  /** TrustGate: aceitação sem verificação já sorteada para o objeto em foco */
  gateBypass: Record<string, boolean>;
}

export class Mechanisms {
  constructor(
    private on: Set<MechanismName>,
    private p: PersonaParams,
    private rng: Rng,
  ) {}

  has(m: MechanismName): boolean {
    return this.on.has(m);
  }

  init(): MechState {
    return { p_enq_current: this.p.p_enq, lastAction: null, shortcutsNow: false, gateBypass: {} };
  }

  /** (a) Filtros de affordance aplicados à lista base de falas u: da MoLIC. */
  filterActions(base: string[], s: AppState, ms: MechState, trace: MechanismTrace[]): string[] {
    let acts = [...base];

    // L5 ExpertShortcuts: atalho de uma ação, disponível com probabilidade p_at a cada passo.
    if (this.has("ExpertShortcuts") && (s.screen === "inicio" || s.screen === "launcher")) {
      ms.shortcutsNow = this.rng.bernoulli(this.p.p_at);
      if (ms.shortcutsNow) {
        const sc = s.screen === "inicio" ? "atalho_camera" : "atalho_app";
        acts.splice(acts.length - 1, 0, sc);
        trace.push({ mechanism: "ExpertShortcuts", effect: `${sc} disponível` });
      }
    }

    // L4 TrustGate: se c < θ e verificações < r, Confirmar some da lista
    // (salvo aceitação sem verificação, sorteada uma vez por objeto com prob. q).
    if (this.has("TrustGate") && (s.screen === "resultado" || s.screen === "detalhes") && s.result.length) {
      const d = s.result[s.resultFocus];
      const verified = s.verifications[d.id] ?? 0;
      if (d.conf < this.p.theta && verified < this.p.r_verif) {
        if (!(d.id in ms.gateBypass)) ms.gateBypass[d.id] = this.rng.bernoulli(this.p.q_accept);
        if (ms.gateBypass[d.id]) {
          trace.push({ mechanism: "TrustGate", effect: "aceitação sem verificação (sorteio q)" });
        } else {
          acts = acts.filter((a) => a !== "confirmar" && !a.startsWith("confirmar:"));
          trace.push({ mechanism: "TrustGate", effect: `Confirmar bloqueado (c=${d.conf} < θ, verificações ${verified}/${this.p.r_verif})` });
        }
      }
    }
    return acts;
  }

  /** (b) L2 AudioBuffer: de um anúncio com lista, a persona retém só os últimos k itens. */
  bufferAnnouncement(text: string, fresh: boolean, trace: MechanismTrace[]): string {
    if (!this.has("AudioBuffer") || fresh) return text;
    const m = text.match(/^(.*?reconhecidos?): (.*)\.$/);
    if (!m) return text;
    const items = m[2].split("; ");
    if (items.length <= this.p.buffer_k) return text;
    trace.push({ mechanism: "AudioBuffer", effect: `retidos ${this.p.buffer_k} de ${items.length} itens` });
    return `${m[1]}: … ${items.slice(-this.p.buffer_k).join("; ")}.`;
  }

  /** (c) Perturbações da execução: AimNoise e Slip. Atualiza p_enq após Aproximar/Tato (ρ). */
  perturb(action: string, s: AppState, scene: Scene, ms: MechState, trace: MechanismTrace[]): Perturbation {
    const pert: Perturbation = {};
    if (this.has("Slip") && ["proximo", "anterior", "mirar_esquerda", "mirar_direita"].includes(action)) {
      if (this.rng.bernoulli(this.p.p_slip)) {
        pert.overshoot = true;
        trace.push({ mechanism: "Slip", effect: "gesto passou do alvo (deslize)" });
      }
    }
    if (this.has("AimNoise")) {
      if (action === "capturar" && this.rng.bernoulli(ms.p_enq_current)) {
        if (scene.mode === "table") pert.captureShift = this.rng.bernoulli(0.5) ? 1 : -1;
        else pert.captureMiss = true;
        trace.push({ mechanism: "AimNoise", effect: `quadro deslocado (p_enq=${ms.p_enq_current.toFixed(2)})` });
      }
      const tactileOn = this.has("TactileCheck");
      if (action === "aproximar" || (action === "tato" && tactileOn)) {
        ms.p_enq_current *= this.p.rho;
        trace.push({ mechanism: action === "tato" ? "TactileCheck" : "AimNoise", effect: `p_enq reduzido por ρ → ${ms.p_enq_current.toFixed(2)}` });
      }
      if (["mirar_esquerda", "mirar_direita", "pegar_proxima", "afastar"].includes(action)) ms.p_enq_current = this.p.p_enq;
    }
    return pert;
  }

  /** Hesitation: tempo comportamental simulado = tempo KLM do passo × LogNormal(σ). */
  hesitate(klmSeconds: number, trace: MechanismTrace[]): number {
    if (!this.has("Hesitation")) return klmSeconds;
    const f = this.rng.lognormal(this.p.hesitation_sigma);
    trace.push({ mechanism: "Hesitation", effect: `fator ${f.toFixed(2)}` });
    return klmSeconds * f;
  }

  /** AttemptLimit: após `capture_limit` capturas, a persona desiste (decidido pelo controlador). */
  attemptLimitReached(s: AppState): boolean {
    return this.has("AttemptLimit") && s.captures >= this.p.capture_limit && s.screen !== "resultado" && s.screen !== "detalhes";
  }
}

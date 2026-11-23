/**
 * Controlador de uma execução (sessão) do UX-Agent — ciclo mínimo da Modelagem (Seç. VI):
 *  (i)   a interface expõe estado e falas u: válidas (MoLIC);
 *  (ii)  os mecanismos filtram as falas (affordance) e transformam a observação;
 *  (iii) o agente escolhe UMA fala u: da lista;
 *  (iv)  o controlador valida a fala e aplica perturbações (AimNoise, Slip);
 *  (v)   a interface executa e responde com a fala d:; o registrador grava o evento;
 *  (vi)  ao fim, o estado final é entregue ao verificador EXTERNO (processo separado).
 * O controlador não conhece o critério de sucesso nem o alvo da tarefa.
 */
import { allowedActions, initialState, step } from "../app/fsm.js";
import type { AppState, Scene } from "../app/types.js";
import type { Agent } from "../agent/agent.js";
import { systemPrompt, userPrompt, responseSchema } from "../agent/prompt.js";
import { RunLogger } from "../logger/logger.js";
import { Mechanisms, type MechanismName, type MechanismTrace } from "../mechanisms/mechanisms.js";
import { actionLabel, translate, type HistoryEntry } from "../observation/translator.js";
import { Rng, sampleParams, type PersonaParams } from "../sampler/sampler.js";
import { INTERFACE_VERSION, MECHANISMS_VERSION, type Config, type TaskForController } from "./config.js";
import { stepSeconds } from "./klm.js";

export interface SessionOptions {
  cfg: Config;
  configHash: string;
  task: TaskForController;
  scene: Scene;
  condition: string;
  agent: Agent;
  seed: number;
  outDir: string;
  maxActions: number;
  onEvent?: (e: unknown) => void;
  /** chamado a cada passo: antes da resposta (response = null) e depois dela (só para a interface web) */
  onPrompt?: (p: { step: number; user: string; response: string | null }) => void;
}

export interface SessionSummary {
  run_id: string;
  task_id: string;
  condition: string;
  agent: string;
  seed: number;
  end_reason: string;
  confirmed: string | null;
  actions: number;
  rejected: number;
  events_file: string;
  prompts_file: string;
  params: PersonaParams;
}

export function snapshot(s: AppState) {
  return {
    screen: s.screen,
    focus: s.focus,
    aim: s.aim,
    zoom: s.zoom,
    held: s.held,
    frame: s.frame,
    result: s.result,
    result_focus: s.resultFocus,
    captures: s.captures,
    verifications: s.verifications,
    confirmed: s.confirmed,
    ended: s.ended,
  };
}

export async function runSession(o: SessionOptions): Promise<SessionSummary> {
  const { cfg, task, scene, condition, agent, seed } = o;
  const cond = cfg.conditions[condition];
  if (!cond) throw new Error(`condição desconhecida: ${condition}`);
  const rng = new Rng(seed);
  const params = sampleParams(rng, cfg.distributions); // sorteado sempre (mesma semente → mesmo θ em todas as condições)
  const mech = new Mechanisms(new Set<MechanismName>(cond.mechanisms), params, rng);
  const ms = mech.init();

  const runId = `${task.id}_${condition}_${agent.kind}_s${seed}`;
  const log = new RunLogger(o.outDir, runId);
  const versions = {
    llm: agent.model,
    agent: agent.kind,
    interface: INTERFACE_VERSION,
    mechanisms: MECHANISMS_VERSION,
    config_hash: o.configHash,
  };
  const base = {
    run_id: runId,
    session_id: runId,
    persona_id: cfg.persona_id,
    task_id: task.id,
    condition,
    agent: agent.kind,
    seed,
    config_hash: o.configHash,
    versions,
    synthetic: true,
  };
  const emit = (e: Parameters<RunLogger["event"]>[0]) => {
    const rec = log.event(e);
    o.onEvent?.(rec);
    return rec;
  };

  let state = initialState(scene);
  let tSim = 0;
  let executed = 0;
  let rejected = 0;
  let consecutiveRejected = 0;
  const history: HistoryEntry[] = [];
  const sys = systemPrompt(cond.persona_sheet, task.instruction);

  emit({
    ...base,
    t_sim_s: 0,
    step: 0,
    event_type: "task_start",
    origin: "controller",
    result: "pending",
    state_after: snapshot(state),
    event_data: { instruction: task.instruction, scene: scene.id, observation: cond.observation, persona_sheet: cond.persona_sheet, mechanisms: cond.mechanisms, params, max_actions: o.maxActions },
  });
  emit({ ...base, t_sim_s: 0, step: 0, event_type: "announce", origin: "system", d: state.announcement, result: "ok", scene_after: state.screen });

  let stepNo = 0;
  while (!state.ended) {
    if (executed >= o.maxActions) {
      state = { ...state, ended: "interrupted" };
      emit({ ...base, t_sim_s: tSim, step: stepNo, event_type: "interrupted", origin: "controller", result: "interrupted", event_data: { reason: `limite de ${o.maxActions} ações` } });
      break;
    }
    if (mech.attemptLimitReached(state)) {
      state = { ...state, ended: "give_up", screen: "encerramento" };
      emit({
        ...base,
        t_sim_s: tSim,
        step: stepNo,
        event_type: "give_up",
        origin: "controller",
        result: "give_up",
        error_category: "desistencia",
        mechanisms_applied: [{ mechanism: "AttemptLimit", effect: `limite de ${params.capture_limit} capturas atingido` }],
      });
      break;
    }

    stepNo++;
    const trace: MechanismTrace[] = [];
    const baseActs = allowedActions(state, scene, { serial: mech.has("SerialChannel") });
    const acts = mech.filterActions(baseActs, state, ms, trace);
    const options = acts.map((id) => ({ id, label: actionLabel(id, state) }));
    const obs = translate(state, scene, cond.observation, mech, history.slice(-cfg.llm.history_window), trace);
    const usr = userPrompt(stepNo, obs, options);

    o.onPrompt?.({ step: stepNo, user: usr, response: null });
    const choice = await o.agent.choose({ system: sys, user: usr, actions: options, ruleView: agent.kind === "rules" ? { state, scene } : undefined });
    log.prompt({
      step: stepNo,
      model: agent.model,
      system: sys,
      user: usr,
      output_schema: responseSchema(acts),
      response_raw: choice.raw,
      stop_reason: choice.stop_reason ?? null,
      usage: choice.usage ?? null,
      latency_ms: choice.latency_ms,
      format_retries: choice.format_retries,
    });
    o.onPrompt?.({ step: stepNo, user: usr, response: choice.raw });

    if (choice.tech_failure || !choice.action) {
      emit({ ...base, t_sim_s: tSim, step: stepNo, event_type: "tech_failure", origin: "controller", result: "tech_failure", latency_ms: choice.latency_ms, scene_before: state.screen, event_data: { reason: choice.tech_failure } });
      state = { ...state, ended: "tech_failure" };
      break;
    }
    if (!acts.includes(choice.action)) {
      rejected++;
      consecutiveRejected++;
      emit({ ...base, t_sim_s: tSim, step: stepNo, event_type: "rejected_action", origin: "controller", proposed_action: choice.action, executed_action: null, rejected_reason: "fala u: fora das ações permitidas no estado", result: "error", scene_before: state.screen, latency_ms: choice.latency_ms, mechanisms_applied: trace });
      if (consecutiveRejected >= 3) {
        emit({ ...base, t_sim_s: tSim, step: stepNo, event_type: "tech_failure", origin: "controller", result: "tech_failure", event_data: { reason: "3 propostas rejeitadas seguidas" } });
        state = { ...state, ended: "tech_failure" };
      }
      continue;
    }
    consecutiveRejected = 0;

    const action = choice.action;
    const before = snapshot(state);
    const pert = mech.perturb(action, state, scene, ms, trace);
    const res = step(state, scene, action, pert);
    const k = stepSeconds(action, ms.lastAction, res.d, cfg.klm);
    tSim += mech.hesitate(k.seconds, trace);
    ms.lastAction = action;
    executed++;

    const slipped = trace.some((t) => t.mechanism === "Slip");
    emit({
      ...base,
      t_sim_s: Math.round(tSim * 100) / 100,
      step: stepNo,
      event_type: res.event_type,
      origin: "agent",
      scene_before: before.screen,
      scene_after: res.state.screen,
      proposed_action: action,
      executed_action: action,
      u: actionLabel(action, state),
      d: res.d,
      result: res.event_type === "give_up" ? "give_up" : "ok",
      support: res.support,
      error_category: res.event_type === "give_up" ? "desistencia" : slipped ? "deslize" : undefined,
      mechanisms_applied: trace,
      klm_ops: k.ops,
      latency_ms: choice.latency_ms,
      state_before: before,
      state_after: snapshot(res.state),
    });
    history.push({ action: actionLabel(action, state), heard: res.d });
    state = res.state;
  }

  emit({
    ...base,
    t_sim_s: Math.round(tSim * 100) / 100,
    step: stepNo,
    event_type: "task_end",
    origin: "controller",
    result: "pending", // o resultado (sucesso/erro) é decidido pelo verificador externo
    state_after: snapshot(state),
    event_data: { end_reason: state.ended, actions: executed, rejected },
  });

  return {
    run_id: runId,
    task_id: task.id,
    condition,
    agent: agent.kind,
    seed,
    end_reason: state.ended ?? "unknown",
    confirmed: state.confirmed,
    actions: executed,
    rejected,
    events_file: log.eventsFile,
    prompts_file: log.promptsFile,
    params,
  };
}

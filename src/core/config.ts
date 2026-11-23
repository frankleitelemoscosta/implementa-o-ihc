/** Carregamento de config.yaml, cenas e instruções, com trava das tarefas de validação. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Scene } from "../app/types.js";
import type { LlmSettings } from "../agent/llm.js";
import type { OllamaSettings } from "../agent/ollama.js";
import type { KlmOps } from "./klm.js";
import type { MechanismName } from "../mechanisms/mechanisms.js";
import type { ObservationMode } from "../observation/translator.js";
import type { Distributions } from "../sampler/sampler.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const INTERFACE_VERSION = "app-sim-1.0.0";
export const MECHANISMS_VERSION = "mech-1.0.0";

export interface ConditionCfg {
  persona_sheet: string;
  observation: ObservationMode;
  mechanisms: MechanismName[];
}

export interface Config {
  persona_id: string;
  llm: LlmSettings & { provider: string; history_window: number };
  ollama: OllamaSettings;
  limits: { max_actions: number; baseline_multiplier: number };
  conditions: Record<string, ConditionCfg>;
  distributions: Distributions;
  klm: KlmOps;
}

export function loadConfig(file = path.join(ROOT, "config/config.yaml")): { cfg: Config; hash: string } {
  const text = readFileSync(file, "utf8");
  return { cfg: YAML.parse(text) as Config, hash: createHash("sha256").update(text).digest("hex") };
}

/** Só a parte da tarefa que o CONTROLADOR pode ver: instrução e cena. O critério fica de fora. */
export interface TaskForController {
  id: string;
  set: string;
  scene: string;
  instruction: string;
}

export function loadTaskForController(taskId: string): TaskForController {
  const all = YAML.parse(readFileSync(path.join(ROOT, "design/tasks.yaml"), "utf8")).tasks;
  const t = all[taskId];
  if (!t) throw new Error(`tarefa desconhecida: ${taskId}`);
  return { id: taskId, set: t.set, scene: t.scene, instruction: t.instruction };
}

/** Linha de base (nº de ações) usada só para o limite de interrupção do protocolo. */
export function baselineActions(taskId: string): number {
  const klm = YAML.parse(readFileSync(path.join(ROOT, "design/klm.yaml"), "utf8"));
  return klm.baselines[taskId].actions as number;
}

export class ValidationLockError extends Error {}

/**
 * Trava das tarefas de validação (V1, V2): só carregam com --validation E com o
 * config.yaml idêntico ao congelado em config/FROZEN.sha256 (npm run freeze).
 */
export function loadScene(sceneId: string, opts: { allowValidation: boolean; configHash: string }): Scene {
  const calib = path.join(ROOT, "scenes/calib", `${sceneId}.yaml`);
  const valid = path.join(ROOT, "scenes/validation", `${sceneId}.yaml`);
  if (existsSync(calib)) return YAML.parse(readFileSync(calib, "utf8")) as Scene;
  if (existsSync(valid)) {
    if (!opts.allowValidation) throw new ValidationLockError(`cena ${sceneId} é de VALIDAÇÃO e está bloqueada (use --validation após congelar).`);
    const frozenFile = path.join(ROOT, "config/FROZEN.sha256");
    if (!existsSync(frozenFile)) throw new ValidationLockError("config não congelado: rode `npm run freeze` antes da validação.");
    const frozen = readFileSync(frozenFile, "utf8").trim();
    if (frozen !== opts.configHash) throw new ValidationLockError("config.yaml difere do congelado: validação recusada.");
    return YAML.parse(readFileSync(valid, "utf8")) as Scene;
  }
  throw new Error(`cena inexistente: ${sceneId}`);
}

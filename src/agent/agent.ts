/** Interface comum dos agentes (LLM, regras, humano via web). */
import type { AppState, Scene } from "../app/types.js";
import type { ActionOption } from "./prompt.js";

export interface AgentInput {
  system: string;
  user: string;
  actions: ActionOption[];
  /** Estado bruto — usado SOMENTE pelo executor por regras (controle GOMS); nunca vai ao LLM. */
  ruleView?: { state: AppState; scene: Scene };
}

export interface AgentChoice {
  action: string | null;
  raw: string;
  latency_ms: number;
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
  /** respostas fora do formato antes da válida */
  format_retries: number;
  tech_failure?: string;
}

export interface Agent {
  readonly kind: string;
  readonly model: string;
  choose(input: AgentInput): Promise<AgentChoice>;
}

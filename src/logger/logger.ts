/**
 * Registrador de eventos (Atividade 2.1). Uma linha JSON por evento (JSONL), gravada
 * no momento da execução. Arquivos por execução:
 *   <run_id>.events.jsonl   — eventos da interação (dicionário em docs/event-dictionary.md)
 *   <run_id>.prompts.jsonl  — prompts e contextos EFETIVAMENTE enviados ao agente por passo
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface EventRecord {
  run_id: string;
  session_id: string;
  persona_id: string;
  task_id: string;
  condition: string;
  agent: string;
  seed: number;
  config_hash: string;
  versions: Record<string, string>;
  t: string;
  t_ms: number;
  t_sim_s: number;
  step: number;
  event_type: string;
  origin: "agent" | "controller" | "system" | "human";
  scene_before?: string;
  scene_after?: string;
  proposed_action?: string | null;
  executed_action?: string | null;
  u?: string;
  d?: string;
  rejected_reason?: string;
  result: "ok" | "error" | "success" | "give_up" | "tech_failure" | "interrupted" | "pending";
  support?: string;
  error_category?: string;
  mechanisms_applied?: { mechanism: string; effect: string }[];
  klm_ops?: string;
  latency_ms?: number;
  state_before?: unknown;
  state_after?: unknown;
  event_data?: unknown;
  synthetic: boolean;
}

export class RunLogger {
  readonly eventsFile: string;
  readonly promptsFile: string;
  private t0 = Date.now();
  constructor(dir: string, readonly runId: string) {
    mkdirSync(dir, { recursive: true });
    this.eventsFile = path.join(dir, `${runId}.events.jsonl`);
    this.promptsFile = path.join(dir, `${runId}.prompts.jsonl`);
    // um arquivo por execução: zera se o mesmo run_id já existir (evita misturar sessões)
    writeFileSync(this.eventsFile, "");
    writeFileSync(this.promptsFile, "");
  }
  elapsed(): number {
    return Date.now() - this.t0;
  }
  event(e: Omit<EventRecord, "t" | "t_ms">): EventRecord {
    const rec = { ...e, t: new Date().toISOString(), t_ms: this.elapsed() } as EventRecord;
    appendFileSync(this.eventsFile, JSON.stringify(rec) + "\n");
    return rec;
  }
  prompt(p: Record<string, unknown>): void {
    appendFileSync(this.promptsFile, JSON.stringify({ run_id: this.runId, t: new Date().toISOString(), ...p }) + "\n");
  }
}

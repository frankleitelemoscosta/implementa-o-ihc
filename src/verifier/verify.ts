/**
 * Verificador EXTERNO de sucesso (Atividade 2.4). Processo separado do agente.
 * Decide o resultado de cada execução exclusivamente pelo ESTADO FINAL da interface
 * registrado no log (evento task_end → state_after.confirmed) comparado ao critério da
 * tarefa (design/tasks.yaml). Não lê prompts nem respostas do LLM; qualquer afirmação
 * do agente sobre "ter concluído" é ignorada.
 *
 *   npm run verify -- runs/pilot          → grava runs/pilot/verification.jsonl
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type Verdict = "success" | "wrong_object" | "give_up" | "interrupted" | "tech_failure" | "unknown";

export interface Verification {
  run_id: string;
  task_id: string;
  condition: string;
  agent: string;
  seed: number;
  verdict: Verdict;
  confirmed: string | null;
  expected: string;
  evidence: string;
}

export function loadCriteria(): Record<string, { confirmed_object: string }> {
  const t = YAML.parse(readFileSync(path.join(ROOT, "design/tasks.yaml"), "utf8")).tasks;
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v as { success: { confirmed_object: string } }).success]));
}

export function verifyEvents(lines: Record<string, any>[], criteria: Record<string, { confirmed_object: string }>): Verification {
  const start = lines.find((e) => e.event_type === "task_start");
  const end = [...lines].reverse().find((e) => e.event_type === "task_end");
  const ref = start ?? lines[0];
  const expected = criteria[ref.task_id].confirmed_object;
  const base = { run_id: ref.run_id, task_id: ref.task_id, condition: ref.condition, agent: ref.agent, seed: ref.seed, expected };
  if (!end) return { ...base, verdict: "unknown", confirmed: null, evidence: "sem evento task_end (sessão incompleta)" };
  const st = end.state_after as { confirmed: string | null; ended: string | null };
  let verdict: Verdict;
  if (st.ended === "confirmed") verdict = st.confirmed === expected ? "success" : "wrong_object";
  else if (st.ended === "give_up") verdict = "give_up";
  else if (st.ended === "interrupted") verdict = "interrupted";
  else if (st.ended === "tech_failure") verdict = "tech_failure";
  else verdict = "unknown";
  return { ...base, verdict, confirmed: st.confirmed, evidence: `task_end.state_after: ended=${st.ended}, confirmed=${st.confirmed}` };
}

export function readJsonl(file: string): Record<string, any>[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function main() {
  const dir = path.resolve(process.argv[2] ?? ".");
  const criteria = loadCriteria();
  const files = readdirSync(dir).filter((f) => f.endsWith(".events.jsonl")).sort();
  const out: Verification[] = files.map((f) => verifyEvents(readJsonl(path.join(dir, f)), criteria));
  writeFileSync(path.join(dir, "verification.jsonl"), out.map((v) => JSON.stringify(v)).join("\n") + "\n");
  const tally: Record<string, Record<string, number>> = {};
  for (const v of out) {
    const k = `${v.task_id}/${v.condition}/${v.agent}`;
    tally[k] ??= {};
    tally[k][v.verdict] = (tally[k][v.verdict] ?? 0) + 1;
  }
  console.table(tally);
  console.log(`${out.length} execuções verificadas → ${path.join(dir, "verification.jsonl")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

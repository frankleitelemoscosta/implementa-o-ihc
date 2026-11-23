/**
 * Auditoria da fronteira de informação (UXAgent-P3 §5-ii; anulação ii).
 * Varre os prompts EFETIVAMENTE enviados ao agente (*.prompts.jsonl) procurando
 * instrumentos do analista: ids internos, critério, HTA/CTT/GOMS/KLM, nomes e
 * parâmetros de mecanismos, conteúdo das tarefas de validação e instruções de encenação.
 *   npm run check-leak -- runs/pilot
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ROOT } from "../core/config.js";
import { ALL_MECHANISMS } from "../mechanisms/mechanisms.js";

export function forbiddenTerms(): string[] {
  const terms = new Set<string>([
    "confirmed_object", "success", "critério", "gabarito", "HTA", "CTT", "GOMS", "KLM", "MoLIC",
    "p_enq", "theta", "θ", "buffer_k", "r_verif", "q_accept", "p_at", "p_slip", "rho",
    "aja como", "finja", "encene", "interprete o papel", "comporte-se como",
    ...ALL_MECHANISMS,
  ]);
  for (const dir of ["scenes/calib", "scenes/validation"]) {
    for (const f of readdirSync(path.join(ROOT, dir))) {
      const sc = YAML.parse(readFileSync(path.join(ROOT, dir, f), "utf8"));
      terms.add(sc.id);
      for (const o of sc.objects) {
        terms.add(o.id);
        if (dir.endsWith("validation")) {
          terms.add(o.label);
          if (o.text) terms.add(o.text);
        }
      }
    }
  }
  const tasks = YAML.parse(readFileSync(path.join(ROOT, "design/tasks.yaml"), "utf8")).tasks;
  for (const id of ["V1", "V2"]) terms.add(tasks[id].instruction);
  return [...terms];
}

export function scanText(text: string, terms: string[]): string[] {
  const hits: string[] = [];
  for (const t of terms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}_])`, "u");
    if (re.test(text)) hits.push(t);
  }
  return hits;
}

function main() {
  const dir = path.resolve(process.argv[2] ?? ".");
  const terms = forbiddenTerms();
  const files = readdirSync(dir).filter((f) => f.endsWith(".prompts.jsonl"));
  let n = 0;
  const problems: string[] = [];
  for (const f of files) {
    for (const line of readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)) {
      const p = JSON.parse(line);
      n++;
      const hits = scanText(`${p.system}\n${p.user}`, terms);
      if (hits.length) problems.push(`${f} passo ${p.step}: ${hits.join(", ")}`);
    }
  }
  if (problems.length) {
    console.error(`VAZAMENTO em ${problems.length} de ${n} prompts:\n` + problems.slice(0, 30).join("\n"));
    process.exit(1);
  }
  console.log(`OK: ${n} prompts em ${files.length} execuções, nenhum dos ${terms.length} termos proibidos encontrado.`);
}

if (process.argv[1]?.endsWith("check-leak.ts")) main();

/**
 * Cálculo das métricas do piloto (dicionário: main.pdf, Tab. IX) e comparação com a
 * linha de base KLM de especialista (design/klm.yaml).
 *   npm run metrics -- runs/pilot   → runs/pilot/metrics/{runs.csv,summary.csv,summary.md,mac.csv}
 *                                     e artigo/tables/*.tex
 * Usa o veredito do verificador externo (verify.ts), nunca o texto do agente.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { initialState, step } from "../app/fsm.js";
import type { AppState, Scene } from "../app/types.js";
import { ROOT, loadConfig } from "../core/config.js";
import { stepSeconds } from "../core/klm.js";
import { loadCriteria, readJsonl, verifyEvents, type Verification } from "../verifier/verify.js";
import { MAC_TAGS, detectBreakdowns } from "./mac.js";

type Ev = Record<string, any>;

interface RunMetrics {
  run_id: string;
  task_id: string;
  condition: string;
  agent: string;
  seed: number;
  verdict: string;
  A: number;
  A_rej: number;
  dA: number;
  U_repeat: number;
  U_details: number;
  U_help: number;
  U_tactile: number;
  U: number;
  captures: number;
  captures_aim_miss: number;
  captures_no_target: number;
  confirms: number;
  confirms_wrong: number;
  gestures: number;
  slips: number;
  give_up: number;
  t_sim_s: number;
  klm_s: number;
  latency_median_ms: number | null;
  mac: Record<string, number>;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linha de base KLM: reexecuta o método do especialista no FSM, sem perturbações. */
export function klmBaseline(taskId: string): { actions: number; seconds: number; ops: string } | null {
  const klm = YAML.parse(readFileSync(path.join(ROOT, "design/klm.yaml"), "utf8")).baselines[taskId];
  if (!klm?.sequence) return null;
  const tasks = YAML.parse(readFileSync(path.join(ROOT, "design/tasks.yaml"), "utf8")).tasks;
  const scene = YAML.parse(readFileSync(path.join(ROOT, "scenes/calib", `${tasks[taskId].scene}.yaml`), "utf8")) as Scene;
  const { cfg } = loadConfig();
  let s: AppState = initialState(scene);
  let prev: string | null = null;
  let secs = 0;
  const ops: string[] = [];
  for (const a of klm.sequence as string[]) {
    const r = step(s, scene, a);
    const k = stepSeconds(a, prev, r.d, cfg.klm);
    secs += k.seconds;
    ops.push(k.ops);
    prev = a;
    s = r.state;
  }
  return { actions: klm.sequence.length, seconds: Math.round(secs * 100) / 100, ops: ops.join(" ") };
}

export function runMetrics(events: Ev[], v: Verification, baseline: { actions: number; seconds: number } | null, target: string, scene: Scene | null): RunMetrics {
  const acts = events.filter((e) => e.origin === "agent");
  const sup = (t: string) => acts.filter((e) => e.support === t).length;
  const caps = acts.filter((e) => e.event_type === "capture");
  const aimMiss = caps.filter((e) => {
    const sb = e.state_before;
    let intended: string | undefined;
    if (scene?.mode === "held") intended = scene.objects[sb.held]?.id;
    else intended = scene?.objects.find((o) => o.pos === sb.aim)?.id;
    return intended !== undefined && !(e.state_after.frame as string[]).includes(intended);
  }).length;
  const noTarget = caps.filter((e) => !(e.state_after.frame as string[]).includes(target)).length;
  const confirms = acts.filter((e) => e.event_type === "confirm");
  const wrong = confirms.filter((e) => e.state_after.confirmed !== target).length;
  const end = [...events].reverse().find((e) => e.event_type === "task_end");
  const lat = acts.map((e) => e.latency_ms).filter((x) => typeof x === "number" && x > 0);
  const mac: Record<string, number> = Object.fromEntries(MAC_TAGS.map((t) => [t, 0]));
  for (const b of detectBreakdowns(events, target)) mac[b.tag]++;
  const A = acts.length;
  return {
    run_id: v.run_id,
    task_id: v.task_id,
    condition: v.condition,
    agent: v.agent,
    seed: v.seed,
    verdict: v.verdict,
    A,
    A_rej: events.filter((e) => e.event_type === "rejected_action").length,
    dA: baseline ? A - baseline.actions : NaN,
    U_repeat: sup("repeat"),
    U_details: sup("details"),
    U_help: sup("help"),
    U_tactile: sup("tactile"),
    U: sup("repeat") + sup("details") + sup("help") + sup("tactile"),
    captures: caps.length,
    captures_aim_miss: aimMiss,
    captures_no_target: noTarget,
    confirms: confirms.length,
    confirms_wrong: wrong,
    gestures: acts.filter((e) => ["proximo", "anterior", "mirar_esquerda", "mirar_direita"].includes(e.executed_action)).length,
    slips: acts.filter((e) => e.error_category === "deslize").length,
    give_up: events.filter((e) => e.event_type === "give_up").length,
    t_sim_s: end?.t_sim_s ?? 0,
    klm_s: baseline?.seconds ?? NaN,
    latency_median_ms: median(lat),
    mac,
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const ratio = (n: number, d: number) => (d ? n / d : NaN);
const f2 = (x: number | null) => (x === null || Number.isNaN(x) ? "—" : x.toFixed(2));

function main() {
  const dir = path.resolve(process.argv[2] ?? ".");
  const criteria = loadCriteria();
  const tasks = YAML.parse(readFileSync(path.join(ROOT, "design/tasks.yaml"), "utf8")).tasks;
  const files = readdirSync(dir).filter((f) => f.endsWith(".events.jsonl")).sort();
  const runs: RunMetrics[] = [];
  const baselines: Record<string, ReturnType<typeof klmBaseline>> = {};
  for (const f of files) {
    const ev = readJsonl(path.join(dir, f));
    const v = verifyEvents(ev, criteria);
    baselines[v.task_id] ??= klmBaseline(v.task_id);
    let scene: Scene | null = null;
    try {
      scene = YAML.parse(readFileSync(path.join(ROOT, "scenes/calib", `${tasks[v.task_id].scene}.yaml`), "utf8"));
    } catch {
      scene = null;
    }
    runs.push(runMetrics(ev, v, baselines[v.task_id], criteria[v.task_id].confirmed_object, scene));
  }
  const out = path.join(dir, "metrics");
  mkdirSync(out, { recursive: true });

  const cols = Object.keys(runs[0]).filter((c) => c !== "mac");
  writeFileSync(
    path.join(out, "runs.csv"),
    [cols.join(","), ...runs.map((r) => cols.map((c) => String((r as any)[c] ?? "")).join(","))].join("\n") + "\n",
  );

  // Agregação por tarefa × condição × agente (antes de qualquer agregação global).
  const groups = new Map<string, RunMetrics[]>();
  for (const r of runs) {
    const k = `${r.task_id}|${r.condition}|${r.agent}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const summary: Record<string, string | number>[] = [];
  const macRows: Record<string, string | number>[] = [];
  for (const [k, rs] of groups) {
    const [task, condition, agent] = k.split("|");
    const valid = rs.filter((r) => r.verdict !== "tech_failure" && r.verdict !== "unknown");
    const b = baselines[task];
    const sumOf = (key: keyof RunMetrics) => valid.reduce((a, r) => a + (r[key] as number), 0);
    summary.push({
      task,
      condition,
      agent,
      N_ini: rs.length,
      N_valid: valid.length,
      tech_failure: rs.filter((r) => r.verdict === "tech_failure").length,
      unknown: rs.filter((r) => r.verdict === "unknown").length,
      S: ratio(valid.filter((r) => r.verdict === "success").length, valid.length),
      wrong_object: valid.filter((r) => r.verdict === "wrong_object").length,
      give_up: valid.filter((r) => r.verdict === "give_up").length,
      interrupted: valid.filter((r) => r.verdict === "interrupted").length,
      A_mean: mean(valid.map((r) => r.A)),
      A_klm: b?.actions ?? NaN,
      dA_mean: mean(valid.map((r) => r.dA)),
      A_rej: sumOf("A_rej"),
      U_mean: mean(valid.map((r) => r.U)),
      U_repeat: mean(valid.map((r) => r.U_repeat)),
      U_details: mean(valid.map((r) => r.U_details)),
      U_help: mean(valid.map((r) => r.U_help)),
      U_tactile: mean(valid.map((r) => r.U_tactile)),
      AI: ratio(sumOf("confirms_wrong"), sumOf("confirms")),
      R_enq: ratio(sumOf("captures_aim_miss"), sumOf("captures")),
      R_sem_alvo: ratio(sumOf("captures_no_target"), sumOf("captures")),
      R_deslize: ratio(sumOf("slips"), sumOf("gestures")),
      T_sim_mean_s: mean(valid.map((r) => r.t_sim_s)),
      T_klm_s: b?.seconds ?? NaN,
      L_median_ms: median(rs.map((r) => r.latency_median_ms).filter((x): x is number => x !== null)) ?? NaN,
    });
    const m: Record<string, string | number> = { task, condition, agent };
    for (const t of MAC_TAGS) m[t] = valid.reduce((a, r) => a + r.mac[t], 0);
    macRows.push(m);
  }
  const toCsv = (rows: Record<string, string | number>[]) =>
    [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map((x) => (typeof x === "number" ? (Number.isInteger(x) ? x : x.toFixed(3)) : x)).join(","))].join("\n") + "\n";
  writeFileSync(path.join(out, "summary.csv"), toCsv(summary));
  writeFileSync(path.join(out, "mac.csv"), toCsv(macRows));

  // Markdown legível
  const md: string[] = ["# Resumo do piloto (dados SINTÉTICOS)", ""];
  md.push("| Tarefa | Condição | Agente | N | S | AI | R_enq | Ā | A_KLM | Ū | T_sim (s) | T_KLM (s) | L med (ms) |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of summary)
    md.push(`| ${r.task} | ${r.condition} | ${r.agent} | ${r.N_valid}/${r.N_ini} | ${f2(r.S as number)} | ${f2(r.AI as number)} | ${f2(r.R_enq as number)} | ${f2(r.A_mean as number)} | ${r.A_klm} | ${f2(r.U_mean as number)} | ${f2(r.T_sim_mean_s as number)} | ${f2(r.T_klm_s as number)} | ${f2(r.L_median_ms as number)} |`);
  md.push("", "## Rupturas MAC (contagem por assinatura no log)", "", `| Tarefa | Condição | ${MAC_TAGS.join(" | ")} |`, `|---|---|${MAC_TAGS.map(() => "---").join("|")}|`);
  for (const r of macRows) md.push(`| ${r.task} | ${r.condition} | ${MAC_TAGS.map((t) => r[t]).join(" | ")} |`);
  md.push("", "## Linha de base KLM (especialista)", "");
  for (const [t, b] of Object.entries(baselines)) if (b) md.push(`- ${t}: ${b.actions} ações, ${b.seconds} s — operadores: \`${b.ops}\``);
  writeFileSync(path.join(out, "summary.md"), md.join("\n") + "\n");

  // Tabelas LaTeX para o artigo
  const tdir = path.join(ROOT, "artigo/tables");
  mkdirSync(tdir, { recursive: true });
  const condName: Record<string, string> = { perfil: "Perfil", comparador: "Comparador", generico: "Genérico" };
  const tex = [
    "\\begin{tabular}{llrrrrrrrr}",
    "\\toprule",
    "Tarefa & Condição & $N$ & $S$ & $AI$ & $R_{enq}$ & $\\bar{A}$ & $A_{KLM}$ & $\\bar{U}$ & $\\bar{T}_{sim}/T_{KLM}$ \\\\",
    "\\midrule",
    ...summary
      .filter((r) => !summary.some((x) => x.agent !== "rules") || r.agent !== "rules")
      .map(
        (r) =>
          `${r.task} & ${condName[r.condition as string] ?? r.condition} & ${r.N_valid} & ${f2(r.S as number)} & ${f2(r.AI as number)} & ${f2(r.R_enq as number)} & ${f2(r.A_mean as number)} & ${r.A_klm} & ${f2(r.U_mean as number)} & ${f2((r.T_sim_mean_s as number) / (r.T_klm_s as number))} \\\\`,
      ),
    "\\bottomrule",
    "\\end{tabular}",
  ];
  writeFileSync(path.join(tdir, "pilot_summary.tex"), tex.join("\n") + "\n");
  const macTex = [
    `\\begin{tabular}{ll${"r".repeat(MAC_TAGS.length)}}`,
    "\\toprule",
    `Tarefa & Condição & ${MAC_TAGS.map((t) => `\\rotatebox{70}{${t}}`).join(" & ")} \\\\`,
    "\\midrule",
    ...macRows
      .filter((r) => !macRows.some((x) => x.agent !== "rules") || r.agent !== "rules")
      .map((r) => `${r.task} & ${condName[r.condition as string] ?? r.condition} & ${MAC_TAGS.map((t) => r[t]).join(" & ")} \\\\`),
    "\\bottomrule",
    "\\end{tabular}",
  ];
  writeFileSync(path.join(tdir, "pilot_mac.tex"), macTex.join("\n") + "\n");
  console.log(readFileSync(path.join(out, "summary.md"), "utf8"));
}

// só roda como CLI (permite importar klmBaseline de outros módulos)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

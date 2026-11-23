/**
 * CLI do piloto.
 *   npm run pilot -- --task C1 --condition perfil --agent llm --runs 10 --seed 1000 --out runs/pilot
 *   npm run pilot -- --pilot --runs 10           # C1,C2 × perfil,comparador,generico
 *   npm run pilot -- --task C1 --agent rules      # executor por regras (sem API)
 *   npm run pilot -- --task C1 --agent ollama     # LLM local via Ollama (sem chave)
 * Tarefas V1/V2 só rodam com --validation e config congelado (trava em core/config.ts).
 */
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { ClaudeAgent } from "../agent/llm.js";
import { OllamaAgent } from "../agent/ollama.js";
import { RulesAgent } from "../agent/rules.js";
import type { Agent } from "../agent/agent.js";
import { ROOT, baselineActions, loadConfig, loadScene, loadTaskForController } from "../core/config.js";
import { runSession } from "../core/session.js";

function args(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    if (a[i + 1] && !a[i + 1].startsWith("--")) out[k] = a[++i];
    else out[k] = true;
  }
  return out;
}

// Palavra-chave do pedido, usada só pelo executor por regras (vem da instrução, não do critério).
const RULE_KEYWORDS: Record<string, string> = { C1: "caneca azul", C2: "dipirona", V1: "controle remoto", V2: "milho" };

async function main() {
  const a = args();
  if (existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
  const { cfg, hash } = loadConfig();
  const tasks = a.pilot ? ["C1", "C2"] : String(a.task ?? "C1").split(",");
  const conditions = a.pilot ? ["perfil", "comparador", "generico"] : String(a.condition ?? "perfil").split(",");
  const agentKind = String(a.agent ?? "llm");
  const runs = Number(a.runs ?? 1);
  const seed0 = Number(a.seed ?? 1000);
  const outDir = path.resolve(ROOT, String(a.out ?? `runs/${new Date().toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(outDir, { recursive: true });
  const manifest = path.join(outDir, "manifest.jsonl");
  if (existsSync(manifest)) {
    console.error(`${path.relative(ROOT, outDir)} já contém execuções (manifest.jsonl): use outra pasta em --out para não misturar pilotos.`);
    process.exit(2);
  }

  if (agentKind === "llm" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("Sem credencial da API Anthropic: defina ANTHROPIC_API_KEY no .env (veja .env.example) ou use --agent rules.");
    process.exit(2);
  }
  if (agentKind === "ollama") await new OllamaAgent(cfg.ollama).check();
  if (!["llm", "ollama", "rules"].includes(agentKind)) {
    console.error(`--agent desconhecido: ${agentKind} (use llm, ollama ou rules).`);
    process.exit(2);
  }

  for (const taskId of tasks) {
    const task = loadTaskForController(taskId);
    const scene = loadScene(task.scene, { allowValidation: Boolean(a.validation), configHash: hash });
    const maxActions = Math.min(cfg.limits.max_actions, cfg.limits.baseline_multiplier * baselineActions(taskId));
    for (const condition of conditions) {
      for (let i = 0; i < runs; i++) {
        const seed = seed0 + i; // mesma semente entre condições → mesmos θ sorteados (pareamento)
        const agent: Agent =
          agentKind === "rules" ? new RulesAgent(RULE_KEYWORDS[taskId]) : agentKind === "ollama" ? new OllamaAgent(cfg.ollama) : new ClaudeAgent(cfg.llm);
        const s = await runSession({ cfg, configHash: hash, task, scene, condition, agent, seed, outDir, maxActions });
        appendFileSync(manifest, JSON.stringify(s) + "\n");
        console.log(`${s.run_id}: fim=${s.end_reason} ações=${s.actions} rejeitadas=${s.rejected}`);
      }
    }
  }
  console.log(`\nLogs em ${outDir}. Sucesso NÃO é decidido aqui: rode  npm run verify -- ${path.relative(ROOT, outDir)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Empacota o E3 (Pacote de Dados do Piloto): logs JSON de eventos, prompts/contextos
 * enviados ao LLM, manifesto, veredito do verificador, métricas e documentação.
 *   npm run package-e3 -- runs/pilot   → pilot/E3.zip
 *   npm run package-e3 -- runs/pilot --config runs/pilot/config.yaml   (config efetivamente usado no piloto)
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, loadConfig } from "../core/config.js";

const src = path.resolve(process.argv[2] ?? "runs/pilot");
const ci = process.argv.indexOf("--config");
const configFile = ci > 0 ? path.resolve(process.argv[ci + 1]) : path.join(ROOT, "config/config.yaml");
const stage = path.join(ROOT, "pilot/E3");
rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, "logs"), { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith(".jsonl")) copyFileSync(path.join(src, f), path.join(stage, "logs", f));
}
if (existsSync(path.join(src, "metrics"))) {
  mkdirSync(path.join(stage, "metrics"), { recursive: true });
  for (const f of readdirSync(path.join(src, "metrics"))) copyFileSync(path.join(src, "metrics", f), path.join(stage, "metrics", f));
}
copyFileSync(path.join(ROOT, "docs/event-dictionary.md"), path.join(stage, "event-dictionary.md"));
copyFileSync(configFile, path.join(stage, "config.yaml"));
const { hash } = loadConfig(configFile);
writeFileSync(
  path.join(stage, "LEIAME.md"),
  `# E3 — Pacote de Dados do Piloto (UX-Agent)

Dados **SINTÉTICOS** gerados por agente proxy LLM. Não representam desempenho de pessoas com deficiência visual.

- \`logs/*.events.jsonl\` — um evento JSON por linha (dicionário em \`event-dictionary.md\`).
- \`logs/*.prompts.jsonl\` — prompt de sistema, prompt do passo, schema de saída (enum das falas u:) e resposta bruta, por passo.
- \`logs/manifest.jsonl\` — uma linha por execução (parâmetros sorteados θ, semente, fim).
- \`logs/verification.jsonl\` — veredito do verificador EXTERNO (estado final da interface).
- \`metrics/\` — métricas por execução e por tarefa × condição; rupturas MAC por assinatura.
- \`config.yaml\` — configuração usada (SHA-256 ${hash}).

Somente tarefas de **calibração** (C1, C2). V1 e V2 permanecem reservadas.
`,
);
mkdirSync(path.join(ROOT, "pilot"), { recursive: true });
rmSync(path.join(ROOT, "pilot/E3.zip"), { force: true });
execFileSync("zip", ["-qr", "../E3.zip", "."], { cwd: stage });
console.log(`E3 gerado: ${path.join(ROOT, "pilot/E3.zip")}`);

/**
 * Congela o config.yaml antes da validação (Modelagem, Seç. X-iv): grava o SHA-256 em
 * config/FROZEN.sha256. Depois disso, V1/V2 só rodam se o config for idêntico.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadConfig } from "../core/config.js";

const { hash } = loadConfig();
writeFileSync(path.join(ROOT, "config/FROZEN.sha256"), hash + "\n");
console.log(`config congelado: ${hash}\nA partir de agora qualquer alteração em config/config.yaml bloqueia V1/V2.`);

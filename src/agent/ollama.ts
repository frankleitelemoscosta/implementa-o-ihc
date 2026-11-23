/**
 * Agente proxy LLM local via Ollama (alternativa sem chave de API ao ClaudeAgent).
 * Mesmo contrato do ClaudeAgent: uma requisição independente por passo, resposta
 * restrita por JSON schema com `enum` = falas u: válidas no estado atual da MoLIC
 * (campo `format` da API /api/chat do Ollama, decodificação guiada por gramática).
 *
 * Ollama < 0.5 não aceita JSON schema em `format`: nesse caso o agente cai para o modo
 * legado (`format: "json"` + uma linha no prompt com o formato esperado); a restrição ao
 * enum continua garantida pela validação abaixo (resposta fora dele = nova tentativa).
 *
 * Falhas técnicas (timeout, servidor fora do ar, modelo ausente, truncamento, formato
 * inválido após N tentativas) viram `tech_failure` e não contam como erro de interação.
 */
import type { Agent, AgentChoice, AgentInput } from "./agent.js";
import { responseSchema } from "./prompt.js";

export interface OllamaSettings {
  model: string;
  host: string;
  temperature: number;
  num_predict: number;
  timeout_ms: number;
  max_format_retries: number;
  /** pede um campo curto "raciocinio" antes de "acao" (modelos pequenos escolhem melhor quando podem pensar antes) */
  reasoning_field?: boolean;
}

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export class OllamaAgent implements Agent {
  readonly kind = "ollama";
  private host: string;
  /** true quando o servidor não aceita JSON schema em `format` (Ollama < 0.5). Vale para o processo todo. */
  private static legacyFormat = false;
  constructor(private cfg: OllamaSettings) {
    this.host = (process.env.OLLAMA_HOST ?? cfg.host).replace(/\/+$/, "");
    if (!/^https?:\/\//.test(this.host)) this.host = `http://${this.host}`;
  }
  get model() {
    return this.cfg.model;
  }

  /** Confere se o servidor responde e se o modelo está baixado (usado antes de rodar). */
  async check(): Promise<void> {
    let tags: { models?: { name: string; model?: string }[] };
    try {
      const r = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(5000) });
      tags = await r.json();
    } catch {
      throw new Error(`Ollama não responde em ${this.host}: rode \`ollama serve\` (ou ajuste OLLAMA_HOST).`);
    }
    const want = this.cfg.model.includes(":") ? this.cfg.model : `${this.cfg.model}:latest`;
    const names = (tags.models ?? []).flatMap((m) => [m.name, m.model ?? ""]);
    if (!names.includes(want) && !names.includes(this.cfg.model)) {
      throw new Error(`modelo ${this.cfg.model} não encontrado no Ollama: rode \`ollama pull ${this.cfg.model}\`.`);
    }
  }

  private schema(ids: string[]) {
    const base = responseSchema(ids);
    if (!this.cfg.reasoning_field) return base;
    return {
      ...base,
      properties: { raciocinio: { type: "string", maxLength: 300 }, ...base.properties },
      required: ["raciocinio", ...base.required],
    };
  }

  async choose(input: AgentInput): Promise<AgentChoice> {
    const ids = input.actions.map((a) => a.id);
    let retries = 0;
    const t0 = Date.now();
    let raw = "";
    for (;;) {
      let body: OllamaChatResponse;
      try {
        const user = OllamaAgent.legacyFormat
          ? `${input.user}\n\nResponda somente com o JSON {${this.cfg.reasoning_field ? '"raciocinio": "<frase curta>", ' : ""}"acao": "<identificador>"}, usando um dos identificadores acima.`
          : this.cfg.reasoning_field
            ? `${input.user}\n\nNo campo "raciocinio", diga em uma frase curta por que essa ação ajuda a atender o pedido; depois escolha a "acao".`
            : input.user;
        const r = await fetch(`${this.host}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(this.cfg.timeout_ms),
          body: JSON.stringify({
            model: this.cfg.model,
            stream: false,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: user },
            ],
            format: OllamaAgent.legacyFormat ? "json" : this.schema(ids),
            options: { temperature: this.cfg.temperature, num_predict: this.cfg.num_predict },
          }),
        });
        body = (await r.json()) as OllamaChatResponse;
        if (!OllamaAgent.legacyFormat && body.error && /format/i.test(body.error)) {
          OllamaAgent.legacyFormat = true;
          console.warn(`[ollama] servidor sem suporte a JSON schema em "format" (${body.error}); usando format "json". Atualize o Ollama (>= 0.5) para decodificação restrita ao enum.`);
          continue;
        }
        if (!r.ok || body.error) {
          return { action: null, raw: body.error ?? "", latency_ms: Date.now() - t0, format_retries: retries, tech_failure: `api_error_${r.status}` };
        }
      } catch (err) {
        const e = err as Error;
        const why = e.name === "TimeoutError" ? "timeout" : `error: ${e.message}`;
        return { action: null, raw: String(err), latency_ms: Date.now() - t0, format_retries: retries, tech_failure: why };
      }
      const usage = { input_tokens: body.prompt_eval_count ?? 0, output_tokens: body.eval_count ?? 0 };
      const stop = body.done_reason ?? null;
      if (stop === "length") {
        return { action: null, raw: body.message?.content ?? "", latency_ms: Date.now() - t0, usage, stop_reason: "max_tokens", format_retries: retries, tech_failure: "max_tokens" };
      }
      raw = body.message?.content ?? "";
      let action: string | null = null;
      try {
        const parsed = JSON.parse(raw) as { acao?: unknown };
        if (typeof parsed.acao === "string" && ids.includes(parsed.acao)) action = parsed.acao;
      } catch {
        action = null;
      }
      if (action) return { action, raw, latency_ms: Date.now() - t0, usage, stop_reason: stop, format_retries: retries };
      if (++retries > this.cfg.max_format_retries) {
        return { action: null, raw, latency_ms: Date.now() - t0, usage, stop_reason: stop, format_retries: retries, tech_failure: "formato_invalido" };
      }
    }
  }
}

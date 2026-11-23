/**
 * Agente proxy LLM (Atividade 2.3) — Claude via SDK oficial @anthropic-ai/sdk.
 * Uma requisição independente por passo (contexto zerado; a "memória" que o modelo
 * recebe é decidida pelo controlador). A resposta é restrita por saída estruturada:
 * JSON schema com `enum` = falas u: válidas no estado atual da MoLIC.
 *
 * Falhas técnicas (timeout > 30 s, erro de API, recusa, truncamento, formato inválido
 * após N tentativas) viram `tech_failure` e não contam como erro de interação.
 * Sem fallback de modelo: trocar de modelo no meio da sessão confundiria o experimento.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Agent, AgentChoice, AgentInput } from "./agent.js";
import { responseSchema } from "./prompt.js";

export interface LlmSettings {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  max_tokens: number;
  timeout_ms: number;
  max_format_retries: number;
}

export class ClaudeAgent implements Agent {
  readonly kind = "llm";
  private client: Anthropic;
  constructor(private cfg: LlmSettings) {
    this.client = new Anthropic({ timeout: cfg.timeout_ms, maxRetries: 2 });
  }
  get model() {
    return this.cfg.model;
  }

  async choose(input: AgentInput): Promise<AgentChoice> {
    const ids = input.actions.map((a) => a.id);
    let retries = 0;
    const t0 = Date.now();
    let raw = "";
    for (;;) {
      let msg: Anthropic.Message;
      try {
        msg = await this.client.messages.create({
          model: this.cfg.model,
          max_tokens: this.cfg.max_tokens,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
          output_config: {
            effort: this.cfg.effort,
            format: { type: "json_schema", schema: responseSchema(ids) },
          },
        });
      } catch (err) {
        const why =
          err instanceof Anthropic.APIConnectionTimeoutError
            ? "timeout"
            : err instanceof Anthropic.RateLimitError
              ? "rate_limit"
              : err instanceof Anthropic.AuthenticationError
                ? "auth"
                : err instanceof Anthropic.APIError
                  ? `api_error_${err.status ?? "?"}`
                  : `error: ${(err as Error).message}`;
        return { action: null, raw: String(err), latency_ms: Date.now() - t0, format_retries: retries, tech_failure: why };
      }
      const usage = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
      if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
        return { action: null, raw: "", latency_ms: Date.now() - t0, usage, stop_reason: msg.stop_reason, format_retries: retries, tech_failure: msg.stop_reason };
      }
      raw = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let action: string | null = null;
      try {
        const parsed = JSON.parse(raw) as { acao?: unknown };
        if (typeof parsed.acao === "string" && ids.includes(parsed.acao)) action = parsed.acao;
      } catch {
        action = null;
      }
      if (action) return { action, raw, latency_ms: Date.now() - t0, usage, stop_reason: msg.stop_reason, format_retries: retries };
      if (++retries > this.cfg.max_format_retries) {
        return { action: null, raw, latency_ms: Date.now() - t0, usage, stop_reason: msg.stop_reason, format_retries: retries, tech_failure: "formato_invalido" };
      }
    }
  }
}

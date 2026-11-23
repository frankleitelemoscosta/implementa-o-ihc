/**
 * Executor por regras (controle da Modelagem, Seç. X-ix): segue um método GOMS fixo,
 * sem LLM e sem custo de API. Usa apenas informação observável (anúncios, rótulos,
 * texto lido) e a palavra-chave do pedido — NÃO usa o critério de sucesso nem ids.
 * Serve para (1) testar a instrumentação de ponta a ponta e (2) como linha de comparação.
 */
import type { Agent, AgentChoice, AgentInput } from "./agent.js";

export class RulesAgent implements Agent {
  readonly kind = "rules";
  readonly model = "rules-goms-v1";
  private capturedAims = new Set<number>();
  private notTarget = new Set<number>();
  private isTarget = new Set<number>();
  private detailed = new Set<number>();
  private sweepDir = 1;

  constructor(private keyword: string) {}

  async choose(input: AgentInput): Promise<AgentChoice> {
    const t0 = Date.now();
    const action = this.policy(input);
    return { action, raw: JSON.stringify({ acao: action }), latency_ms: Date.now() - t0, format_retries: 0 };
  }

  private policy(input: AgentInput): string {
    const allowed = new Set(input.actions.map((a) => a.id));
    const pick = (...ids: string[]) => ids.find((i) => allowed.has(i)) ?? input.actions[0].id;
    const { state: s, scene } = input.ruleView!;
    const kw = this.keyword.toLowerCase();
    const has = (t: string) => t.toLowerCase().includes(kw);

    switch (s.screen) {
      case "launcher":
        if (allowed.has("atalho_app")) return "atalho_app";
        return s.focus === 2 ? "ativar" : "proximo";
      case "inicio":
        if (allowed.has("atalho_camera")) return "atalho_camera";
        return s.focus === 0 ? "ativar" : "anterior";
      case "ajuda":
        return "voltar";
      case "camera": {
        if (scene.mode === "held") {
          if (this.notTarget.has(s.held)) return pick("pegar_proxima");
          if (this.isTarget.has(s.held) && s.zoom !== "perto") return pick("aproximar");
          return pick("capturar");
        }
        if (!this.capturedAims.has(s.aim)) return pick("capturar");
        if (s.aim >= 2) this.sweepDir = -1;
        if (s.aim <= -2) this.sweepDir = 1;
        return pick(this.sweepDir > 0 ? "mirar_direita" : "mirar_esquerda");
      }
      case "resultado": {
        if (scene.mode === "table") this.capturedAims.add(s.aim);
        const idx = s.result.findIndex((d) => has(d.label));
        if (idx >= 0) {
          if (s.resultFocus !== idx) return pick("proximo", `confirmar:${idx + 1}`);
          return pick("confirmar", `confirmar:${idx + 1}`, "mais_detalhes");
        }
        if (scene.mode === "held" && s.result.length && !this.detailed.has(s.held) && !this.notTarget.has(s.held)) {
          this.detailed.add(s.held);
          return pick("mais_detalhes");
        }
        return pick("nova_captura");
      }
      case "detalhes": {
        if (has(s.announcement)) {
          if (scene.mode === "held") this.isTarget.add(s.held);
          return pick("confirmar", "voltar");
        }
        if (scene.mode === "held") this.notTarget.add(s.held);
        return pick("voltar");
      }
      default:
        return input.actions[0].id;
    }
  }
}

/**
 * Operadores KLM (Card, Moran & Newell, 1980) adaptados ao toque.
 * Usado (1) pelo analista para a linha de base de especialista e (2) pelo mecanismo
 * Hesitation como tempo-base de cada passo. Não é enviado ao LLM.
 *
 * Regras de colocação (documentadas no Caderno E1, seção KLM):
 *  - K: toque/gesto em controle da tela; P: mover/apontar o celular ou a mão (mirar,
 *    aproximar, afastar, tato, pegar objeto);
 *  - M antes de cada ação que inicia uma nova unidade cognitiva (ação diferente da anterior);
 *  - R: duração da fala d: do leitor de tela = nº de palavras / velocidade.
 */
export interface KlmOps {
  K: number;
  M: number;
  P: number;
  speech_words_per_s: number;
}

const POINTING = new Set(["mirar_esquerda", "mirar_direita", "aproximar", "afastar", "tato", "pegar_proxima"]);

export function operatorsFor(action: string, prev: string | null): string {
  const physical = POINTING.has(action) ? "P" : "K";
  return action !== prev ? `M${physical}` : physical;
}

export function speechSeconds(text: string, ops: KlmOps): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / ops.speech_words_per_s;
}

export function stepSeconds(action: string, prev: string | null, response: string, ops: KlmOps): { ops: string; seconds: number } {
  const o = operatorsFor(action, prev);
  let t = 0;
  for (const c of o) t += c === "M" ? ops.M : c === "P" ? ops.P : ops.K;
  return { ops: `${o}R`, seconds: t + speechSeconds(response, ops) };
}

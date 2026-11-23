/**
 * Detector de rupturas comunicativas (MAC — Método de Avaliação de Comunicabilidade,
 * de Souza & Leitão, 2009) EXCLUSIVAMENTE por assinaturas no log de eventos
 * (Atividade 1.4; UXAgent-P3 §5-v). Nenhuma assinatura usa texto produzido pelo LLM.
 * Assinaturas derivadas da HTA congelada (main.pdf, Tab. VII, X–XII) e de design/errors.yaml.
 */

export interface Breakdown {
  tag: string;
  step: number;
  evidence: string;
}

type Ev = Record<string, any>;

export const MAC_TAGS = [
  "Cadê?",
  "Epa!",
  "Onde estou?",
  "E agora?",
  "O que é isto?",
  "Por que não funciona?",
  "Ué, o que houve?",
  "Socorro!",
  "Para mim está bom",
  "Desisto",
] as const;

export function detectBreakdowns(events: Ev[], target: string): Breakdown[] {
  const out: Breakdown[] = [];
  const acts = events.filter((e) => e.origin === "agent");
  let inicioMoves = 0;
  let emptyStreak = 0;
  let repeatStreak = 0;
  for (let i = 0; i < acts.length; i++) {
    const e = acts[i];
    const prev = acts[i - 1];
    const a = e.executed_action as string;

    // Cadê? — procura o controle: focus_move na tela inicial acima da linha de base (0)
    if (e.event_type === "focus_move" && e.scene_before === "inicio") {
      inicioMoves++;
      if (inicioMoves === 2) out.push({ tag: "Cadê?", step: e.step, evidence: "2+ focus_move na tela inicial" });
    }
    // Epa! — ativação seguida imediatamente de Voltar
    if (a === "voltar" && prev && (prev.event_type === "activate" || prev.event_type === "shortcut_used") && prev.scene_after === e.scene_before) {
      out.push({ tag: "Epa!", step: e.step, evidence: `voltar logo após ${prev.executed_action}` });
    }
    // Onde estou? — o foco dá a volta na lista de resultados
    if (e.event_type === "focus_move" && e.scene_before === "resultado" && String(e.d).startsWith("Volta ao início")) {
      out.push({ tag: "Onde estou?", step: e.step, evidence: "foco voltou ao início da lista" });
    }
    // E agora? — Repetir seguidos sem outra ação
    if (e.support === "repeat") {
      repeatStreak++;
      if (repeatStreak === 2) out.push({ tag: "E agora?", step: e.step, evidence: "2 Repetir seguidos" });
    } else repeatStreak = 0;
    // O que é isto? — detalhes repetidos do mesmo objeto sem decisão
    if (e.support === "details") {
      const id = e.state_before?.result?.[e.state_before.result_focus]?.id;
      const earlier = acts.slice(0, i).filter((x) => x.support === "details" && x.state_before?.result?.[x.state_before.result_focus]?.id === id);
      if (earlier.length === 1) out.push({ tag: "O que é isto?", step: e.step, evidence: `2º Mais detalhes do mesmo objeto` });
    }
    // Por que não funciona? — capturas vazias seguidas (mesma ação sem efeito)
    if (e.event_type === "capture") {
      const empty = (e.state_after?.result ?? []).length === 0;
      emptyStreak = empty ? emptyStreak + 1 : 0;
      if (emptyStreak === 2) out.push({ tag: "Por que não funciona?", step: e.step, evidence: "2 capturas seguidas sem objeto" });
    }
    // Ué, o que houve? — deslize seguido de correção no sentido oposto
    if (prev && prev.error_category === "deslize" && ((prev.executed_action === "proximo" && a === "anterior") || (prev.executed_action === "mirar_direita" && a === "mirar_esquerda") || (prev.executed_action === "mirar_esquerda" && a === "mirar_direita"))) {
      out.push({ tag: "Ué, o que houve?", step: e.step, evidence: "correção logo após deslize" });
    }
    // Socorro! — ajuda após falhas seguidas de captura
    if (e.support === "help" && emptyStreak >= 2) out.push({ tag: "Socorro!", step: e.step, evidence: "ajuda após capturas vazias seguidas" });
    // Para mim está bom — confirma objeto com 'provavelmente' (c < 0,75) ou errado, sem nenhuma verificação
    if (e.event_type === "confirm") {
      const sb = e.state_before;
      const d = a.startsWith("confirmar:") ? sb.result[Number(a.split(":")[1]) - 1] : sb.result[sb.result_focus];
      const verified = (sb.verifications?.[d.id] ?? 0) > 0;
      if (!verified && (d.conf < 0.75 || d.id !== target)) out.push({ tag: "Para mim está bom", step: e.step, evidence: `confirmou ${d.id} (c=${d.conf}) sem verificação` });
    }
  }
  // Desisto — desistência (pelo agente ou pelo AttemptLimit)
  for (const e of events) if (e.event_type === "give_up") out.push({ tag: "Desisto", step: e.step, evidence: `give_up (${e.origin})` });
  return out;
}

/**
 * Montagem do contexto enviado ao LLM (Atividade 2.3).
 * Conteúdo PERMITIDO: ficha (fictícia) da pessoa, instrução literal da tarefa,
 * observação o_t do passo e a lista de falas u: válidas no estado atual da MoLIC.
 * PROIBIDO (e verificado por `npm run check-leak`): HTA, CTT, GOMS/KLM, critério de
 * sucesso, alvo interno, parâmetros dos mecanismos, dados das tarefas de validação,
 * e qualquer instrução de "encenar" o perfil (o comportamento vem do controlador).
 * Este módulo NÃO importa nada de design/.
 */

export const PERSONA_SHEETS: Record<string, string> = {
  marina:
    "Marina, 34 anos (personagem fictícia), analista administrativa. É cega desde os 19 anos e percebe apenas luz. " +
    "Usa um celular Android com o leitor de tela TalkBack no dia a dia. Está em casa. Nunca usou este aplicativo antes.",
  vidente:
    "Adulto de 34 anos (personagem fictícia), enxerga normalmente e usa smartphone no dia a dia. " +
    "Está em casa. Nunca usou este aplicativo antes.",
};

export interface ActionOption {
  id: string;
  label: string;
}

export function systemPrompt(sheet: string, instruction: string): string {
  return [
    "Você vai operar um aplicativo de celular no lugar da pessoa descrita abaixo, para atender ao pedido dela.",
    "A cada passo você recebe somente o que essa pessoa percebe naquele momento e as ações que ela pode fazer agora.",
    "Escolha exatamente uma ação por passo, pelo identificador, e responda apenas com o JSON pedido.",
    "",
    `Pessoa: ${PERSONA_SHEETS[sheet]}`,
    `Pedido da pessoa: "${instruction}"`,
  ].join("\n");
}

export function userPrompt(stepNo: number, observation: string, actions: ActionOption[]): string {
  return [
    `Passo ${stepNo}.`,
    "Percepção atual:",
    observation,
    "",
    "Ações possíveis agora (identificador: descrição):",
    ...actions.map((a) => `- ${a.id}: ${a.label}`),
  ].join("\n");
}

/** JSON schema da resposta: a fala u: é um enum com as ações válidas DESTE estado. */
export function responseSchema(actionIds: string[]) {
  return {
    type: "object",
    properties: { acao: { type: "string", enum: actionIds } },
    required: ["acao"],
    additionalProperties: false,
  };
}

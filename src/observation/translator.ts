/**
 * Tradutor de observação o_t (Atividade 2.3; paridade de signos, Atividade 1.1).
 * Converte o estado da interface no texto que a pessoa perceberia — e só isso.
 * A correspondência signo-da-tela → texto está documentada em design/signs.yaml.
 *
 * Modos (config.yaml → conditions.<c>.observation):
 *   screen_reader       — o que o TalkBack anunciaria (perfil). Sujeito a SerialChannel e AudioBuffer.
 *   screen_reader_full  — leitor de tela sem limite serial/memória (agente genérico).
 *   full_visual         — tela visível + pré-visualização da câmera + cena vista (comparador vidente).
 *
 * Nunca entram em o_t: ids internos de objetos, alvo da tarefa, critério de sucesso,
 * confiança "verdadeira" não anunciada, objetos fora do quadro (exceto no modo visual,
 * em que a pessoa vidente os vê), parâmetros dos mecanismos.
 */
import { INICIO_CONTROLS, LAUNCHER_APPS, detectionPhrase, posWord, previewFrame } from "../app/fsm.js";
import type { AppState, Scene } from "../app/types.js";
import type { MechanismTrace, Mechanisms } from "../mechanisms/mechanisms.js";

export type ObservationMode = "screen_reader" | "screen_reader_full" | "full_visual";

export const SCREEN_TITLES: Record<string, string> = {
  launcher: "Tela inicial do celular (lista de aplicativos)",
  inicio: "Reconhecer objetos — tela inicial",
  camera: "Reconhecer objetos — Câmera",
  resultado: "Reconhecer objetos — Resultado",
  detalhes: "Reconhecer objetos — Detalhes do objeto",
  ajuda: "Reconhecer objetos — Ajuda",
  encerramento: "Fim",
};

/** Signos metalinguísticos: rótulo acessível de cada fala u: (o que o controle "diz" de si). */
export function actionLabel(id: string, s: AppState): string {
  const fixed: Record<string, string> = {
    proximo: "Deslizar para a direita (próximo item)",
    anterior: "Deslizar para a esquerda (item anterior)",
    ativar: "Tocar duas vezes no item em foco",
    atalho_camera: "Gesto de atalho: abrir direto a câmera do app",
    atalho_app: "Gesto de atalho: abrir o app Reconhecer objetos",
    mirar_esquerda: "Mover o celular para a esquerda",
    mirar_direita: "Mover o celular para a direita",
    aproximar: "Aproximar o celular do objeto",
    afastar: "Afastar o celular do objeto",
    tato: "Tocar o objeto com a mão",
    pegar_proxima: "Pegar o próximo objeto com a mão",
    capturar: "Botão Capturar",
    pedir_ajuda: "Botão Ajuda",
    voltar: "Botão Voltar",
    repetir: "Botão Repetir anúncio",
    mais_detalhes: "Botão Mais detalhes (item em foco)",
    confirmar: "Botão Confirmar objeto (item em foco)",
    nova_captura: "Botão Nova captura",
    ajuda_enquadrar: "Tópico de ajuda: como enquadrar o objeto",
    ajuda_navegar: "Tópico de ajuda: como percorrer o resultado",
    ajuda_confianca: "Tópico de ajuda: o que significa a porcentagem",
    ajuda_confirmar: "Tópico de ajuda: como confirmar o objeto",
    desistir: "Parar a tarefa (avisar que quer parar)",
  };
  if (id.startsWith("confirmar:")) {
    const d = s.result[Number(id.split(":")[1]) - 1];
    return `Tocar em Confirmar ao lado de "${d ? d.label : "?"}"`;
  }
  return fixed[id] ?? id;
}

export interface HistoryEntry {
  action: string;
  heard: string;
}

export function translate(
  s: AppState,
  scene: Scene,
  mode: ObservationMode,
  mech: Mechanisms,
  history: HistoryEntry[],
  trace: MechanismTrace[],
): string {
  const L: string[] = [];
  const buffered = (t: string, fresh: boolean) => (mode === "screen_reader" ? mech.bufferAnnouncement(t, fresh, trace) : t);

  L.push(`[Tela] ${SCREEN_TITLES[s.screen]}`);
  L.push(`[Último anúncio] ${buffered(s.announcement, s.repeated)}`);

  switch (s.screen) {
    case "launcher":
      L.push(`[Em foco] ${LAUNCHER_APPS[s.focus]}, aplicativo.`);
      if (mode === "full_visual") L.push(`[Na tela] aplicativos: ${LAUNCHER_APPS.join(", ")}.`);
      break;
    case "inicio":
      L.push(`[Em foco] ${INICIO_CONTROLS[s.focus]}, botão.`);
      if (mode === "full_visual") L.push(`[Na tela] botões: ${INICIO_CONTROLS.join(", ")}.`);
      break;
    case "camera":
      if (scene.mode === "table") L.push(`[Sua mira, pelo movimento do braço] celular apontado ${posWord(s.aim)}, distância ${s.zoom}.`);
      else L.push(`[Na sua mão] objeto ${s.held + 1} de ${scene.objects.length}; celular a distância ${s.zoom}.`);
      if (mode === "full_visual") {
        const pv = previewFrame(s, scene);
        L.push(`[Pré-visualização da câmera] ${pv.length ? pv.map((o) => o.label).join(", ") : "nenhum objeto no quadro"}.`);
        if (scene.mode === "table") L.push(`[Você vê à sua frente] ${scene.objects.map((o) => `${o.label} (${posWord(o.pos)})`).join("; ")}.`);
        else {
          const o = scene.objects[s.held];
          L.push(`[Você vê o objeto na mão] ${o.shape}, cor ${o.color}, rótulo impresso: "${o.text}".`);
        }
      }
      break;
    case "resultado":
      if (s.result.length === 0) L.push("[Resultado] lista vazia.");
      else if (mode === "screen_reader") {
        const d = s.result[s.resultFocus];
        L.push(`[Em foco] Item ${s.resultFocus + 1} de ${s.result.length}: ${detectionPhrase(d)}.`);
      } else {
        L.push(`[Lista na tela] ${s.result.map((d, i) => `${i + 1}. ${detectionPhrase(d)}`).join(" | ")}`);
      }
      break;
    case "detalhes":
    case "ajuda":
    default:
      break;
  }

  if (history.length) {
    L.push("[Passos anteriores, do mais antigo ao mais recente]");
    for (const h of history) L.push(`- você fez: ${h.action} → ouviu: ${buffered(h.heard, false)}`);
  }
  return L.join("\n");
}

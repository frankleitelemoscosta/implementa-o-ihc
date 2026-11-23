/**
 * Máquina de estados MoLIC da aplicação (Atividade 1.3 → 2.1).
 * Implementa design/molic.yaml: cada cena expõe falas u: (ações permitidas) e cada
 * transição devolve a fala d: do preposto. A aplicação é pura e determinística:
 * a aleatoriedade (erros de mira, deslizes) chega de fora como `Perturbation`,
 * decidida pelos mecanismos parametrizados do controlador.
 */
import type { AppState, Detection, Perturbation, Scene, SceneObject, StepResult } from "./types.js";

export const LAUNCHER_APPS = ["Telefone", "Mensagens", "Reconhecer objetos", "Câmera"];
export const INICIO_CONTROLS = ["Reconhecer objeto", "Ajuda"];
export const HELP_TEXTS: Record<string, string> = {
  ajuda_enquadrar:
    "Ajuda, enquadramento: segure o celular na altura do peito, a uns 40 centímetros do objeto. Use Mirar à esquerda ou à direita para varrer a mesa por partes. Afastar mostra mais objetos de uma vez; Aproximar melhora a leitura de um objeto só. Se ouvir 'nenhum objeto', mova a câmera e capture de novo.",
  ajuda_navegar:
    "Ajuda, resultado: depois da captura, os objetos ficam numa lista. Deslize para a direita (Próximo) ou para a esquerda (Anterior) para ouvir um item por vez. Repetir lê o anúncio inteiro de novo.",
  ajuda_confianca:
    "Ajuda, confiança: a porcentagem indica o quanto o app tem certeza. Abaixo de 75 por cento o app diz 'provavelmente'. Nesses casos, use Mais detalhes, aproxime e capture de novo, ou confira com o tato antes de confirmar.",
  ajuda_confirmar:
    "Ajuda, confirmar: com o item desejado em foco, toque duas vezes em Confirmar objeto. A confirmação encerra a busca.",
};

const ZOOM_WIDTH: Record<string, number> = { perto: 0, normal: 0, longe: 1 };

export function initialState(scene: Scene): AppState {
  return {
    screen: scene.start_screen,
    returnTo: scene.start_screen,
    focus: scene.start_screen === "launcher" ? 0 : 0,
    aim: scene.start_aim ?? 0,
    zoom: scene.start_zoom,
    held: scene.start_held ?? 0,
    frame: [],
    result: [],
    resultFocus: 0,
    captures: 0,
    verifications: {},
    helpTopic: null,
    confirmed: null,
    ended: null,
    announcement:
      scene.start_screen === "launcher"
        ? "Tela inicial do celular. Lista de aplicativos."
        : "Reconhecer objetos. Tela inicial.",
    repeated: false,
  };
}

/** Espaço de ações (falas u:) de cada cena — base, antes dos filtros de affordance. */
export function allowedActions(s: AppState, scene: Scene, opts: { serial: boolean }): string[] {
  if (s.ended) return [];
  switch (s.screen) {
    case "launcher":
      return ["proximo", "anterior", "ativar", "desistir"];
    case "inicio":
      return ["proximo", "anterior", "ativar", "desistir"];
    case "camera": {
      const a: string[] = [];
      if (scene.mode === "table") a.push("mirar_esquerda", "mirar_direita");
      if (scene.mode === "held") a.push("pegar_proxima");
      a.push("aproximar", "afastar", "tato", "capturar", "pedir_ajuda", "voltar", "desistir");
      return a;
    }
    case "resultado": {
      const a: string[] = [];
      if (s.result.length > 0) {
        if (opts.serial) a.push("proximo", "anterior", "confirmar");
        else s.result.forEach((_, i) => a.push(`confirmar:${i + 1}`));
        a.push("mais_detalhes");
      }
      a.push("repetir", "nova_captura", "pedir_ajuda", "desistir");
      return a;
    }
    case "detalhes":
      return ["repetir", "confirmar", "voltar", "desistir"];
    case "ajuda":
      return [...Object.keys(HELP_TEXTS), "voltar", "desistir"];
    default:
      return [];
  }
}

function pct(c: number): string {
  return `${Math.round(c * 100)} por cento`;
}

export function detectionPhrase(d: Detection): string {
  return d.conf < 0.75 ? `${d.label}, provavelmente, ${pct(d.conf)}` : `${d.label}, ${pct(d.conf)}`;
}

export function announce(result: Detection[]): string {
  if (result.length === 0) return "Nenhum objeto reconhecido. Tente mover a câmera ou afastar.";
  const n = result.length;
  const head = n === 1 ? "Um objeto reconhecido" : `${n} objetos reconhecidos`;
  return `${head}: ${result.map(detectionPhrase).join("; ")}.`;
}

function posWord(pos: number | undefined): string {
  if (pos === undefined) return "na sua mão";
  if (pos <= -2) return "bem à esquerda";
  if (pos === -1) return "à esquerda";
  if (pos === 0) return "ao centro";
  if (pos === 1) return "à direita";
  return "bem à direita";
}

function objById(scene: Scene, id: string): SceneObject {
  const o = scene.objects.find((x) => x.id === id);
  if (!o) throw new Error(`objeto ${id} não existe em ${scene.id}`);
  return o;
}

function capture(s: AppState, scene: Scene, p: Perturbation): { frame: string[]; result: Detection[] } {
  let objs: SceneObject[];
  if (scene.mode === "table") {
    const eff = Math.max(-2, Math.min(2, s.aim + (p.captureShift ?? 0)));
    const w = ZOOM_WIDTH[s.zoom];
    objs = scene.objects.filter((o) => Math.abs((o.pos ?? 0) - eff) <= w).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  } else {
    objs = p.captureMiss ? [] : [scene.objects[s.held]];
  }
  const result = objs.map((o): Detection => {
    let conf = o.conf;
    let label = o.label;
    if (s.zoom === "perto") {
      conf = o.conf_near ?? Math.min(0.98, o.conf + 0.05);
      label = o.label_near ?? o.label;
    } else if (s.zoom === "longe") {
      conf = Math.max(0.3, o.conf - 0.12);
    }
    if (s.captures === 0 && scene.script?.first_capture_conf !== undefined) conf = scene.script.first_capture_conf;
    return { id: o.id, label, conf: Math.round(conf * 100) / 100 };
  });
  return { frame: objs.map((o) => o.id), result };
}

function detailsText(scene: Scene, d: Detection): string {
  const o = objById(scene, d.id);
  const txt = o.text ? `Texto no rótulo: "${o.text}"` : "Sem texto impresso legível";
  return `Detalhes: ${d.label}. Cor: ${o.color}. Forma: ${o.shape}. ${txt}. Posição: ${posWord(o.pos)}.`;
}

/** Executa uma fala u: válida e devolve o novo estado e a fala d:. */
export function step(prev: AppState, scene: Scene, action: string, p: Perturbation = {}): StepResult {
  const s: AppState = structuredClone(prev);
  s.repeated = false;
  const r = (d: string, event_type: string, support?: StepResult["support"]): StepResult => {
    s.announcement = d;
    return { state: s, d, event_type, support };
  };

  if (action === "desistir") {
    s.ended = "give_up";
    s.screen = "encerramento";
    return r("Tarefa encerrada pela pessoa.", "give_up");
  }

  switch (s.screen) {
    case "launcher": {
      if (action === "proximo" || action === "anterior") {
        const delta = (action === "proximo" ? 1 : -1) * (p.overshoot ? 2 : 1);
        s.focus = (s.focus + delta + LAUNCHER_APPS.length) % LAUNCHER_APPS.length;
        return r(`${LAUNCHER_APPS[s.focus]}, aplicativo.`, "focus_move");
      }
      if (action === "ativar") {
        if (LAUNCHER_APPS[s.focus] === "Reconhecer objetos") {
          s.screen = "inicio";
          s.focus = 0;
          return r("Reconhecer objetos. Tela inicial. Reconhecer objeto, botão.", "activate");
        }
        return r(`${LAUNCHER_APPS[s.focus]} aberto e fechado em seguida; você continua na lista de aplicativos.`, "activate");
      }
      if (action === "atalho_app") {
        s.screen = "inicio";
        s.focus = 0;
        return r("Atalho: Reconhecer objetos. Tela inicial. Reconhecer objeto, botão.", "shortcut_used");
      }
      break;
    }
    case "inicio": {
      if (action === "proximo" || action === "anterior") {
        const delta = (action === "proximo" ? 1 : -1) * (p.overshoot ? 2 : 1);
        s.focus = (s.focus + delta + INICIO_CONTROLS.length * 4) % INICIO_CONTROLS.length;
        return r(`${INICIO_CONTROLS[s.focus]}, botão.`, "focus_move");
      }
      if (action === "ativar") {
        if (INICIO_CONTROLS[s.focus] === "Ajuda") {
          s.returnTo = "inicio";
          s.screen = "ajuda";
          return r("Ajuda. Escolha o tipo de dúvida: enquadramento, resultado, confiança ou confirmar.", "activate");
        }
        s.screen = "camera";
        return r("Câmera aberta. Aponte para o objeto e toque em Capturar.", "activate");
      }
      if (action === "atalho_camera") {
        s.screen = "camera";
        return r("Atalho: câmera aberta. Aponte para o objeto e toque em Capturar.", "shortcut_used");
      }
      break;
    }
    case "camera": {
      if (action === "mirar_esquerda" || action === "mirar_direita") {
        const delta = (action === "mirar_direita" ? 1 : -1) * (p.overshoot ? 2 : 1);
        const next = Math.max(-2, Math.min(2, s.aim + delta));
        const hitLimit = next === s.aim;
        s.aim = next;
        if (hitLimit) return r(`Limite: a câmera já está ${posWord(s.aim)}.`, "aim_move");
        return r(`Câmera movida ${action === "mirar_direita" ? "para a direita" : "para a esquerda"}.`, "aim_move");
      }
      if (action === "aproximar") {
        s.zoom = s.zoom === "longe" ? "normal" : "perto";
        return r(s.zoom === "perto" ? "Câmera perto do objeto." : "Câmera na distância normal.", "aim_move");
      }
      if (action === "afastar") {
        s.zoom = s.zoom === "perto" ? "normal" : "longe";
        return r(s.zoom === "longe" ? "Câmera afastada, quadro mais amplo." : "Câmera na distância normal.", "aim_move");
      }
      if (action === "pegar_proxima") {
        s.held = (s.held + 1) % scene.objects.length;
        s.zoom = "normal";
        return r("Você pegou outro objeto.", "aim_move");
      }
      if (action === "tato") {
        let o: SceneObject | undefined;
        if (scene.mode === "held") o = scene.objects[s.held];
        else o = scene.objects.find((x) => x.pos === s.aim);
        if (!o) return r("Ao tato: nada ao alcance da mão nesta direção.", "support", "tactile");
        s.verifications[o.id] = (s.verifications[o.id] ?? 0) + 1;
        return r(`Ao tato: ${o.shape}.`, "support", "tactile");
      }
      if (action === "capturar") {
        const seenBefore = new Set(s.result.map((d) => d.id));
        const { frame, result } = capture(s, scene, p);
        s.captures += 1;
        s.frame = frame;
        s.result = result;
        s.resultFocus = 0;
        for (const d of result) if (seenBefore.has(d.id)) s.verifications[d.id] = (s.verifications[d.id] ?? 0) + 1;
        s.screen = "resultado";
        return r(announce(result), "capture");
      }
      if (action === "pedir_ajuda") {
        s.returnTo = "camera";
        s.screen = "ajuda";
        return r("Ajuda. Escolha o tipo de dúvida: enquadramento, resultado, confiança ou confirmar.", "support", "help");
      }
      if (action === "voltar") {
        s.screen = "inicio";
        s.focus = 0;
        return r("Reconhecer objetos. Tela inicial. Reconhecer objeto, botão.", "activate");
      }
      break;
    }
    case "resultado": {
      const n = s.result.length;
      if ((action === "proximo" || action === "anterior") && n > 0) {
        const delta = (action === "proximo" ? 1 : -1) * (p.overshoot ? 2 : 1);
        const raw = s.resultFocus + delta;
        const wrapped = raw < 0 || raw >= n;
        s.resultFocus = ((raw % n) + n) % n;
        const d = s.result[s.resultFocus];
        return r(`${wrapped ? "Volta ao início da lista. " : ""}Item ${s.resultFocus + 1} de ${n}: ${detectionPhrase(d)}.`, "focus_move");
      }
      if (action === "repetir") {
        const t = announce(s.result);
        s.repeated = true;
        return r(t, "support", "repeat");
      }
      if (action === "mais_detalhes" && n > 0) {
        const d = s.result[s.resultFocus];
        s.verifications[d.id] = (s.verifications[d.id] ?? 0) + 1;
        s.screen = "detalhes";
        return r(detailsText(scene, d), "support", "details");
      }
      if (action === "confirmar" && n > 0) {
        return confirmObj(s, s.result[s.resultFocus], r);
      }
      if (action.startsWith("confirmar:")) {
        const d = s.result[Number(action.split(":")[1]) - 1];
        if (d) return confirmObj(s, d, r);
      }
      if (action === "nova_captura") {
        s.screen = "camera";
        return r("Câmera aberta. Aponte para o objeto e toque em Capturar.", "activate");
      }
      if (action === "pedir_ajuda") {
        s.returnTo = "resultado";
        s.screen = "ajuda";
        return r("Ajuda. Escolha o tipo de dúvida: enquadramento, resultado, confiança ou confirmar.", "support", "help");
      }
      break;
    }
    case "detalhes": {
      const d = s.result[s.resultFocus];
      if (action === "repetir") {
        s.repeated = true;
        return r(detailsText(scene, d), "support", "repeat");
      }
      if (action === "confirmar") return confirmObj(s, d, r);
      if (action === "voltar") {
        s.screen = "resultado";
        return r(`Resultado. Item ${s.resultFocus + 1} de ${s.result.length}: ${detectionPhrase(d)}.`, "activate");
      }
      break;
    }
    case "ajuda": {
      if (action in HELP_TEXTS) {
        s.helpTopic = action;
        return r(HELP_TEXTS[action], "support", "help");
      }
      if (action === "voltar") {
        s.screen = s.returnTo;
        s.helpTopic = null;
        const back: Record<string, string> = {
          inicio: "Reconhecer objetos. Tela inicial. Reconhecer objeto, botão.",
          camera: "Câmera aberta. Aponte para o objeto e toque em Capturar.",
          resultado: s.result.length ? `Resultado. ${announce(s.result)}` : "Resultado vazio.",
        };
        return r(back[s.screen] ?? "Voltar.", "activate");
      }
      break;
    }
  }
  throw new Error(`ação inválida "${action}" na cena ${s.screen}`);
}

function confirmObj(s: AppState, d: Detection, r: (d: string, e: string) => StepResult): StepResult {
  s.confirmed = d.id;
  s.ended = "confirmed";
  s.screen = "encerramento";
  return r(`Objeto confirmado: ${d.label}.`, "confirm");
}

/** Objetos que estariam no quadro sem erro de mira (usado só pela pré-visualização VISUAL do comparador). */
export function previewFrame(s: AppState, scene: Scene): SceneObject[] {
  if (scene.mode === "held") return [scene.objects[s.held]];
  const w = ZOOM_WIDTH[s.zoom];
  return scene.objects.filter((o) => Math.abs((o.pos ?? 0) - s.aim) <= w).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
}

export { posWord };

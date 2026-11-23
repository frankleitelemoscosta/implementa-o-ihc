/** Tipos da aplicação interativa (simulador do app assistivo de reconhecimento de objetos). */

export type Screen = "launcher" | "inicio" | "camera" | "resultado" | "detalhes" | "ajuda" | "encerramento";
export type Zoom = "perto" | "normal" | "longe";

export interface SceneObject {
  id: string;
  label: string;
  label_near?: string;
  pos?: number;
  color: string;
  shape: string;
  text: string;
  conf: number;
  conf_near?: number;
}

export interface Scene {
  id: string;
  set: "calibration" | "validation" | "training";
  mode: "table" | "held";
  start_screen: Screen;
  start_aim?: number;
  start_held?: number;
  start_zoom: Zoom;
  script?: { first_capture_conf?: number };
  objects: SceneObject[];
}

export interface Detection {
  id: string;
  label: string;
  conf: number;
}

export type EndReason = "confirmed" | "give_up" | "interrupted" | "tech_failure";

export interface AppState {
  screen: Screen;
  /** cena de origem quando se entra na Ajuda */
  returnTo: Screen;
  /** índice de foco nos controles da tela (launcher/início) */
  focus: number;
  /** posição da câmera (modo mesa), -2..+2 */
  aim: number;
  zoom: Zoom;
  /** objeto na mão (modo held) */
  held: number;
  /** objetos efetivamente no quadro na última captura (verdade do mundo; só para o log) */
  frame: string[];
  result: Detection[];
  resultFocus: number;
  captures: number;
  /** verificações feitas por objeto (detalhes, tato, recaptura de perto) */
  verifications: Record<string, number>;
  helpTopic: string | null;
  confirmed: string | null;
  ended: EndReason | null;
  /** último anúncio do sistema (fala d:) */
  announcement: string;
  /** o anúncio foi repetido neste passo (AudioBuffer libera a lista completa) */
  repeated: boolean;
}

/** Perturbações decididas pelos mecanismos externos ANTES do passo (o app é puro). */
export interface Perturbation {
  /** AimNoise: deslocamento do quadro na captura (0 = sem erro) */
  captureShift?: number;
  /** AimNoise (modo held): quadro sem o objeto */
  captureMiss?: boolean;
  /** Slip: o gesto passa do alvo (move 2 em vez de 1) */
  overshoot?: boolean;
}

export interface StepResult {
  state: AppState;
  /** fala d: do preposto (o que a interface "diz") */
  d: string;
  event_type: string;
  support?: "repeat" | "details" | "help" | "tactile";
}

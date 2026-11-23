/**
 * Gera o Anexo E1 — Caderno de Especificação de Design — a partir dos artefatos
 * versionados em design/ (fonte única: o caderno nunca diverge da especificação).
 *   npm run caderno            → caderno/caderno.tex   (compilar com XeLaTeX ou tectonic)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ROOT } from "../core/config.js";
import { klmBaseline } from "../analysis/metrics.js";

const D = (f: string) => readFileSync(path.join(ROOT, "design", f), "utf8");
const signs = YAML.parse(D("signs.yaml"));
const molic = YAML.parse(D("molic.yaml"));
const errors = YAML.parse(D("errors.yaml"));
const help = YAML.parse(D("help.yaml"));
const klm = YAML.parse(D("klm.yaml"));
const tasks = YAML.parse(D("tasks.yaml")).tasks;
const ctt = D("ctt.md");

/** Escapa texto comum para LaTeX. */
function t(s: unknown): string {
  return String(s ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/≥/g, "$\\geq$")
    .replace(/≤/g, "$\\leq$")
    .replace(/≠/g, "$\\neq$")
    .replace(/θ/g, "$\\theta$")
    .replace(/ρ/g, "$\\rho$")
    .replace(/≫/g, "$\\gg$")
    .replace(/→/g, "$\\rightarrow$")
    .replace(/×/g, "$\\times$")
    .replace(/…/g, "\\ldots{}")
    .replace(/--/g, "-{}-")
    .replace(/`([^`]+)`/g, "\\texttt{$1}")
    .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}");
}
const tt = (s: unknown) => `\\texttt{${t(s)}}`;
const list = (v: unknown) => (Array.isArray(v) ? v.map(t).join(", ") : t(v));

// ---------------- 1.1 Metamensagem e paridade ----------------
const parityRows = (signs.parity as Record<string, string>[])
  .map((p) => `${t(p.signo)} & ${t(p.classe)} & ${t(p.tela_humano)} & ${t(p.o_t)} & ${t(p.restrito)}\\\\`)
  .join("\n\\midrule\n");

// ---------------- 1.2 CTT (blocos de código do ctt.md) ----------------
function cttSections(): string {
  const out: string[] = [];
  const re = /^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
  for (const m of ctt.matchAll(re)) {
    const title = m[1].trim();
    if (/GOMS|KLM/.test(title)) continue;
    const code = /```\n([\s\S]*?)```/.exec(m[2]);
    if (!code) continue;
    const body = code[1].replace(/≫/g, ">>");
    out.push(`\\subsection*{${t(title)}}\n\\begin{Verbatim}[fontsize=\\footnotesize,frame=single]\n${body}\\end{Verbatim}`);
  }
  return out.join("\n\n");
}
const cttLegend = ctt
  .split("\n")
  .filter((l) => /^- `/.test(l))
  .map((l) => `\\item ${t(l.slice(2))}`)
  .join("\n");

// ---------------- 1.2 KLM ----------------
function klmTable(): string {
  const rows: string[] = [];
  for (const id of ["C1", "C2"]) {
    const b = klmBaseline(id);
    const k = klm.baselines[id];
    rows.push(
      `${id} & ${t(k.method)} & ${tt(b?.ops ?? "")} & ${k.actions} & ${b ? b.seconds.toFixed(2).replace(".", "{,}") : "--"}\\\\`,
    );
  }
  return rows.join("\n\\midrule\n");
}

// ---------------- 1.3 MoLIC ----------------
const POS: Record<string, string> = {
  abertura: "(0,0)",
  inicio: "(4,0)",
  launcher: "(0,-4.2)",
  camera: "(11,0)",
  resultado: "(11,-4.6)",
  detalhes: "(18.5,-4.6)",
  encerramento: "(18.5,0)",
  ajuda: "(4,-8)",
};
const LABEL: Record<string, string> = {
  abertura: "Abertura",
  launcher: "Launcher",
  inicio: "Início",
  camera: "Câmera",
  resultado: "Resultado",
  detalhes: "Detalhes",
  ajuda: "Ajuda",
  encerramento: "Encerramento",
};
function molicDiagram(): string {
  const scenes = molic.scenes as Record<string, { topic: string; u: Record<string, { to: string }> }>;
  const nodes: string[] = [];
  const edges = new Map<string, string[]>();
  for (const [sid, sc] of Object.entries(scenes)) {
    const self: string[] = [];
    for (const [u, tr] of Object.entries(sc.u)) {
      if (u === "desistir") continue; // desativação global, desenhada à parte
      for (let to of String(tr.to).split("|")) {
        if (to.startsWith("<")) to = "*";
        if (to === sid) self.push(u);
        else {
          const k = `${sid}>${to}`;
          edges.set(k, [...(edges.get(k) ?? []), u]);
        }
      }
    }
    const loops = self.length ? `\\\\[1pt]{\\tiny ${self.map((u) => t(u)).join(", ")}}` : "";
    nodes.push(`\\node[cena] (${sid}) at ${POS[sid]} {\\textbf{${LABEL[sid]}}\\\\{\\scriptsize ${t(sc.topic)}}${loops}};`);
  }
  nodes.push(`\\node[abre] (abertura) at ${POS.abertura} {};`);
  nodes.push(`\\node[fecha] (encerramento) at ${POS.encerramento} {};`);
  nodes.push(`\\node[font=\\scriptsize, above=1pt of encerramento] {Encerramento};`);
  const draw: string[] = [`\\draw[->] (abertura) -- node[lbl,above]{d: tela inicial} (inicio);`];
  const bend: Record<string, string> = {
    "camera>inicio": "bend right=18",
    "resultado>camera": "bend right=30",
    "detalhes>resultado": "bend left=25",
    "inicio>ajuda": "bend right=10",
    "camera>ajuda": "",
    "resultado>ajuda": "bend left=12",
  };
  const where: Record<string, string> = { "camera>resultado": "left", "resultado>camera": "right" };
  for (const [k, us] of edges) {
    const [from, to] = k.split(">");
    if (to === "*") {
      draw.push(`\\draw[->,dashed] (${from}.west) -- ++(-0.9,0) node[lbl,left,align=right]{${us.map(t).join(", ")}\\\\(volta à cena de origem)};`);
      continue;
    }
    if (!POS[to]) continue;
    const b = bend[k] ?? "";
    draw.push(`\\draw[->] (${from}) to[${b}] node[lbl${where[k] ? "," + where[k] : ""}]{${us.map(t).join(", ")}} (${to});`);
  }
  return [...nodes, ...draw].join("\n");
}
function molicTable(): string {
  const scenes = molic.scenes as Record<string, { u: Record<string, Record<string, string>> }>;
  const rows: string[] = [];
  for (const [sid, sc] of Object.entries(scenes)) {
    for (const [u, tr] of Object.entries(sc.u)) {
      rows.push(`${LABEL[sid]} & ${tt(u)} & ${t(tr.d)} & ${t(tr.to)} & ${tt(tr.event)}${tr.support ? ` (${t(tr.support)})` : ""} & ${t(tr.condition ?? tr.mode ?? "")}\\\\`);
    }
  }
  return rows.join("\n");
}

// ---------------- 1.4 Matriz de erros, ajuda, MAC ----------------
function errorTable(): string {
  return Object.entries(errors.operations as Record<string, Record<string, unknown>>)
    .map(([op, e]) => {
      const mac = e.MAC as { tag: string; assinatura: string } | undefined;
      return `${t(op)} & ${t(e.erro ?? "--")} & ${t(e.PP ?? "--")} & ${t(e.PA ?? "--")} & ${t(e.AL ?? "--")} & ${t(e.RA ?? "--")} & ${t(e.CE ?? "--")} & ${mac ? `\\textit{${t(mac.tag)}}: ${t(mac.assinatura)}` : "--"}\\\\`;
    })
    .join("\n\\midrule\n");
}
const helpRows = (help.strata as Record<string, unknown>[])
  .map((h) => `${t(h.tipo)} & ${list(h.fala_u)} & ${list(h.support ?? "help")}\\\\`)
  .join("\n");
const helpRules = (help.rules as string[]).map((r) => `\\item ${t(r)}`).join("\n");

const taskRows = Object.entries(tasks as Record<string, Record<string, unknown>>)
  .map(([id, k]) => `${id} & ${t(k.set === "calibration" ? "calibração" : "validação (reservada)")} & ${t(k.instruction)} & ${tt(k.scene)}\\\\`)
  .join("\n");

const tex = String.raw`% !TEX program = xelatex
% ARQUIVO GERADO por "npm run caderno" a partir de design/*.yaml e design/ctt.md — não editar à mão.
\documentclass[a4paper,10pt]{article}
\usepackage[margin=1.8cm,landscape]{geometry}
\usepackage{fontspec}
\setmonofont{DejaVu Sans Mono}[Scale=0.85]
\usepackage[brazil]{babel}
\usepackage{booktabs,longtable,array,tabularx,fancyvrb,xcolor,hyperref}
\usepackage{tikz}
\usetikzlibrary{positioning,arrows.meta,shapes.misc}
\hypersetup{colorlinks,linkcolor=blue!50!black,urlcolor=blue!50!black}
\newcolumntype{L}[1]{>{\raggedright\arraybackslash}p{#1}}
\renewcommand{\arraystretch}{1.15}
\title{Anexo E1 --- Caderno de Especificação de Design\\\large UX-Agent: aplicativo assistivo de reconhecimento de objetos}
\author{Frank Leite Lemos Costa, João Paulo da Cunha Faria, Alvaro Augusto José Silva\\IHC --- CEFET-MG, Campus Divinópolis}
\date{Gerado a partir de \texttt{design/} do repositório (E2)}
\begin{document}
\maketitle
\noindent Este caderno é o apêndice do artigo (E4). Todo o conteúdo é \textbf{artefato do analista}: nada daqui é enviado ao agente proxy, e a auditoria \texttt{npm run check-leak} verifica isso nos prompts registrados. Cada seção indica o arquivo-fonte e o módulo que o implementa.

\tableofcontents

\section{Tarefas (herdadas da Modelagem)}
\begin{tabularx}{\linewidth}{l L{3.2cm} X l}
\toprule
Id & Conjunto & Instrução literal (única parte enviada ao agente) & Cena\\
\midrule
${taskRows}
\bottomrule
\end{tabularx}

\medskip\noindent Os critérios de sucesso ficam em \texttt{design/tasks.yaml} e são lidos \emph{apenas} pelo verificador externo (\texttt{src/verifier/verify.ts}). As cenas de V1 e V2 só carregam com \texttt{--validation} e com o \texttt{config.yaml} congelado.

\section{Atividade 1.1 --- Metamensagem e Tabela de Paridade de Signos}
\emph{Fonte:} \texttt{design/signs.yaml}. \emph{Implementação:} \texttt{src/observation/translator.ts} (o$_t$) e \texttt{src/app/fsm.ts} (falas d:).

\subsection{Metamensagem para os dois receptores}
\textbf{Receptor humano (Marina):} ${t(signs.metamessage.human)}

\smallskip\noindent\textbf{Receptor agente proxy:} ${t(signs.metamessage.agent)}

\subsection{Tabela de paridade de signos}
Classes de signo segundo a Engenharia Semiótica: estático, dinâmico e metalinguístico. A coluna “restrito” declara o que \emph{não} pode aparecer em o$_t$.
\begin{longtable}{L{3cm} L{2.2cm} L{5cm} L{7cm} L{6cm}}
\toprule
Signo & Classe & Na tela (pessoa) & Em o$_t$ (agente) & Restrito / não enviado\\
\midrule\endhead
${parityRows}
\bottomrule
\end{longtable}
\noindent\textbf{Nunca em o$_t$:} ${list(signs.never_in_o_t)}. \textbf{Auditoria:} ${t(signs.audit)}.

\section{Atividade 1.2 --- Refinamento em CTT e linha de base GOMS/KLM}
\emph{Fonte:} \texttt{design/ctt.md} e \texttt{design/klm.yaml}. Notação de Paternò (Dix et al., 2004):
\begin{itemize}\setlength\itemsep{0pt}
${cttLegend}
\end{itemize}
Nos diagramas abaixo, em fonte monoespaçada, $\gg$ aparece como \texttt{>{}>}. Tipos de tarefa: (U) usuário, (I) interação, (S) sistema, (A) abstrata. Cada folha (I) é uma fala u: da MoLIC; cada folha (S), uma fala d:.

${cttSections()}

\subsection*{Linha de base GOMS/KLM de especialista}
Operadores: K = 0,28\,s, M = 1,35\,s, P = 1,10\,s e R = duração da fala d: (palavras $\div$ 3 por segundo). Os valores abaixo são calculados reexecutando o método ideal no próprio FSM (\texttt{klmBaseline} em \texttt{src/analysis/metrics.ts}), e não digitados à mão.

\begin{tabularx}{\linewidth}{l X L{6.5cm} c c}
\toprule
Tarefa & Método (especialista, sem erros) & Operadores por ação & Ações & $T_{KLM}$ (s)\\
\midrule
${klmTable()}
\bottomrule
\end{tabularx}

\smallskip\noindent O tempo KLM é a linha de base \emph{ideal} (especialista, sem erros) e não é atribuído à persona. O tempo simulado do agente (mecanismo Hesitation) é hipótese operacional e só é comparado como razão $T_{sim}/T_{KLM}$. V1 e V2 têm só a contagem de ações da HTA congelada (${klm.baselines.V1.actions} e ${klm.baselines.V2.actions}), usada no limite de interrupção.

\clearpage
\section{Atividade 1.3 --- Modelagem da conversa em MoLIC}
\emph{Fonte:} \texttt{design/molic.yaml}. \emph{Implementação:} \texttt{src/app/fsm.ts}, testada contra a especificação (toda fala u: oferecida pelo FSM tem de estar declarada na MoLIC). Papel de usuário único: pessoa usuária do app (Marina ou comparador vidente). As falas u: de cada cena são exatamente o \emph{enum} da saída estruturada do LLM naquele estado.

\begin{center}
\begin{tikzpicture}[>=Stealth, font=\footnotesize,
  cena/.style={draw, rounded rectangle, align=center, fill=blue!6, inner sep=4pt, text width=3.6cm},
  abre/.style={circle, fill=black, minimum size=4mm},
  fecha/.style={circle, draw, double, double distance=1.2pt, fill=black, minimum size=4mm},
  lbl/.style={font=\scriptsize\ttfamily, fill=white, inner sep=1.5pt, align=center}]
${molicDiagram()}
\node[draw, red!60!black, dashed, font=\scriptsize, text width=5cm, align=center] at (16,-8) {\texttt{desistir} em qualquer cena $\rightarrow$ Encerramento\\(desativação global [>, evento \texttt{give\_up})};
\end{tikzpicture}
\end{center}
\noindent Laços (falas que permanecem na cena) aparecem em letra miúda dentro de cada cena. Setas tracejadas: retorno à cena de origem (Ajuda $\rightarrow$ cena anterior).

\subsection*{Falas u: e d: por cena, ligadas aos eventos do log}
\begin{longtable}{l l L{7.5cm} L{2.6cm} L{3.4cm} L{5.2cm}}
\toprule
Cena & Fala u: & Fala d: (preposto do designer) & Vai para & Evento no log & Condição / mecanismo\\
\midrule\endhead
${molicTable()}
\bottomrule
\end{longtable}

\subsection*{Falas de ruptura do preposto}
\begin{itemize}\setlength\itemsep{0pt}
${Object.entries(molic.breakdown_utterances as Record<string, string>).map(([k, v]) => `\\item ${tt(k)}: ${t(v)}`).join("\n")}
\end{itemize}

\section{Atividade 1.4 --- Matriz de rupturas, ajuda sob demanda e mapeamento MAC}
\emph{Fonte:} \texttt{design/errors.yaml} e \texttt{design/help.yaml}. \emph{Implementação das assinaturas:} \texttt{src/analysis/mac.ts}. PP = prevenção passiva; PA = prevenção ativa; AL = prevenção apoiada; RA = recuperação apoiada; CE = captura de erro. Operações conforme a HTA congelada.

\begin{longtable}{L{2.6cm} L{2.8cm} L{3.2cm} L{2.6cm} L{2.8cm} L{2.4cm} L{3cm} L{4.2cm}}
\toprule
Operação (HTA) & Erro previsto & PP & PA & AL & RA & CE & Ruptura MAC: assinatura no log\\
\midrule\endhead
${errorTable()}
\bottomrule
\end{longtable}

\noindent As rupturas são detectadas \textbf{apenas} por assinaturas na sequência de eventos do log. É vedado inferi-las do texto que o LLM produz.

\subsection*{Ajuda sob demanda estratificada por tipo de dúvida}
\begin{tabularx}{\linewidth}{X L{6cm} L{5cm}}
\toprule
Tipo de dúvida & Fala u: que dá acesso & Registro (\texttt{support})\\
\midrule
${helpRows}
\bottomrule
\end{tabularx}
\begin{itemize}\setlength\itemsep{0pt}
${helpRules}
\end{itemize}

\end{document}
`;

const outDir = path.join(ROOT, "caderno");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "caderno.tex"), tex);
console.log(`E1 gerado: ${path.join(outDir, "caderno.tex")} (compile com xelatex ou tectonic)`);

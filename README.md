# UX-Agent: agente proxy LLM instrumentado para um app assistivo de reconhecimento de objetos

Trabalho da disciplina Interação Humano-Computador (CEFET-MG, Divinópolis), Fase P3 (Partes I e II).

**Autores:** Frank Leite Lemos Costa, João Paulo da Cunha Faria e Alvaro Augusto José Silva.

O UX-Agent opera um simulador do aplicativo assistivo no lugar da persona **Marina** (fictícia: cega, usuária de TalkBack) e gera **dados sintéticos** auditáveis. A cada passo:

1. O agente recebe só o que a pessoa perceberia (o_t).
2. Escolhe uma fala u: válida no estado atual da MoLIC.
3. Os mecanismos comportamentais rodam **fora do prompt**, com parâmetros sorteados por semente.
4. Um verificador **externo** decide o sucesso pelo estado final da interface.

> Todo resultado é sintético e não representa o desempenho de pessoas com deficiência visual (ver Modelagem, Seç. XII).

## Instalação

Requisitos: Node.js ≥ 20.12 e **um** destes para o agente LLM:

- uma chave da API Anthropic (`--agent llm`, padrão); ou
- o [Ollama](https://ollama.com) rodando localmente, sem chave e sem custo (`--agent ollama`): `ollama serve` e `ollama pull llama3`. O modelo e o host ficam em `config.yaml` → `ollama`. Esse caminho é um desvio da Modelagem, que prevê `claude-sonnet-5-5`, e deve ser registrado no artigo.

```bash
npm install
cp .env.example .env      # preencha ANTHROPIC_API_KEY=...
npm test                  # 16 testes (FSM, amostrador, mecanismos, trava, verificador, MAC, vazamento)
```

## Execução

| Comando | O que faz |
|---|---|
| `npm run pilot -- --pilot --runs 10 --seed 1000 --out runs/pilot` | Piloto completo: C1, C2 × perfil, comparador, genérico × 10 sementes (LLM) |
| `npm run pilot -- --task C1 --condition perfil --runs 1` | Uma execução com o LLM |
| `npm run pilot -- --task C1 --condition comparador` | **Agente neutro de comparação**: mecanismos desligados, observação visual completa |
| `npm run pilot -- --pilot --agent ollama --runs 10 --seed 1000 --out runs/pilot` | Piloto completo com LLM **local** (Ollama), sem chave de API |
| `npm run pilot -- --task C1,C2 --agent rules --runs 3` | Executor por regras (método GOMS), sem API e sem custo |
| `npm run verify -- runs/pilot` | Verificador externo, que grava `verification.jsonl` |
| `npm run metrics -- runs/pilot` | Métricas (S, A, ΔA, U, AI, R_enq, T_sim/T_KLM, L), rupturas MAC e tabelas LaTeX |
| `npm run check-leak -- runs/pilot` | Audita os prompts enviados em busca de HTA, critério, ids, parâmetros e dados de V1/V2 |
| `npm run package-e3 -- runs/pilot` | Gera `pilot/E3.zip` (logs JSON, prompts, dicionário e métricas). Use `--config <arquivo>` para anexar o config exato usado no piloto |
| `npm run web` | Interface em http://localhost:5173: assistir o agente ao vivo (vídeo E5) ou operar como pessoa |
| `npm run caderno` | Gera o Anexo E1 (`caderno/caderno.tex`) a partir de `design/`; compile com XeLaTeX ou `tectonic caderno/caderno.tex` |
| `npm run freeze` | Congela o `config.yaml` (hash). Pré-requisito para rodar V1/V2 com `--validation` |

## Parâmetros, sementes e condições

Tudo fica em `config/config.yaml`. Seu SHA-256 é gravado em cada evento.

- **Sementes:** `--seed N` usa N, N+1, …, N+runs−1. A mesma semente sorteia os mesmos θ em todas as condições (pareamento).
- **θ sorteados por execução** (main.pdf, Tab. VIII), gravados em `task_start.event_data.params`:
  - `buffer_k` ~ U{3,4,5}
  - `p_enq` ~ Beta(3,7)
  - `ρ` ~ U[0,3; 0,7]
  - `θ` ~ U[0,6; 0,8]
  - `r` ~ U{1,2}
  - `q` ~ U[0; 0,2]
  - experiência (30/40/30) → `p_at` (Beta por nível)
  - `p_slip` ~ Beta(1,19)
  - `σ` de hesitação
  - limite de capturas ~ U{5..8}
- **Condições:**
  - `perfil`: todos os mecanismos e observação de leitor de tela.
  - `comparador`: agente neutro. Ficha de adulto vidente, sem mecanismos (exceto o tempo simulado), observação visual.
  - `generico`: ficha da Marina no prompt, sem mecanismos. É o controle de "encenação".
- **LLM do piloto:** `qwen2.5:7b` local via Ollama (`--agent ollama`, bloco `ollama:` do config), temperatura 0,7, uma requisição independente por passo e saída estruturada (JSON schema) com `enum` das falas válidas, precedida de um campo curto `raciocinio`.
- **LLM alternativo:** `claude-sonnet-5-5` (`--agent llm`, bloco `llm:`), previsto na Modelagem e implementado, mas não usado no piloto por exigir chave de API paga.
- **Limites do protocolo:**
  - O controlador interrompe a execução após min(25, 3 × linha de base) ações.
  - Falhas técnicas (timeout > 120 s no Ollama ou > 30 s no Claude, servidor fora do ar, recusa, formato inválido) viram `tech_failure` e não contam como erro de interação.
  - Cada `--out` recebe um único piloto: o comando recusa uma pasta que já tem `manifest.jsonl`, para não misturar execuções.

## Arquitetura e rastreabilidade

```
design/          artefatos do analista (nunca enviados ao LLM)
  tasks.yaml       instrução literal + critério (o critério só o verificador lê)
  molic.yaml       MoLIC: cenas, falas u: (espaço de ações) e d: (respostas)
  ctt.md           CTT de C1, C2, V1 e V2 com ≫, [>, |> + linha de base KLM
  klm.yaml         método do especialista (reexecutado no FSM para calcular o tempo)
  signs.yaml       metamensagem (dois receptores) + tabela de paridade de signos
  errors.yaml      matriz PP/PA/AL/RA/CE por operação da HTA + assinaturas MAC
  help.yaml        ajuda sob demanda estratificada por tipo de dúvida
scenes/calib/    kitchen_01 (C1), meds_01 (C2), train_00 (treino)
scenes/validation/  sofa_01 (V1), cans_01 (V2), BLOQUEADAS no código
src/app/         simulador do app (FSM MoLIC pura e determinística)
src/observation/ tradutor de observação o_t (paridade de signos)
src/mechanisms/  SerialChannel, AudioBuffer, AimNoise, TrustGate, ExpertShortcuts,
                 TactileCheck, Slip, Hesitation, AttemptLimit
src/sampler/     PRNG com semente + Beta/uniforme/categórica/log-normal
src/agent/       prompt (sem design/), cliente Ollama (local), cliente Claude, executor por regras
src/core/        controlador da sessão, config, KLM
src/logger/      registrador JSONL (eventos + prompts)
src/verifier/    verificador externo (processo separado)
src/analysis/    métricas e detector MAC por assinatura
src/web/         interface de demonstração e de participante humano
```

Garantias de projeto, com as condições de anulação do enunciado entre parênteses:

1. **Comportamento fora do prompt (i).** O prompt só descreve a pessoa e o pedido. Erros de mira, esquecimento, deslizes, bloqueio de confirmação, atalhos, hesitação e desistência são decididos pelo controlador. A prova é que, com a mesma semente e o mesmo LLM, `perfil` e `generico` diferem só pelos mecanismos.
2. **Nada do analista no contexto (ii).** `src/agent/` não importa `design/`. O controlador carrega a tarefa sem o critério (`loadTaskForController`). `npm run check-leak` audita todos os prompts.
3. **Sucesso externo (iii).** `src/verifier/verify.ts` lê só `task_end.state_after`.
4. **Validação intocada (iv).** V1 e V2 só carregam com `--validation` e com o config idêntico ao congelado. Nenhum teste nem execução do piloto as usa.

## Dados do piloto

O E3 contém só as tarefas de calibração (C1, C2). O dicionário de campos está em `docs/event-dictionary.md`.

## Entregáveis

| Entregável | Onde |
|---|---|
| E1 Caderno de Design | `caderno/caderno.pdf` (gerado por `npm run caderno`) |
| E2 Repositório | este repositório |
| E3 Dados do piloto | `pilot/E3.zip` (`npm run package-e3`) |
| E4 Artigo IEEE | `artigo/main.tex` → `artigo/main.pdf` |
| E5 Demonstração | roteiro em `docs/roteiro-video-E5.md` |

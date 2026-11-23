# Roteiro do vídeo E5 (3 a 5 minutos)

O enunciado pede: uma execução completa do UX-Agent, do recebimento da tarefa até a verificação externa, mostrando a interação do agente com a interface, as ações executadas e os eventos registrados.

## Antes de gravar

1. Garanta que nenhum piloto está usando o Ollama (`pgrep -af run.ts` não deve listar nada).
2. Rode `npm run web` e abra http://localhost:5173.
3. Faça um ensaio com o agente **regras (GOMS)**, que termina na hora. Depois escolha a semente do LLM que vai mostrar. Rode-a antes, para saber o que vai acontecer (com o Ollama, cada passo leva de 6 a 25 s; corte as esperas na edição).
4. Deixe abertos um terminal na pasta `ux-agent` e o arquivo `design/molic.yaml` no editor.

## Roteiro

| Tempo | O que mostrar | O que falar |
|---|---|---|
| 0:00–0:30 | Bloco "O que é isto?" da página | O app assistivo, a persona Marina (fictícia, cega, usa TalkBack) e a pergunta-chave: dar ao agente só a informação que a persona teria. |
| 0:30–1:00 | `design/tasks.yaml` e `design/molic.yaml` no editor | Só a instrução literal vai ao agente; o critério de sucesso fica com o verificador. A MoLIC define as falas u: válidas em cada cena. |
| 1:00–1:20 | Página: tarefa C1, condição **perfil**, agente **LLM local (Ollama)**, semente escolhida → ▶ Executar | O agente recebe a tarefa. O status mostra os passos e o tempo. |
| 1:20–2:40 | Log de eventos ao vivo e o painel "O que o agente recebeu" | Para 2 ou 3 passos: o texto o_t (só o que o TalkBack falaria), a lista de falas válidas (o *enum*), a resposta JSON do modelo, o evento registrado e, em laranja, os mecanismos aplicados **fora do prompt** (AimNoise, AudioBuffer, TrustGate…). |
| 2:40–3:10 | Fim da execução: caixa de resultado do verificador | O sucesso não vem do agente: o verificador externo lê só o estado final (`task_end.state_after`). |
| 3:10–3:50 | Terminal: `npm run verify -- runs/demo`, `npm run check-leak -- runs/demo` e um `head -1` de um `.events.jsonl` | Verificador como processo separado; auditoria de vazamento nos prompts; um evento JSON com cena, falas, tempos, semente e hash do config. |
| 3:50–4:30 | Página: "Operar como pessoa", C1 até o ✅ Sucesso | A mesma aplicação e o mesmo formato de log servem para uma pessoa (origin = human). |
| 4:30–5:00 | `pilot/E3.zip` e a tabela de métricas | O piloto: 2 tarefas × 3 condições × 10 sementes; dados sintéticos; V1 e V2 continuam bloqueadas. |

## Dicas

- Grave a tela com o OBS ou com `ffmpeg -f x11grab`. Edite os tempos de espera do LLM (acelere ou corte).
- Se o LLM não concluir a tarefa na execução mostrada, não é problema: mostre o veredito `interrupted` ou `wrong_object` e explique que é o verificador externo que decide.

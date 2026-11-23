# Dicionário de campos dos eventos (E3)

Cada execução gera dois arquivos JSONL, um registro por linha. Todo registro do agente traz `synthetic: true`.

## `<run_id>.events.jsonl`

| Campo | Tipo | Descrição |
|---|---|---|
| `run_id`, `session_id` | string | `<tarefa>_<condição>_<agente>_s<semente>` |
| `persona_id` | string | `marina_v1` (agente) ou `participante` (pessoa via web) |
| `task_id` | string | C1, C2 (calibração). V1 e V2 são reservadas e bloqueadas |
| `condition` | string | `perfil` (mecanismos ligados), `comparador` (agente neutro, vidente, sem mecanismos), `generico` (ficha no prompt, sem mecanismos), `humano` |
| `agent` | string | `llm`, `rules` (executor GOMS) ou `human` |
| `seed` | int | semente do amostrador. A mesma semente dá os mesmos θ em todas as condições |
| `config_hash` | string | SHA-256 do `config/config.yaml` |
| `versions` | objeto | modelo LLM, tipo de agente, versão da interface e dos mecanismos |
| `t` | ISO 8601 | instante real do registro |
| `t_ms` | int | ms desde o início da execução (tempo computacional) |
| `t_sim_s` | número | tempo comportamental **simulado** acumulado (KLM × Hesitation). Hipótese operacional |
| `step` | int | número do passo (ação proposta) |
| `event_type` | enum | `task_start`, `announce`, `focus_move`, `activate`, `aim_move`, `capture`, `support`, `shortcut_used`, `confirm`, `rejected_action`, `give_up`, `interrupted`, `tech_failure`, `task_end` |
| `origin` | enum | `agent`, `controller` (decisão do controlador: limites, AttemptLimit), `system`, `human` |
| `scene_before`, `scene_after` | string | cena MoLIC antes e depois (`inicio`, `camera`, `resultado`, `detalhes`, `ajuda`, `launcher`, `encerramento`) |
| `proposed_action` | string | fala u: proposta pelo agente |
| `executed_action` | string | fala u: executada. É `null` se rejeitada |
| `u` | string | rótulo legível da fala u: |
| `d` | string | fala d: do preposto (resposta da interface) |
| `rejected_reason` | string | motivo da rejeição pelo controlador |
| `result` | enum | `ok`, `error`, `give_up`, `interrupted`, `tech_failure`, `pending`. O sucesso **não** é decidido aqui |
| `support` | enum | `repeat`, `details`, `help`, `tactile` (uso de ajuda) |
| `error_category` | enum | preenchido em execução: `deslize` (Slip) e `desistencia`. `engano` e `enquadramento` são calculados pela análise (precisam do alvo, que o controlador não conhece) |
| `mechanisms_applied` | lista | `{mechanism, effect}` aplicados no passo (fora do prompt) |
| `klm_ops` | string | operadores KLM do passo (ex.: `MKR`) |
| `latency_ms` | int | latência da resposta do agente (LLM) |
| `state_before`, `state_after` | objeto | tela, foco, mira, zoom, objeto na mão, `frame` (ids no quadro: verdade do mundo, só no log), `result`, `result_focus`, `captures`, `verifications`, `confirmed`, `ended` |
| `event_data` | objeto | `task_start`: instrução, cena, modo de observação, ficha, mecanismos, **θ sorteados**, limite de ações. `task_end`: motivo do fim, ações, rejeitadas |
| `synthetic` | bool | `true` para o agente e `false` para pessoas |

## `<run_id>.prompts.jsonl`

Contém o que foi **efetivamente enviado** ao agente em cada passo:

- `system`: ficha da pessoa e instrução literal.
- `user`: observação o_t, histórico e lista de falas válidas.
- `output_schema`: JSON schema com `enum` das falas u:.
- `response_raw`, `stop_reason`, `usage`, `latency_ms` e `format_retries`.

## `manifest.jsonl` e `verification.jsonl`

- `manifest.jsonl`: uma linha por execução, com θ sorteados e motivo do fim.
- `verification.jsonl`: veredito do **verificador externo**, que pode ser `success`, `wrong_object`, `give_up`, `interrupted`, `tech_failure` ou `unknown`. Vem acompanhado da evidência, que é o estado final.

## Métricas (`metrics/`)

| Métrica | Fórmula |
|---|---|
| S | sucessos / execuções válidas. `tech_failure` e `unknown` ficam fora do denominador e são relatados à parte |
| A, ΔA | ações executadas; ΔA = A − A_KLM. A_rej (propostas rejeitadas) é contada à parte |
| U | eventos `support`, por tipo |
| AI | confirmações de objeto errado / confirmações |
| R_enq | capturas em que o objeto **mirado** (posição da mira ou objeto na mão) ficou fora do quadro / capturas |
| R_sem_alvo | capturas sem o **alvo da tarefa** no quadro / capturas (inclui varredura) |
| R_deslize | deslizes / gestos |
| T_sim / T_KLM | razão entre o tempo simulado e a linha de base KLM de especialista |
| L | mediana da latência do LLM (diagnóstico) |
| MAC | contagem de rupturas por assinatura no log (`src/analysis/mac.ts`, `design/errors.yaml`) |

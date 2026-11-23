# Modelos CTT (Atividade 1.2) — refinamento da HTA congelada

Artefato do analista: não é enviado ao agente. A notação segue Paternò (Dix et al., 2004, cap. 15):

- `≫` habilitação (sequência)
- `[]>` habilitação com passagem de informação
- `[]` escolha
- `[>` desativação: a tarefa da direita interrompe e encerra a da esquerda
- `|>` suspensão/retomada: a da direita suspende a da esquerda, que é retomada depois. Aqui é usada para a **ajuda sob demanda**.
- `*` iteração

Tipos de tarefa: (U) usuário (cognitiva, não observável), (I) interação, (S) sistema e (A) abstrata.

Cada folha (I) corresponde a uma fala u: da MoLIC (`design/molic.yaml`), e cada folha (S) a uma fala d:.

## C1 — Achar a caneca (calibração)

```
Ter caneca azul confirmada (A)
├── Iniciar reconhecimento (A)
│     ( Próximo (I)* ≫ Ativar (I) )  []  AtalhoCâmera (I)          ≫  Abrir câmera (S)
├── Obter anúncio com a caneca (A)                                   *  até o anúncio citar a caneca
│     ( Mirar esq/dir (I)* ≫ [Aproximar | Afastar (I)] ≫ Tato (I)? ) []> Capturar (I) []> Anunciar (S) ≫ Ouvir (U)
│        |> Ajuda (A) = PedirAjuda (I) ≫ EscolherTópico (I) ≫ LerAjuda (S) ≫ Voltar (I)
├── Achar a caneca no resultado (A)
│     ( Próximo | Anterior (I) []> AnunciarItem (S) ≫ Avaliar item (U) )*
│        |> Repetir (I) []> AnunciarLista (S)
│        |> MaisDetalhes (I) []> LerDetalhes (S) ≫ Voltar (I)
│     [>  NovaCaptura (I)                                             (volta a "Obter anúncio")
└── Confirmar (A)
      Decidir (U) ≫ Confirmar (I) ≫ AnunciarConfirmação (S)
Desistir (I) [> (qualquer subtarefa)                                  (desativação global → give_up)
```

## C2 — Identificar o medicamento (calibração)

```
Ter dipirona confirmada (A)
├── Iniciar reconhecimento (A)          = C1
├── Examinar caixa (A)  *  para cada caixa até achar a dipirona
│     Tato (I)? ≫ Capturar (I) []> Anunciar (S) ≫ Ouvir (U)
│     ≫ [ MaisDetalhes (I) []> LerRótulo (S) ≫ Voltar (I) ]          (se o anúncio for genérico ou "provavelmente")
│     ≫ Decidir se é a dipirona (U)
│     ≫ ( NovaCaptura (I) ≫ PegarPróxima (I) )                         (se não for)
│        |> Ajuda (A)
└── Confirmar (A)                       = C1
Desistir (I) [> (qualquer subtarefa)
```

## V1 — Localizar o controle remoto (validação, reservada)

```
Ter controle confirmado (A)
├── Abrir o app (A)       AtalhoApp (I)  []  ( Próximo (I)* ≫ Ativar (I) )
├── Iniciar reconhecimento (A)
├── Varrer o sofá (A)     ( Mirar parte j (I) ≫ Capturar (I) []> Anunciar (S) ≫ Ouvir (U) )*   j = 1..3
├── Achar o controle na lista (A)       = C1.3, com até 5 itens  |> Repetir
└── Confirmar (A)
Desistir (I) [> (qualquer subtarefa)
```

## V2 — Separar a lata de milho (validação, reservada)

```
Ter lata de milho confirmada (A)
├── Iniciar reconhecimento (A)
├── Capturar lata A (A)    Capturar (I) []> Anunciar c<θ (S) ≫ Ouvir (U)
├── Resolver incerteza (A)  ( MaisDetalhes (I) [] (Aproximar (I) ≫ Capturar (I)) [] Tato (I) )*   até c ≥ θ ou r verificações
├── Comparar com lata B (A)  [opcional]  PegarPróxima (I) ≫ repetir 2–3
└── Confirmar (A)
Desistir (I) [> (qualquer subtarefa)
```

## Linha de base GOMS/KLM de especialista (cena principal: C1)

O cálculo é reproduzível com `npm run metrics` (função `klmBaseline` em `src/analysis/metrics.ts`).

Operadores usados: K = 0,28 s, M = 1,35 s, P = 1,10 s e R = duração da fala d: (palavras ÷ 3 por segundo).

| # | Fala u: | Operadores | Fala d: (R) |
|---|---|---|---|
| 1 | Ativar | M K | "Câmera aberta. Aponte para o objeto e toque em Capturar." |
| 2 | Mirar à direita | M P | "Câmera movida para a direita." |
| 3 | Mirar à direita | P | idem |
| 4 | Capturar | M K | "Um objeto reconhecido: caneca azul, 90 por cento." |
| 5 | Confirmar | M K | "Objeto confirmado: caneca azul." |

O total é de **5 ações observáveis e 19,11 s**. Para C2 são 9 ações e 52,16 s.

O tempo KLM é a linha de base **ideal** (especialista vidente, sem erros). Ele não é atribuído à persona (Modelagem, pressuposto a). O tempo simulado do agente (Hesitation) é hipótese operacional e é comparado apenas como razão T_sim/T_KLM.

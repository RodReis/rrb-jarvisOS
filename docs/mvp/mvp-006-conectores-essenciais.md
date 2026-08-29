# MVP-006 — Conectores Essenciais

- Status: **as seis SPECs `aprovada-pi` em 2026-08-29** — revisão de perguntas abertas concluída com o PI; fatias liberadas para o Backlog na ordem da fila do `STATUS.md`.
- GitHub: épico [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86); fatias [#87–#92](https://github.com/RodReis/rrb-jarvisOS/issues/87), estado `proplan:backlog`.
- Depende de: MVP-005 (Vault, gateway de providers e BudgetPolicy).
- Não depende de: MVP-007.
- Dono do aceite de construção: PI.

## Tese

Entregar uma base auditável para integrações externas e os dois conectores necessários à pipeline: GitHub e pesquisa web. O MVP não orquestra planejamento nem construção; apenas oferece capacidades tipadas, idempotentes e retomáveis para MVP-008 e MVP-009.

## Fronteiras

- Segredos permanecem no Vault e são usados somente no processo main.
- O renderer nunca recebe token, API key ou proxy HTTP genérico.
- O connector informa capacidades; não decide quando o fluxo deve usá-las.
- Efeitos externos são auditados e reconciliados.
- Context7 continua sendo a fonte obrigatória para documentação técnica suportada; Tavily atende mercado e web geral.
- Google Workspace, ElevenLabs, sync Supabase e Obsidian ficam no backlog sem numeração.

## Decisões estruturais do PI (2026-08-29)

Resolvidas na revisão que liberou as seis SPECs; cada uma está registrada na sua SPEC.

| # | Decisão | Onde |
|---|---|---|
| 1 | Runtime de conectores é **separado** do ponto único de IA do MVP-005; compartilham Vault, auditoria e ledger | M6-F01 |
| 2 | Crédito de conector tem **ledger próprio em créditos**, independente da `BudgetPolicy` em USD | M6-F02 |
| 3 | GitHub App é **do projeto**, `client_id` embutido com override opcional em Settings | M6-F03 |
| 4 | Emenda do Vault para OAuth (payload estruturado + `expires_at` + rotação atômica) é **escopo da M6-F03** | M6-F03 |
| 5 | Roteamento Context7↔Tavily **sai da M6-F05**; o app nunca chama Context7 — ele é do agente construtor no **MVP-009** (ajuste na mesma data, revisão do MVP-008) | M6-F05 |
| 6 | UI é **mínima e dentro de cada fatia**; não há fatia dedicada de UI de Conectores | M6-F03, M6-F05 |
| 7 | Evidência extensa vive no **diretório de artefatos do app**, referenciada por hash | M6-F06 |

## Fatias

| Índice | SPEC | Resultado |
|---|---|---|
| M6-F01 | `spec-conectores-01-nucleo.md` | Contratos e ciclo de vida comuns |
| M6-F02 | `spec-conectores-02-operacao-governanca.md` | Health, resiliência, custo e auditoria |
| M6-F03 | `spec-conectores-03-github-app-autenticacao.md` | GitHub App com Device Flow e refresh |
| M6-F04 | `spec-conectores-04-github-automacao.md` | Repositório, issues, PR, checks e merge |
| M6-F05 | `spec-conectores-05-tavily-search.md` | Pesquisa rastreável e orçada |
| M6-F06 | `spec-conectores-06-tavily-extract-evidencias.md` | Extração e pacote de evidências |

## Ordem

`M6-F01 → M6-F02 → (M6-F03 → M6-F04) + (M6-F05 → M6-F06)`.

As duas trilhas podem ser especificadas em paralelo, mas a implementação mantém WIP=1 até a jornada estar provada.

## Done do MVP

- GitHub autentica por Device Flow sem segredo embarcado e renova tokens pelo Vault.
- Operações GitHub são idempotentes e confirmadas na origem.
- Tavily Search e Extract preservam fontes, `request_id` e créditos, com teto próprio no ledger de créditos.
- Erros externos produzem bloqueio retomável com causa e ação.
- Contract tests e um smoke real limitado passam.
- Nenhum segredo aparece em renderer, prompt, log ou evidência.

## Fora do MVP

- Wizard, PRD e aprovações: MVP-008.
- Fila, worktree, Claude, PR/CI e merge orquestrados: MVP-009.
- Tavily `/research`: adiado; duplica síntese e reduz rastreabilidade na V1.
- Memória híbrida/RAG: MVP-007 proposto.

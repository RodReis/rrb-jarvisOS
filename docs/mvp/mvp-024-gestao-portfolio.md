# MVP-024 — Gestão de Portfólio

- Status: **rascunho-completo** (2026-08-31); pacote de planejamento, sem implementação autorizada e sem aceite de SPEC presumido.
- GitHub: [#213](https://github.com/RodReis/rrb-jarvisOS/issues/213); fatias no índice canônico `docs/STATUS.md`.
- Direção: Pipeline V3; design `docs/superpowers/specs/2026-08-31-mvp-024-portfolio-design.md`.
- Dependências funcionais: MVP-012 (scheduler) e MVP-015 (observabilidade). Não depende de Blueprints ou memória.
- Numeração: a direção “MVP-018 — Gestão de Portfólio” da versão inicial da V3 passa a **MVP-024**; MVP-018 do Command Center e suas issues não são renumerados.

## Resultado

Dar ao PI uma visão de vários projetos e acesso aos controles existentes de prioridade e pausa, explicando prontidão, espera, custo e quota. Portfólio não é um segundo scheduler, ledger ou centro de aprovações.

## Fatias e ordem

| Fatia | SPEC | Dependência | Resultado |
|---|---|---|---|
| M24-F01 ([#218](https://github.com/RodReis/rrb-jarvisOS/issues/218)) | `spec-portfolio-01-catalogo-prontidao.md` | M12-F05; M15-F04 | Catálogo e prontidão rastreável por projeto |
| M24-F02 ([#219](https://github.com/RodReis/rrb-jarvisOS/issues/219)) | `spec-portfolio-02-prioridade-controles.md` | F01; M12-F01 | Prioridade e pausa pelos comandos canônicos |
| M24-F03 ([#220](https://github.com/RodReis/rrb-jarvisOS/issues/220)) | `spec-portfolio-03-custos-quotas.md` | F01; M15-F02 | Custos, quotas compartilhadas e capacidade sem dupla contagem |
| M24-F04 ([#221](https://github.com/RodReis/rrb-jarvisOS/issues/221)) | `spec-portfolio-04-console-resiliencia-e2e.md` | F02 e F03 | Console, retomada e prova multiprojeto |

F02 e F03 podem ser construídas independentemente após F01, respeitando a fila aprovada e a prova de independência. A tabela não autoriza execução concorrente por si só.

## Dentro

- projetos locais visíveis ao usuário/workspace corrente;
- revisões e idade das fontes, pendências e motivos de espera;
- prioridade explícita do PI para entradas ainda não adquiridas;
- pausa/retomada de novas admissões pelo dono da fila;
- leituras agregadas do ledger, snapshots de quota e capacidade existente;
- operação degradada quando uma fonte ou projeto não responde.

## Fora

- fila própria, autopromoção de SPEC, criação automática de `next`;
- redistribuir quota contratada ou comprar créditos;
- prioridade por IA, custo presumido ou score opaco de “saúde”;
- cancelar run ativo ao pausar admissões;
- administrar usuários, times, cobrança, serviços externos ou projetos não cadastrados;
- substituir os consoles de observabilidade e aprendizado.

## Fechamento verificável

Três projetos elegíveis e um incompleto são exibidos com evidência; o PI muda prioridade/pausa, o scheduler confirma uma única transição e continua respeitando gates, capacidade e fairness. Custos reconciliam com o ledger, quota compartilhada aparece uma vez e falha do painel não paralisa a fila.

## Antes da construção

Preservar aprovação do MVP e de cada SPEC na entrada da fila. A F04 exige `DESIGN-SYSTEM.md` e protótipos HTML formais anexados pelo PI. Este planejamento define jornadas e estados, sem substituir esses anexos nem criar uma aprovação posterior ao deploy.

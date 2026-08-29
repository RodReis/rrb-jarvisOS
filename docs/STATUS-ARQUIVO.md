# STATUS-ARQUIVO.md — Histórico detalhado

Complementa `STATUS.md`. O estado corrente, a numeração Fatia ↔ SPEC e as próximas ações ficam no arquivo curto; decisões, ressalvas e provas históricas ficam aqui.

## Snapshot consolidado até 2026-08-28

Em 2026-08-28 o `STATUS.md` foi reconciliado com o board: registros antigos ainda tratavam #34, #41, #43, #47, #52, #57, #58 e #69 como aguardando aceite, #66 como em andamento e não incluíam #74–#80. O snapshot corrigido registrou 33 issues finalizadas, MVP-004 em fechamento e MVP-005 na cabeça da fila.

## MVP-001 — Fundação

Épico [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1), aceito em 2026-07-22.

| Issue | Fatia | SPEC | PR |
|---|---|---|---|
| [#2](https://github.com/RodReis/rrb-jarvisOS/issues/2) | Bootstrap | `spec-fundacao-01-bootstrap.md` | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) |
| [#3](https://github.com/RodReis/rrb-jarvisOS/issues/3) | AppShell/Workspaces | `spec-fundacao-02-appshell-workspaces.md` | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) |
| [#4](https://github.com/RodReis/rrb-jarvisOS/issues/4) | Auth Google | `spec-fundacao-03-auth-google.md` | [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) |
| [#5](https://github.com/RodReis/rrb-jarvisOS/issues/5) | Dados/AuditEvent | `spec-fundacao-04-dados-audit.md` | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) |
| [#6](https://github.com/RodReis/rrb-jarvisOS/issues/6) | Settings | `spec-fundacao-05-settings.md` | [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) |
| [#8](https://github.com/RodReis/rrb-jarvisOS/issues/8) | Observabilidade | `spec-fundacao-06-observabilidade-logging.md` | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) |

F04 e F02 saíram juntas porque `workspace-switch` precisava simultaneamente do fluxo e do `AuditEvent`. A F06 recebeu issue #8 porque #7 já estava ocupada.

## MVP-002 — Execução local controlada

Épico [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9), aceito em 2026-07-23.

| Issue | Fatia | SPEC | PR |
|---|---|---|---|
| [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) | Supabase local | `spec-execucao-local-01-supabase-local.md` | [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) |
| [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) | Policy Engine | `spec-execucao-local-02-policy-engine.md` | [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) |
| [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) | Allowlist | `spec-execucao-local-03-allowlist-diretorios.md` | [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) |
| [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) | Workflows | `spec-execucao-local-04-registro-workflows.md` | [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36) |
| [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) | Execução simulada | `spec-execucao-local-05-execucao-simulada.md` | [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37) |

A F05 provou o modo report sem efeito real; MVP-004 converteu esse piso em execução allowlisted.

## MVP-003 — Design System

Épico [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16), oito fatias aceitas em 2026-07-23. PRs: [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38), [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40), [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42), [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45), [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46), [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49), [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) e [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51).

Base: Radix + Tailwind v4 + Lucide. As specs 03/04 foram divididas em a/b. O slot MVP-003 foi redefinido para Design System em 2026-07-21; Execução real passou ao MVP-004 e o documento antigo virou stub superseded.

## MVP-004 — Execução real

- F01 [#74](https://github.com/RodReis/rrb-jarvisOS/issues/74), `spec-execucao-real-01-filesystem-allowlisted.md`: PR [#81](https://github.com/RodReis/rrb-jarvisOS/pull/81), squash `19870a3`, aceita em 2026-08-28.
- F02 [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75), `spec-execucao-real-02-terminal-controlado.md`: PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83), entregue e aguardando aceite no snapshot.

A F01 teve quatro checks verdes e critérios comportamentais provados por integração. A fila de aprovação não foi validada renderizada no app real porque a navegação parou no login sem sessão; jsdom não prova CSS/layout. O CI também detectou build E2E desatualizado, Supabase parado, relatório sem carimbo e conflito documental.

## Fatia avulsa CHOICE

Issue [#69](https://github.com/RodReis/rrb-jarvisOS/issues/69), `spec-choice-01-selecao-de-espaco.md`, PR [#70](https://github.com/RodReis/rrb-jarvisOS/pull/70), aceita em 2026-07-24. Entregou `TelaChoice`, acento por `UserProfile` e Settings; rail/WorkspaceSwitcher permaneceram. Nasceu sem MVP pai por decisão explícita do PI.

## FIX e INFRA finalizados

| Issue | Resumo | PR | Aceite |
|---|---|---|---|
| [#43](https://github.com/RodReis/rrb-jarvisOS/issues/43) | leitura do `.env` | [#44](https://github.com/RodReis/rrb-jarvisOS/pull/44) | 2026-07-24 |
| [#47](https://github.com/RodReis/rrb-jarvisOS/issues/47) | `navegacao.spec.ts` fora da suíte | [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48) | 2026-07-24 |
| [#52](https://github.com/RodReis/rrb-jarvisOS/issues/52) | `Meter` escondia rótulo | [#53](https://github.com/RodReis/rrb-jarvisOS/pull/53) | 2026-07-24 |
| [#57](https://github.com/RodReis/rrb-jarvisOS/issues/57) | login não seguia protótipo | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#58](https://github.com/RodReis/rrb-jarvisOS/issues/58) | Tailwind não varria design | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#34](https://github.com/RodReis/rrb-jarvisOS/issues/34) | E2E em job próprio | [#71](https://github.com/RodReis/rrb-jarvisOS/pull/71) | 2026-07-25 |
| [#41](https://github.com/RodReis/rrb-jarvisOS/issues/41) | porta variável do renderer | [#73](https://github.com/RodReis/rrb-jarvisOS/pull/73) | 2026-07-25 |
| [#66](https://github.com/RodReis/rrb-jarvisOS/issues/66) | custo do Actions privado | [#72](https://github.com/RodReis/rrb-jarvisOS/pull/72) | 2026-07-25 |
| [#64](https://github.com/RodReis/rrb-jarvisOS/issues/64) | rótulo quebrava botão | [#65](https://github.com/RodReis/rrb-jarvisOS/pull/65) | 2026-08-28 |

O #58 expôs que jsdom não aplica folha de estilo: 562 testes passavam mesmo com o CSS do DS fora do scanning. O #66 foi resolvido na origem ao tornar o repositório público; `concurrency` permaneceu como guarda. O merge do #44 fechou #43 por interpretar “FIX #43” na mensagem squash; a convenção passou a proibir esse padrão em commits.

## Evolução do Corte 3 e pipeline

- 2026-07-24: Corte 3 dividido em MVP-005 Providers/Vault/Budget, MVP-006 Conectores e MVP-007 Memória/RAG.
- 2026-08-28: MVP-006 redefinido como Conectores Essenciais: runtime, GitHub App e Tavily; antigos conectores voltaram ao backlog.
- 2026-08-28: pipeline dividida em MVP-008 Planejamento Governado e MVP-009 Entrega Autônoma; MVP-007 não bloqueia ambos.
- 2026-08-28: seis fatias por MVP executável, GitHub App + Device Flow, Tavily Search+Extract, Context7 técnico, anexos de design pelo PI, Git automático e ausência de aceite duplicado.
- As 18 SPECs foram criadas para revisão documental. Não nasceram issues e não houve autorização de implementação.

### Publicação antecipada das issues (2026-08-28)

Por solicitação explícita do PI, foram criados os épicos [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86), [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93) e [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100), com 18 sub-issues na ordem #87–#92, #94–#99 e #101–#106. O GitHub registra sub-issues e dependências nativas entre fatias/MVPs.

Como as SPECs continuavam em revisão, as fatias receberam `proplan:planejado`, não `proplan:backlog`. Isso preserva a regra de que issue existente não equivale a autorização de implementação. O texto anterior registra o estado antes dessa decisão e permanece como histórico.

### Pipeline V2 especificada (2026-08-29)

O PI aprovou a arquitetura da Pipeline V2, encerrando as decisões estruturais sobre multi-executor Claude/Codex, Squads limitados pela SPEC, duas fatias concorrentes com prova de independência e execução contínua do DAG já autorizado. A V2 termina no merge técnico; deploy e aceite final permanecem fora.

Foram criados os documentos dos MVP-010 a MVP-013 e vinte SPECs, cinco por MVP, todas em `revisão-pi`. A arquitetura aprovada autoriza essa especificação, mas não autoriza implementação nem publicação das issues. Depois do aceite das revisões exatas, as issues devem ser criadas em ordem de implementação, de M10-F01 a M13-F05.

As SPECs preservam os contratos já decididos: um writer por fatia; Git/GitHub no kernel; CLIs autenticados por perfis isolados; nenhuma rota monetária silenciosa; workers sem escrita/Git; fallback sequencial quando independência não é provada; merge serializado; pausa/cancelamento sem apagar trabalho remoto; e nenhum gate, regra ou aceite inventado pelo agente.

## Pendências históricas preservadas

- A UI de allowlist ainda exigia decisão de produto: localização, seletor nativo e remoção de `appDir`.
- Login por senha/GitHub exige SPEC própria; não é FIX.
- Adoção de catálogo global `SPEC-nnn` permanece opcional. Até decisão, slugs e índice do `STATUS.md` vencem.
- Conflito de sync multi-dispositivo permanece questão aberta do ADR-001.

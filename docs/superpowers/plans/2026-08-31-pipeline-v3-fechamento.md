# Fechamento do planejamento — Pipeline V3

- Data: 2026-08-31.
- Pedido: finalizar planejamento, criar/completar issues faltantes e concluir [PR #189](https://github.com/RodReis/rrb-jarvisOS/pull/189).
- Escopo: documentação e GitHub. Nenhuma implementação de produto, instalação de provider, deploy ou fechamento de issue de entrega.
- Base reconciliada: `2e8151f`, incluindo PRs #188, #191, #207, #208 e #210.
- Estado: redação e publicação das issues concluídas; verificação final e integração do PR em andamento.
- Índice canônico: `docs/STATUS.md`; este relatório é evidência datada, não segunda fonte da numeração/fila.

## 1. Cobertura fechada

| MVP | Épico | Fatias / SPECs | Estado documental |
|---|---|---|---|
| 014 Release | #149 | 5 / 5 (#150–#154) | aprovações anteriores preservadas |
| 015 Observabilidade | #155 | 6 / 6 (#156–#161) | aprovações anteriores preservadas |
| 016 Aprendizado | #162 | 6 / 6 (#163–#168) | quatro aprovadas; duas completas para revisão |
| 023 Blueprints | #212 | 4 / 4 (#214–#217) | completas para revisão |
| 024 Portfólio | #213 | 4 / 4 (#218–#221) | completas para revisão |
| Total V3 | 5 épicos | 25 / 25 | 15 aprovadas anteriormente, 10 novas em rascunho-completo |

Não resta fatia V3 sem redação ou sem issue. Isso não transforma rascunho em aprovação, nem issue em implementação. O PI mantém aceite de entrada do MVP/SPEC e os anexos visuais exigidos antes da construção; não há segundo aceite técnico de merge/deploy.

M7-F05–F08, Command Center e Shell têm seus próprios planejamentos. Não foram indevidamente incluídos como trabalho faltante da V3.

## 2. Identidade e ordem

A direção V3 chamava Blueprints/Portfólio de MVP-017/018. A main já utiliza 017–021 para Command Center e 022 para Shell. A consulta remota e a reserva dos épicos #212/#213 fixaram **MVP-023 e MVP-024**, sem renumerar trabalho existente. Uma reserva local intermediária 022/023 não foi publicada como numeração definitiva.

A fila operacional foi apenas consultada: `next` em #103 na conferência, sem alteração por esta tarefa. Command Center/Shell conservam a prioridade decidida pelo PI. Ordem de publicação não concede prioridade nem paralelismo automático.

Dentro da V3: release F01→F05, observabilidade F01→F06 e aprendizado F01→F06. Blueprints depende de planejamento M8; Portfólio depende de scheduler M12/observabilidade M15. Portfólio não depende de Blueprints nem de Graphify. Suas F02/F03 podem ser independentes após F01, mas a execução ainda segue a fila autorizada.

## 3. Dez SPECs novas e dependências diretas

| Fatia | Issue | SPEC em docs/spec | Predecessores diretos |
|---|---|---|---|
| M16-F05 | [#167](https://github.com/RodReis/rrb-jarvisOS/issues/167) | `spec-aprendizado-05-estrategias-recomendacoes.md` | #166 |
| M16-F06 | [#168](https://github.com/RodReis/rrb-jarvisOS/issues/168) | `spec-aprendizado-06-interface-resiliencia-e2e.md` | #167 |
| M23-F01 | [#214](https://github.com/RodReis/rrb-jarvisOS/issues/214) | `spec-blueprints-01-catalogo-revisoes.md` | #99 |
| M23-F02 | [#215](https://github.com/RodReis/rrb-jarvisOS/issues/215) | `spec-blueprints-02-instanciacao-wizard.md` | #214, #96 |
| M23-F03 | [#216](https://github.com/RodReis/rrb-jarvisOS/issues/216) | `spec-blueprints-03-anexos-compatibilidade.md` | #215, #98, #99 |
| M23-F04 | [#217](https://github.com/RodReis/rrb-jarvisOS/issues/217) | `spec-blueprints-04-interface-resiliencia-e2e.md` | #216 |
| M24-F01 | [#218](https://github.com/RodReis/rrb-jarvisOS/issues/218) | `spec-portfolio-01-catalogo-prontidao.md` | #132, #159 |
| M24-F02 | [#219](https://github.com/RodReis/rrb-jarvisOS/issues/219) | `spec-portfolio-02-prioridade-controles.md` | #218, #128 |
| M24-F03 | [#220](https://github.com/RodReis/rrb-jarvisOS/issues/220) | `spec-portfolio-03-custos-quotas.md` | #218, #157 |
| M24-F04 | [#221](https://github.com/RodReis/rrb-jarvisOS/issues/221) | `spec-portfolio-04-console-resiliencia-e2e.md` | #219, #220 |

Issues #167/#168 foram completadas, não duplicadas. Oito novas issues foram criadas em ordem de implementação, com parent/sub-issues e dependências nativas. Todas as dez permanecem abertas com somente `proplan:planejado`; nenhum `next`, `todo`, `doing`, `done` ou `finalizado` foi aplicado.

Cada nova SPEC contém objetivo/fora de escopo, ownership, identidade/revisão, fluxo, limites, recuperação, testes e critérios verificáveis. F05/F06 de Aprendizado têm 20 critérios cada; as oito de Blueprints/Portfólio têm 12 cada. Limites novos são propostas desta revisão, não decisões históricas atribuídas ao PI.

## 4. Reconciliação do PR #189

Aplicadas as decisões posteriores expressas do PI no PR #207 e no comentário do PR #189:

- `proplan:done/finalizado`, proibição de fechamento automático e aceite do PI seguem a CONVENTION §1 da main. Não foi aprovada a redefinição da branch.
- SPECs de providers M5-F03/F04, conectores M6-F01/F02 e planejamento M8-F01/F06 foram restauradas ao baseline entregue. Resumos de MVP005/008 também não alegam implementação retroativa.
- SPECs M9-F02–F06 e MVP009 preservam as decisões mais recentes: WIP global, AWAITING_MERGE, proxy no host sem credencial no container, validações containerizadas, CI gerado, snapshot do ruleset, cancelamento/retenção e docs no PR.
- O `EffectJournal` é responsabilidade da M9-F02. A falha real na implementação está na #209/PR #210; este PR documental **não** a resolve nem reabre conectores entregues.
- A quota de assinatura segue o pré-requisito da M9-F04. O MVP005 entregue não é reescrito como se já medisse quota. A separação/normalização futura de runtime continua no recorte M10-F01; a referência histórica à V1 não comprova uma interface já entregue no MVP005.
- Os contratos V3 aceitos pelo PI são preservados. Conteúdo histórico dos STATUS anteriores foi transferido para STATUS-ARQUIVO; STATUS atual não repete estado antigo como fila vigente.
- Merge de main, não rebase/force-push, preservou os SHAs das revisões/aceites anteriores. Nenhum arquivo de produto foi alterado em relação à base reconciliada.

## 5. Aprovações anteriores preservadas

Referências recuperadas do histórico, sem reconstruir aceite pela data:

| Recorte | Revisão técnica / registro de aceite |
|---|---|
| Pipeline V2 | `b7f9b92` / `a338007` |
| MVP014 | `852f0c1` / `8e9c8a0` |
| MVP015 | `192b075` / `8febc23` |
| M16-F01 | `62645e4` / `c757d4c` |
| M16-F02 | `eed7a5d` / `f946356` |
| M16-F03 | `2ea2f1f` / `abfcbe8` |
| M16-F04 | `1cefc2c` / `91c41be` |
| M7-F04 | `027f8274dc4e3d39a6fc24ce394ea6b53d70f986` / `5d3a4ed` |

Datas iguais ou “nenhuma pergunta aberta” não provam ausência de gate. As dez SPECs desta rodada não reutilizam esses aceites; a redação nova permanece explicitamente não aprovada.

## 6. Validação e limites da evidência

- Reconciliação: nenhum conflito remanescente; diff frente à main restrito a documentação; nenhum delta em src/package/workflows.
- Revisão independente: dez contratos novos sem P0/P1. P2 de asset8MiB/lote4MiB corrigido com streaming por bloco, hash final e confirmação por arquivo.
- Issues: corpo confrontado com SPEC, estado/label/parent/dependências conferidos por leitura remota; publicação não altera fila nem fecha entrega.
- Typecheck, lint e build locais: aprovados. Build precisou rodar fora da restrição de leitura do sandbox sobre a pasta temporária; nenhuma configuração de produto foi modificada para isso.
- Primeira suíte local: 109 arquivos passaram; worker encerrou inesperadamente (1921 testes passaram, uma ocorrência todo; execução incompleta). Não é PASS da suíte. Repetição serial com um único worker aprovada: **110 arquivos, 1939 testes passaram, 1 todo (1940 total)**; duração 151,20 s. Typecheck/lint/build também passaram; o CI obrigatório será confirmado no PR antes do merge. O erro inicial foi preservado neste registro, não ocultado.
- CodeRabbit não disponível no ambiente nativo; WSL disponível somente para Docker Desktop. Revisão manual independente aplicada, sem alegar execução de CodeRabbit. ECC Tools comentou exigência de plano no PR; não é aprovação de revisão.
- Nenhum smoke visual de feature nova foi alegado. As interfaces ainda serão implementadas contra DESIGN-SYSTEM/HTML formais do PI.
- `reports/TESTS.md` não recebeu números manuais. Resultados desta verificação documental ficam aqui/no PR, separados das provas de entrega de SPEC.

## 7. Condição de conclusão desta tarefa

Planejamento/índice/25 issues completos, baselines preservados, PR atualizado sem rascunho, checks aceitos no head corrente e merge confirmado na origem. Questão nova de produto, mudança de proteção ou falha de CI que exija código fora do escopo não será contornada para obter verde.

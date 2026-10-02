# ADR-006: Squads orquestrados por modelo local, com multi-escritor e quadro de execução

- Status: **aceito** — aprovado pelo PI em 2 de outubro de 2026 (revisão do PR #367).
- Data: 2 de outubro de 2026.
- Decisor: PI (todas as decisões abaixo, tomadas em sessão de planejamento de 2026-10-02); redação pelo Cowork.
- Relacionado: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md` (Decisões 3 e 5, §7); MVP-009 (decisão 6, WIP=1; M9-F04 tentativas; M9-F05 merge); MVP-012 (M12-F01 pool); MVP-013; MVP-016; MVP-026 (modelo por fase; Fable só por assinatura); `DIMENSIONAMENTO.md`; RF-014.

## Problema

A Pipeline V2 aprovada em 2026-08-29 previa Squads com **um único escritor** e um planejador sem papel definido de modelo. O PI quer: (1) um orquestrador barato e local que quebre a issue em tarefas e escolha a camada de modelo de cada uma; (2) paralelismo real de escrita dentro de uma issue; (3) um quadro de execução visível no app, disparado pelo PI ("play"), com etapas DEVELOPER → TESTE → REVIEWER → PR/MERGE → DONE, em que a espera do CI tenha coluna própria — hoje a issue parece "em teste" enquanto aguarda a PR, porque o monitor nem sempre funciona.

O plano antigo não acomoda (2) nem (3), e trata o planejador como caixa-preta.

## Alternativas consideradas (registro — não escolhidas)

- **Hermes Agent (framework Python da Nous Research) como orquestrador embutido.** Recusada pelo PI: duplicaria kernel, memória e permissões fora do Policy Engine e da auditoria.
- **Hermes decide e despacha sem validação.** Recusada: revogaria a Decisão 3 da V2 inteira.
- **Escritor único (status quo).** Recusada pelo PI em favor de até 2 escritores em worktrees isolados.
- **Integração por paths disjuntos + merge determinístico do kernel.** Recomendada pelo Cowork, recusada pelo PI em favor de agente integrador.
- **Colunas como labels novos no GitHub.** Recusada: o contrato `proplan:*` do `CONVENTION.md` não muda.

## Decisão

1. **Orquestrador = modelo local via o Provider Adapter Ollama existente** (`src/main/ai/ollama-adapter.ts`). Modelo configurável no perfil (candidatos: `hermes3:8b`, `qwen3:8b`). Nenhum framework de agente externo é embutido.
2. **O orquestrador propõe; o kernel valida.** Ele gera o `SquadPlan` (tarefas, papel, camada de modelo, escritor dono, dependências); o validador determinístico aceita ou rejeita antes de qualquer dispatch. **A Decisão 3 da V2 permanece**: o kernel controla DAG, gates, leases, orçamento, tentativas, Git e merge.
3. **Fallback:** com o orquestrador local indisponível, ou com o plano rejeitado até o limite, o planejamento cai no **modelo da fase** (MVP-026), pela assinatura, com a troca registrada no run. Nunca há API paga como fallback silencioso.
4. **Camadas de modelo:** orquestrador local; executor (tarefas estruturais e repetitivas, como testes simples e boilerplate); especialista (lógica complexa, refatoração de arquitetura, depuração profunda, revisão de segurança). O modelo de cada camada vem do perfil e das rotas do MVP-026. Fable só pela assinatura.
5. **Multi-escritor — revoga a Decisão 5 da V2 no escopo do MVP-011:** até **2 escritores por issue**, cada um no **seu worktree**, cada um ocupando **um slot** do pool. Workers não escritores continuam somente leitura. **Nenhum agente executa Git ou GitHub**: o kernel commita por worktree, integra, abre a PR e faz o merge.
6. **Integração por agente integrador**, cuja camada é definida no perfil da fatia e deve ser diferente da do revisor. O resultado só é aceito com três provas: **manifesto de hunks** (cada trecho de cada escritor aparece no resultado ou consta como descartado com motivo), **suíte verde** e **revisão independente**. Faltou uma, o run para.
7. **Memória:** docs versionados (ADRs, ARCHITECTURE, SPECs) mais o snapshot por run. O aprendizado entre runs continua no MVP-016. O orquestrador não mantém memória própria.
8. **Fila e disparo:** a fila é do PI. O PI coloca issues em "A fazer" e dá **play** em uma issue ou em várias do **mesmo MVP**. Cada issue ganha seu worktree. Dependências entre fatias e a prova de independência do MVP-012 continuam valendo; sem prova, a execução é sequencial.
9. **Quadro de execução = projeção local do run no app**, com as colunas **A fazer → DEVELOPER → TESTE → REVIEWER → PR/MERGE → DONE → Finalizado (PI)**. A coluna PR/MERGE reflete o estado real dos checks consultado pelo kernel, e não um watcher. No GitHub, a issue continua com `proplan:todo → doing → done`.
10. **Retrabalho:** reprovação em TESTE ou REVIEWER volta para DEVELOPER com os achados deduplicados, dentro do limite de tentativas da M9-F04. Esgotado o limite, a issue para com motivo para o PI.
11. **Aprovação do PI antes de executar:** alteração estrutural de banco e comando destrutivo. O card fica na coluna atual com o **selo "Aguardando PI"** e o motivo. **Deploy em produção** fica registrado como ação sujeita à mesma aprovação quando entrar no escopo (hoje está fora da V2).
12. **Prova antes da primeira fatia (R-crítico):** a fatia **M11-F00** mede o orquestrador local em fatias já entregues e o integrador em merges históricos com conflito. O critério de aprovação é numérico e definido pelo PI na SPEC-Squads-00.
13. **Ordem:** a **M12-F01 (pool global)** passa a entrar **antes da M11-F03**. O restante do MVP-012 segue depois do MVP-011.
14. **Partição (T-enorme, 20 pts):** o MVP-011 fica com o núcleo (F00–F04, T-grande) e o quadro de execução e a governança (play, PR/MERGE, selo, tetos agregados, cancelamento em cascata, E2E) vão para o **MVP-028** (T-médio, R-alto), que depende do MVP-011.
15. **Critérios da M11-F00:** orquestrador local vira padrão com **≥ 80%** de planos aceitos; integrador exige **zero hunk perdido sem registro e 100% de suítes verdes**. Replanejamento limitado ao **limite da M9-F04**; consulta de checks a cada **60 s**. Conjunto de referência: fatias mergeadas do MVP-009, do MVP-010 e do MVP-026.
16. **Multi-escritor desligado por padrão entre a entrega do MVP-011 e a do MVP-028**: até lá, o perfil aceita 1 escritor; 2 escritores só em E2E de teste. Liga quando tetos agregados, selo de aprovação e cancelamento em cascata existirem.

## Consequências

- O MVP-011 é reescrito (F00–F04) e nasce o MVP-028 (F01–F02); as SPECs ficam em planejado até o "aprovado" do PI. As issues #122–#125 seguem em Backlog com as SPECs reescritas; #126 passa ao MVP-028; M11-F00 = #369, MVP-028 = #368, M28-F01 = #370.
- O §3 da V2 continua excluindo "vários agentes no **mesmo** worktree" e "duas implementações concorrentes da mesma fatia". Multi-escritor aqui é divisão de trabalho em worktrees distintos.
- **Pendências para a próxima rodada** (não decididas aqui): emendas ao MVP-012 (slots por escritor, fairness com multi-escritor, independência entre issues do mesmo MVP no play) e ao MVP-013 (relação entre o play do PI e a drenagem contínua; RF-014.2).
- RF-014 dividido na matriz: RF-014.1 mantido no MVP-011; RF-014.2 transferido ao MVP-013; RF-014.3 transferido ao MVP-015.
- Risco aceito pelo PI: um LLM integrador pode perder trabalho de forma silenciosa. A mitigação é o manifesto de hunks com parada do run, não a confiança no modelo.

## Nota pós-M11-F00 (PI, 2026-10-02)

A prova da M11-F00 (PR [#372](https://github.com/RodReis/rrb-jarvisOS/pull/372)) reprovou o orquestrador local no critério de 80%. Pela regra 2 da SPEC-Squads-00, prevista nesta ADR (decisões 12 e 15), a **decisão 1 passa a valer assim até nova prova**: o orquestrador padrão é o **modelo da fase**, pela assinatura; o modelo local via adapter Ollama é opção do perfil, atrás do validador endurecido da SPEC-Squads-02 § Emenda E1. A F00-bis e a nova medição do integrador estão na M11-F00b ([#373](https://github.com/RodReis/rrb-jarvisOS/issues/373)); se o local atingir o critério, volta a ser o padrão. As demais decisões não mudam.

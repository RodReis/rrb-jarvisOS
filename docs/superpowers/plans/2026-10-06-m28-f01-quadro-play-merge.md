# M28-F01 — Quadro, Play e Squad: plano de execução

**Fonte:** SPEC-Execucao-01 (`aprovada-pi`), ADR-006, issue #370. Em 2026-10-06 o PI atribuiu o selo e as aprovações à F02 (#126).

## Estado em 2026-10-06

- [x] Projeção persistida das sete colunas, incluindo REVIEWING, consulta de PR/checks e Finalizado confirmado na issue.
- [x] IPC mínimo, tela e atualização em 60 segundos.
- [x] Validação de entrada, SPEC, escopo e revisão de `ci-profile.json`; execução de três IDs com dependência bloqueada em teste de integração.
- [x] Suíte geral: 316 arquivos passaram, 6.018 testes passaram; E2E negativo da ponte real passou.
- [x] Play de produção recusa antes de criar run enquanto a composição do Squad não existir. O encadeador legado não satisfaz RF-014.1.

## Próximas etapas obrigatórias da F01

1. [ ] Compor o Squad no bootstrap: snapshot de perfil, planejamento pela rota da fase, ContextPack, executor de worker e escritor, sandbox/worktree, ciclo TESTE/REVIEWER e integração com a entrega/PR. Um escritor por padrão, conforme ADR-006; dois só na F02.
2. [ ] Preservar slot, fencing token, heartbeat, cancelamento e recuperação ao ligar essa composição. Nenhum run pode ficar ativo sem dono após erro ou reinício.
3. [x] Fechar E1 da SPEC-Pipeline-01: stack Node/Python escolhida pelo PI no app; perfil e matriz persistidos; preflight verifica arquivos e hashes; a aprovação leva os artefatos exatos e o gate compara seus blobs commitados. Workflow adotado e manifesto também entram na revisão. Testes cobrem alterações e bloqueios fail-closed.
4. [ ] Provar no app real o Play de uma e três issues do mesmo MVP: um worktree por issue, dependência bloqueada, slots, equipe acionada e PR/MERGE com check real. Executar os testes e relatórios por categoria da SPEC.
5. [ ] Revisar o diff, commitar e publicar o branch, abrir PR com `refs #370`, acompanhar CI, integrar após gate verde, publicar encerramento e mover a issue para `proplan:done`. Não fechar a issue; aceite final é do PI.

## Atualização em 2026-10-07

- O gate `SLICE_ENTRY` passa ao verificador de marcos os artefatos físicos aprovados; a revisão sintética da SPEC fica fora da lista de caminhos.
- `MarcosService` recalcula cada artefato pelo blob do `HEAD`, incluindo o perfil, a SPEC/matriz e os arquivos do workflow adotado. O gate também exige árvore limpa.
- O CI do SHA `a856646` passou em sete checks e falhou em `test`/`gate` porque o relatório versionado divergia dos artefatos. Relatório local regenerado: Regras 2927/2927, Banco 2325/2325 (25 skips explícitos), Tela 801/801 (1 todo explícito); `--check --no-run --require-entry` e self-check (31 verificações) passaram. O CI precisa rodar novamente no próximo SHA.

**Decisão técnica de segurança:** o Play não chama `EncadeadorDeRuns` até existir o adaptador de Squad. Esse encadeador chama `EntregaService`/`ConstrutorService`, que executam o fluxo antigo e fariam a UI anunciar uma equipe que não rodou.

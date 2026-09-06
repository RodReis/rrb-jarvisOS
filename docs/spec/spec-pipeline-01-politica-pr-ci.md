# SPEC-Pipeline-01 — Política de PR e CI por projeto

- Status: **aprovada-pi**, revisão R2 de 2026-09-06. O PI aprovou: novo MVP/fatia transversal; Windows como ambiente primário; `success` obrigatório; atualização segura da linha Node 22 para Node 24 LTS.
- Origem: pedido do PI para separar orientação do Claude Code no jarvisOS de funcionalidade genérica da pipeline.
- MVP/Fatia: MVP-027 · M27-F01.
- Enquadramento: extensão transversal da entrega autônoma. Não reabre o MVP-009 finalizado nem inventa M9-F07.
- Issue: não criada; publicação de rascunho não coloca nova fatia no Backlog.
- Dependências: SPEC-Entrega-05 (M9-F05), SPEC-Entrega-06 (M9-F06), adapter GitHub M6-F04, pacote aprovado do projeto e contratos de execução vigentes.
- Consumidores futuros: MVP-015 Observabilidade e MVP-023 Blueprints. Não são dependências obrigatórias para a primeira entrega desta SPEC.

## 1. Problema e objetivo

Orientar o Claude Code a produzir PRs melhores não modifica a pipeline determinística. Ela precisa transformar o contrato do projeto-alvo em validações executáveis, preservar as provas e impedir que ganho de tempo seja obtido pulando trabalho necessário.

Na revisão anterior, `src/shared/domain/ci-workflow.ts` gerava Node 22, `npm ci`, lint/typecheck/test/build sequenciais e eventos `push` e `pull_request` sem restrição. `EntregaService.garantirWorkflowDeCi` usa esse gerador. Isso limita a portabilidade e pode executar CI duplicado em pushes de branch com PR aberto. A correção aprovada junto da R2 atualiza o legado para Node 24 LTS; o perfil genérico completo continua sendo o escopo desta fatia.

Objetivo: entregar uma política versionada e um perfil de validação por projeto, consumidos pelo executor e pelo gerador de CI, com execução única por unidade de validação, paralelismo declarado e gate vinculado ao estado realmente validado.

**Genérica** significa independente da aplicação e do executor Claude Code/Codex. O backend remoto inicial continua GitHub/GitHub Actions; não significa suportar qualquer provedor ou linguagem sem perfil compatível.

## 2. Contratos que permanecem

1. SPEC-Entrega-05 continua dona da revisão, recuperação no mesmo PR, snapshot de ruleset, stale SHA, squash e confirmação na origem.
2. Merge autônomo continua ligado por padrão, com kill-switch por projeto. Desligado, o estado terminal é `AWAITING_MERGE`. Esta SPEC não acrescenta confirmação humana por merge.
3. Aprovação de produto não se confunde com merge; usar `refs #N`, sem fechamento automático da issue.
4. A pipeline não contorna merge queue nem restrição de permissão. Quando exigida, continua o comportamento previsto na M9-F05.
5. Check obrigatório ausente, vazio, cancelado, expirado, inválido ou sem sucesso não aprova. Preservar a implementação vigente de `gate-de-merge.ts`, que exige `success` dos obrigatórios; não importar a interpretação permissiva de checks opcionais.
6. Documentos do projeto-alvo entram no mesmo PR antes do merge. Evidência local usa o ledger existente; não criar outro banco operacional ou escrever na branch-base depois do merge.

**Harmonização aprovada:** o critério 11 da SPEC-Entrega-05 foi emendado na mesma decisão do PI. Checks obrigatórios só satisfazem o gate com `success`; `neutral` e `skipped` não comprovam a validação exigida. Isso formaliza o comportamento mais estrito já implementado por `gate-de-merge.ts` e documentado para a M9-F05 em `DEVELOPMENT.md`.

## 3. Dentro e fora

**Dentro:** perfil estruturado no pacote do projeto; validação do perfil; geração determinística de CI; execução de grupos independentes; proteção contra duplicação; preservação de workflow existente; evidência por execução; integração com PR/gate existentes; métricas básicas de duração com disponibilidade explícita.

**Fora:** dashboard novo, alertas recorrentes, aprendizado automático, alteração automática do tamanho das fatias, criação de novos aprovadores, contratação de runners, instalação global de ferramentas, sharding interno de uma suíte, migração de stack, GitLab/Bitbucket e suporte operacional a merge queue.

R2 deve provar dois perfis de stack distintos: Node/npm e Python/pip, ambos com runtime, versão, sistema e shell declarados no pacote. Windows é o ambiente primário e deve ser provado por integração local em Windows/PowerShell. O workflow remoto pode usar Windows ou Linux somente quando o perfil declarar essa escolha; nenhuma plataforma é inferida. Outras combinações respondem incompatibilidade antes de escrever workflow; não recebem fallback silencioso para Node. Não há promessa de acelerar todos os perfis.

## 4. Perfil de validação e política

O artefato estruturado proposto é `ci-profile.json` na raiz do pacote do projeto-alvo, versionado junto dos documentos. A aprovação congela seu conteúdo/hash. `TESTING.md` explica a política; o executor não interpreta prosa livre para inventar comandos nem toma o workflow como fonte superior ao pacote aprovado.

| Campo lógico | Contrato obrigatório |
|---|---|
| Identidade | `schemaVersion`, `profileId`, revisão/hash e origem no pacote aprovado |
| Ambiente | OS/runner compatível, runtime, versão e shell suportado; Windows/PowerShell é obrigatório na R2 |
| Instalação | Comando em argv, diretório de trabalho dentro do checkout, lockfile e versões do ambiente |
| Validações | IDs estáveis, argv, cwd, dependências por ID e grupo de execução |
| Evidência | Saídas declaradas por validação, formato/adapter compatível e condição de completude |
| Serviços | IDs e receita de preparação autorizada, consumidores e verificação de prontidão |
| Recursos | Timeout positivo por job, limite de paralelismo e orçamento conforme política existente |
| Cache | Apenas dependências/ferramentas; paths restritos e chave incluindo runtime, OS, lockfile e revisão relevante |
| Context obrigatório | `validacao` nos workflows gerados pela pipeline; nunca renomear para `gate` só porque o jarvisOS usa esse nome |
| Workflow existente | Modo de adoção/migração e referência ao conteúdo observado; nenhuma sobrescrita implícita |

IDs repetidos, dependências inexistentes/cíclicas, argv vazio, cwd que escape do checkout, runtime/adapter desconhecido, evidência sem consumidor e limites inválidos são erros explícitos antes de efeitos externos.

Variáveis de ambiente são declaradas por nome e origem autorizada; valores secretos não entram no perfil, em logs nem na descrição da PR. Texto de título/corpo/branch nunca é interpolado diretamente como shell. A geração preserva argv e escapa também metacaracteres de YAML/expressões do provedor: escape POSIX isolado não neutraliza uma expressão `${{ ... }}`.

### Compatibilidade com projetos atuais

- Pacote legado com `ComandosDeValidacao` recebe representação explícita do ambiente legado atualizado: Node 24 LTS/npm, quatro comandos em sequência. Registrar `legacy`, não alegar descoberta automática da stack.
- O fallback legado não paraleliza, migra ou modifica proteções por iniciativa própria. Perfil incompatível não usa esse fallback.
- Perfil novo ou revisão material passa pelos gates existentes de impacto/aprovação do pacote. Nenhum novo aceite é criado quando a revisão já está aprovada.
- O perfil e os mesmos argumentos alimentam execução local e remota. Otimização de topologia não autoriza mudar o teste ou requisito verificado.

## 5. Geração, paralelismo e deduplicação

1. Geração é função determinística do perfil aprovado e da versão de geração adotada. Mesma entrada produz os mesmos bytes.
2. R2 roda todas as validações declaradas em todo PR elegível, incluindo documental. Seleção automática por impacto não entra nesta revisão.
3. Independência deve estar declarada. Sem prova explícita, comandos permanecem sequenciais. Se build inclui typecheck, o perfil pode representar essa dependência, mas o gerador não modifica scripts por heurística textual para deduplicá-los.
4. Uma unidade de validação é executada uma vez por ambiente e tentativa de CI. Consumidores de relatório reutilizam evidência dessa execução; exigir carimbo não dispara novamente os runners. Reexecução local e remota continua legítima: são ambientes e finalidades diferentes.
5. Cada job tem instalação compatível e serviços necessários. Serviços compartilhados, disco e singletons não são presumidos isolados; grupos incompatíveis ficam serializados. Banco do jarvisOS continua serial internamente.
6. Para workflows novos gerados, validar branches de trabalho por `pull_request`. `push` fica restrito à branch-base quando o pacote exigir verificação pós-merge; sem CI duplicado de branch + PR. Um push na base tem finalidade própria e não é deduplicado como se fosse o PR.
7. Concorrência agrupa por repositório/workflow e número do PR, cancelando apenas execução anterior do mesmo PR. Não cancelar outro PR, outra execução local da pipeline ou validação pós-merge da base.
8. O job agregado mantém o nome/context estável `validacao`, usa dependências explícitas e executa mesmo após falha de dependentes. Exige sucesso de todas as validações obrigatórias; `skipped` inesperado ou resultado ausente falha.
9. Workflow humano com jobs condicionais precisa de um gate agregado cuja decisão de skip seja verificável; R2 não gera automaticamente novos filtros. Falha na classificação nunca dispensa uma prova.

## 6. Preservação de workflows existentes

Esta seção propõe extensão explícita à regra da SPEC-Entrega-05 de reescrever apenas quando os comandos mudarem: **perfil aprovado materialmente diferente também pode justificar atualização**, preservando a edição humana.

- Workflow ausente: gerar no primeiro PR autorizado, somando `validacao` aos contexts obrigatórios existentes pelo mecanismo já aprovado na M9-F05.
- Workflow gerado e sem edição externa: comparar perfil/revisão adotada com o manifesto anterior; atualizar apenas por diferença material aprovada.
- Workflow manual, conteúdo desconhecido ou edição concorrente: preservar bytes. Produzir proposta de adoção/migração com diff; nunca concluir equivalência apenas por encontrar uma substring `run:`.
- Quando o contrato existente puder ser verificado sem alterações, adotá-lo com a referência observada. Quando a pipeline não conseguir comprovar equivalência, manter o PR e informar impedimento de validação, sem substituir o arquivo.
- Mudança de nome do check obrigatório não faz parte da otimização. Não remover contexts alheios, relaxar proteção, ligar auto-merge nativo ou forçar novas reviews.
- Atualização da versão do gerador não migra automaticamente todos os projetos; a versão efetiva permanece fixada até adoção material aprovada.
- Salvar hash anterior e hash esperado antes da escrita; alteração concorrente invalida o plano. Repetição após crash não duplica arquivos, PRs nem operações de proteção.

## 7. Gate, retomada e publicação

O perfil é resolvido antes de escrever o workflow. Em seguida, a pipeline mantém o fluxo da M9-F05: executar/avaliar, revisar delta, corrigir quando elegível, publicar no mesmo PR, observar checks e confirmar merge na origem.

A evidência identifica `projectId`, run lógico da pipeline, execução/tentativa de CI, revisão do perfil, head, base e commit efetivamente testado. O head do PR e o merge commit sintético do GitHub são campos distintos; a origem deve comprovar sua relação, não exigir igualdade de SHAs que representam objetos diferentes.

Novo head, avanço relevante da base ou alteração de ruleset invalida a decisão de integração anterior e chama reconciliação. Confirmar o estado e a elegibilidade de merge na origem imediatamente antes da mutação. Se as permissões não permitirem assegurar a validação da combinação corrente, preservar PR e explicar a limitação; não alegar garantia atômica baseada apenas em uma leitura anterior.

Cancelamento invalida os resultados incompletos daquela tentativa. Reinício consulta a execução existente antes de disparar outra. Retry usa política/orçamento já existentes e causa classificada; não repetir testes de aplicação cegamente até obter verde.

Timeout de execução do job é falha do CI; teto de espera do monitor mantém a semântica atual de `AWAITING_MERGE`, sem inventar sucesso ou marcar o CI como falhado só porque o observador parou de esperar.

O adapter de criação da PR recebe descrição com finalidade, antes/depois, rastreabilidade e evidência/limites. Não mede qualidade por número rígido de linhas nem separa automaticamente a fatia aprovada em múltiplas issues.

## 8. Evidência e métricas

O job de relatório consome somente artefatos completos do mesmo estado validado e tentativa. Manifesto enumera validações/categorias esperadas e arquivos com hash. Artefato ausente, de outro run/head/perfil ou produzido por job falho não pode gerar PASS. Worker encerrado sem relatório completo invalida a prova mesmo que o processo principal retorne zero.

Adapters preservam a semântica do relatório do projeto: contagens, cobertura, histórico e carimbo quando exigidos. Não impor `reports/TESTS.md`, Vitest, Supabase ou Electron a projetos que não os declarem. Quando o pacote adota o relatório ADR-003, mantê-lo integralmente. Cobertura percentual não é somada nem calculada como média simples entre jobs.

Registrar no `ExecutionLedger`/`ExternalRef` existentes, com escopo e correlação atuais: PR, head/base/tested SHA, CI run ID/attempt, perfil, resultados, started/completed/observed timestamps e vínculo aos artefatos. Campo indisponível é `unavailable`/ausente com razão, nunca zero inventado.

Métricas deriváveis: fila, preparação, duração dos jobs, tempo do CI, tentativas e soma de duração dos jobs. Espera de revisão e elegibilidade para merge dependem de eventos observados; não subtrair timestamps arbitrários para fingir essas medidas. Dados ficam prontos para o MVP-015; alertas, p95 e dashboard não são implementados aqui. Metas por projeto são informativas e não autorizam reduzir provas.

## 9. Integração no código existente

| Ponto atual | Responsabilidade da evolução |
|---|---|
| `src/shared/domain/ci-workflow.ts` e respectivos testes | Validação/geração pelo perfil e compatibilidade legada; manter `validacao` |
| `src/shared/domain/gate-de-merge.ts` e respectivos testes | Preservar sucesso obrigatório e reconciliar identidade/base/regra quando os novos dados chegarem |
| `src/main/pipeline/entrega-service.ts` e integração | Resolver perfil, preservar workflow, reaproveitar evidência e manter PR único |
| `src/main/pipeline/merge-policy-service.ts` | Consumir política existente sem mudar default ou kill-switch |
| Adapter GitHub e contratos normalizados | Identidade da execução, tentativa, timestamps e associação entre head/tested SHA |
| Ledger/ExternalRef e persistência existentes | Acrescentar dados versionados com migration compatível quando necessário, sem segundo ledger |
| Pacote/geração de documentos do projeto | Incluir perfil aprovado e instruções legíveis para executores diferentes |

Blueprints pode transportar o perfil como artefato versionado, mas não transporta aprovação nem permissão de outro projeto. Não implementar catálogo ou migração de blueprints nesta entrega.

## 10. Critérios de aceite verificáveis

1. Dois projetos-alvo, Node/npm e Python/pip, recebem CI a partir de seus perfis; ambos são exercitados em Windows/PowerShell, e Python não recebe `npm ci` nem Node por padrão.
2. Pacote legado mantém ambiente/comandos anteriores, sem migração tácita ou perda de validação.
3. Perfil inválido/cíclico/incompatível falha antes de escrita, push ou alteração remota.
4. Mesmo perfil/revisão produz bytes iguais; segundo run não reescreve por cosmética.
5. Cada validação roda uma vez por ambiente/tentativa; relatório e carimbo reutilizam a mesma evidência. Fixture com contador de invocações prova isso.
6. Dois grupos independentes executam em paralelo; dependência e recurso compartilhado preservam a ordem. Falha de dependência bloqueia o agregado.
7. Novo push cancela execução antiga apenas do mesmo PR; PR distinto e run pós-merge permanecem ativos.
8. Push de branch com PR aberto não duplica o CI gerado; verificação pós-merge, se declarada, continua executando.
9. Job falho, cancelado, pulado inesperadamente, expirado ou ausente impede `validacao=success`.
10. Workflow humano e edição concorrente são preservados; adoção inconclusiva produz causa explícita, sem overwrite.
11. Mesmo nome de check em origem não confiável, tentativa antiga, head incorreto ou tested SHA não associado não satisfaz a evidência esperada; validar emissor quando a regra da origem o especificar.
12. Avanço da base ou ruleset invalida a decisão e reconcilia; uma leitura prévia não basta para afirmar integração segura.
13. Artefato ausente, worker morto, hash incorreto ou mistura de execuções impede PASS; cobertura não é somada por percentuais.
14. Retomada após crash reusa/reconcilia o PR e CI existentes; não duplica merge nem reescreve a main.
15. Merge autônomo ligado conclui pelos gates existentes; desligado termina em `AWAITING_MERGE`; nenhuma confirmação humana adicional é introduzida por esta SPEC.
16. Repositório sem permissão, check obrigatório ou Actions disponível termina com causa explicável, nunca verde por ausência. Merge queue não é contornada.
17. Dados de duração indisponíveis não aparecem como zero; todo resultado é rastreável por projeto/run/head/perfil.
18. Títulos/corpos/argv contendo aspas, nova linha, `$()` e expressões do provedor não injetam comandos ou alteram o YAML gerado.

## 11. Plano de prova e entrega

Testes unitários do perfil/gerador/gate; integração da orquestração com contratos reais dos adapters; contrafactuais de falsa aprovação; smoke GitHub real em dois projetos-alvo de teste, com credencial e orçamento autorizados para esse smoke. Não tocar repositórios de produção para provar migração.

Medir antes/depois em perfil equivalente: tempo decorrido, preparação, número de invocações e soma de minutos dos jobs. A prova de desempenho exige ausência de perda de testes e evidencia custo; não fixa a redução de 55% da #311 como requisito universal. Smoke não executado permanece `not_run`.

A implementação futura pode ser dividida em entregas verticais: perfil/compatibilidade/gerador; integração e preservação de workflow; evidência/retomada e smoke. O fluxo de planejamento cria a issue canônica da M27-F01 antes de iniciar a implementação completa desta SPEC.

## 12. Decisões aprovadas na R2

- Separar guia operacional local desta funcionalidade genérica; não duplicar SPEC-Entrega-05.
- Adotar perfil estruturado aprovado e iniciar com Node/npm e Python/pip em Windows/PowerShell; runners Linux permanecem possíveis quando declarados pelo perfil.
- Preservar workflows humanos e tratar migração como mudança material; não espalhar otimização por todos os projetos automaticamente.
- Preservar merge autônomo e kill-switch existentes; proteções adicionais do plano local não se tornam imposição universal.
- Definir MVP/fatia responsável ao aprovar, sem reabrir MVP finalizado por conta própria.

## 13. Decisões do PI na aprovação da R2

1. A evolução entra no MVP-027, M27-F01, sem reabrir o MVP-009.
2. Windows é o ambiente primário do PI e prova obrigatória. Linux não é default implícito; só entra quando declarado pelo perfil.
3. Apenas `success` satisfaz check obrigatório. `neutral` e `skipped` não comprovam uma validação exigida.
4. O legado do jarvisOS passa para Node 24 LTS, compatível com o Node 24.15.0 do host. Electron mantém runtime embutido próprio e módulos nativos recompilados para seu ABI.

Não há pergunta estrutural aberta nesta revisão. A issue da fatia deve ser criada pelo fluxo de planejamento e entrar em Backlog; a aprovação não altera `proplan:next` nem inicia a implementação completa do perfil genérico.

## Referências

- [SPEC-Entrega-05](spec-entrega-05-revisao-ci-merge.md), [SPEC-Entrega-06](spec-entrega-06-evidencia-limpeza-continuidade.md), [CONVENTION](../CONVENTION.md), [REVIEW](../REVIEW.md) e [TESTING](../TESTING.md).
- [Guia local do Claude Code](../GUIA-PRS-CLAUDE-CODE.md) e [plano de origem](../superpowers/plans/2026-09-06-melhores-praticas-pr-github.md).
- [GitHub: autoria e autorrevisão de PR](https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes).
- [GitHub: checks obrigatórios e SHA](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
- [GitHub Actions: jobs e dependências](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs).
- [GitHub Actions: concorrência](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency).

# Design — Pipeline local-first de desenvolvimento com IA

- Status: **aprovado pelo PI** em 2026-08-28.
- Produto: JARVIS OS, área profissional; a pipeline é capacidade do Agentic OS e usa o `workspace_id` de JARVIS.
- Recorte inicial: **planejamento + execução automática da primeira fatia aprovada**, usando Claude Code.
- Fontes relacionadas: `PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/CONVENTION.md`, `docs/iniciais/requisitos-agent-os.md`, `docs/mvp/mvp-004-execucao-real.md` e `docs/mvp/mvp-005-providers-vault-budget.md`.

## 1. Problema

O PI precisa criar um projeto, transformar uma intenção vaga em documentos e fatias verificáveis e executar a primeira fatia sem operar Git, terminal ou CI manualmente. A automação deve continuar após falhas corrigíveis, parar com diagnóstico quando não puder avançar e preservar evidência suficiente para explicar cada decisão e efeito real.

A proposta não é um módulo isolado. Ela combina planejamento versionado, aprovação humana, bootstrap de repositório, grafo de dependências, execução local, Claude Code, GitHub, CI, recuperação, política, auditoria e orçamento. O desenho respeita a ordem defensiva já definida na arquitetura: execução e auditoria antes de autonomia ampla.

## 2. Decisões do PI

1. O modelo é **autonomia supervisionada**: o PI governa produto; a construção e o Git são automáticos.
2. O PI aprova uma vez o pacote de PRD e arquitetura do projeto.
3. O PI aprova cada MVP e cada spec/fatia antes da construção.
4. Depois da aprovação da fatia, branch, commits, push, PR, espera do CI, recuperação e merge são automáticos.
5. O primeiro recorte começa no prompt do projeto e termina no merge ou bloqueio da primeira fatia.
6. O primeiro provider é Claude Code, atrás de um adapter.
7. O refinamento usa um wizard em pop-up, uma pergunta por vez, com recomendação e sugestão.
8. Cada pergunta pode oferecer **Decida por mim**. A IA escolhe quando houver delegação explícita e registra justificativa e origem da decisão.
9. Após criar o PRD preliminar, o PI deve anexar obrigatoriamente `DESIGN-SYSTEM.md` e protótipos HTML.
10. A recuperação permite **três tentativas totais**: implementação inicial e até duas correções.

## 3. Objetivo e condição de parada

### 3.1 Objetivo da V1

Executar esta jornada de ponta a ponta:

1. criar e configurar um projeto novo;
2. refinar o prompt pelo Wizard A;
3. gerar o PRD preliminar;
4. anexar o design system e os protótipos;
5. gerar e aprovar a arquitetura;
6. propor e aprovar MVP e primeira fatia;
7. criar as issues e dependências no GitHub;
8. implementar a primeira fatia com Claude Code;
9. validar localmente, abrir PR, observar CI, recuperar falhas corrigíveis e fazer merge automático;
10. registrar documentos, referências GitHub, uso, tentativas e evidências.

### 3.2 Condição de parada

A V1 chega a um estado terminal quando ocorrer um destes resultados:

- `merged`: primeira fatia mergeada automaticamente, com todos os gates satisfeitos;
- `blocked`: execução preservada com causa verificável, evidência e próxima ação recomendada.

O loop por todas as fatias não pertence à V1. Ele só entra depois de a primeira jornada real provar os contratos de estado e recuperação.

## 4. Fora do escopo da V1

- Codex ou múltiplos providers em produção.
- Agent, Squad e scheduler genéricos.
- Execução concorrente de várias fatias do mesmo projeto.
- Execução automática de todos os MVPs até o encerramento do produto.
- Runner GitHub self-hosted controlando o computador pessoal.
- Deploy ou publicação de produção.
- Ingresso de repositório existente; a prova começa pela criação de projeto novo.
- Exclusão automática do repositório remoto ao remover um projeto do JARVIS OS.

## 5. Abordagens avaliadas

### 5.1 GitHub Actions como orquestrador

O workflow chamaria Claude Code num runner self-hosted e controlaria PR e merge. Foi descartado porque concentra credenciais e acesso ao computador num ambiente que executa código do repositório, não oferece estado durável suficiente para o produto e amplia o impacto de um workflow comprometido.

### 5.2 JARVIS OS como orquestrador local-first — escolhida

O processo main do Electron controla execução, política, fila, adapters e persistência. GitHub mantém repositório, issues, PRs, checks e merge. GitHub Actions executa apenas CI; nunca recebe a autenticação do Claude nem controle do desktop.

Essa abordagem acompanha a arquitetura existente: renderer sem Node, IPC tipado, SQLite como fonte operacional, adapters isolados, Policy Engine, `AuditEvent`, vault e BudgetPolicy.

### 5.3 Motor externo de workflows

Temporal, n8n ou equivalente manteria retries e workflows duráveis. Foi diferido porque adicionaria infraestrutura, Docker permanente e uma segunda fonte operacional antes de a jornada vertical estar provada.

## 6. Arquitetura

### 6.1 Renderer

- **Project Hub**: lista, criação, visualização, edição de metadados e arquivamento de projetos.
- **Wizard A**: perguntas, alternativas, recomendação, `Decida por mim`, progresso e revisão.
- **Approval Gate**: aprovação de pacote PRD/arquitetura, MVP e spec/fatia.
- **Execution Board**: fila, tentativa, eventos, CI, bloqueios, custo e próxima ação.

O renderer não acessa segredo, Node, processo, Git ou filesystem. Toda operação passa por IPC tipado.

### 6.2 Processo main

- **Project Bootstrapper**: diretório, repo local/remoto, checkout e templates iniciais.
- **Planning Orchestrator**: `ProjectBrief` → PRD → anexos de design → arquitetura → MVPs → specs.
- **Dependency Planner**: DAG de MVPs e fatias.
- **Durable Queue**: WIP igual a um, leases, pausa e retomada.
- **Recovery Controller**: classificação de falha, delta, tentativas e bloqueio.
- **Policy Engine**: autorização fail-closed e escopo de recurso.
- **Reconciler**: consulta filesystem, Git e GitHub após reinício ou estado inconclusivo.

### 6.3 Adapters

- **Claude Code Adapter**: subprocesso local app-managed, argumentos controlados, cwd controlado, saída estruturada, timeout, cancelamento e kill da árvore de processos.
- **GitHub Adapter**: owner, repo, issues, dependências, branch, PR, checks, merge e referências externas.
- **Local Tool Adapter**: Git, build e testes dentro da allowlist.
- **Artifact Validator**: JSON Schema, links documentais, escopo do diff, arquivos de debug e critérios executáveis.

### 6.4 Persistência

- **SQLite**: projetos, sessões de planejamento, DAG, fila, runs, tentativas, leases e eventos.
- **AuditEvent**: evidência antes/depois de efeitos reais, conforme ADR-004.
- **Execution Ledger**: duração, tokens, custo estimado, commits, PR, CI e bloqueios.
- **Vault**: credenciais por referência, nunca valor cru no renderer ou log.

## 7. Fronteiras e fontes de verdade

| Informação | Fonte de verdade |
|---|---|
| Requisitos e decisões aprovadas | arquivos versionados no repositório |
| Issue, PR, checks, head SHA e merge | GitHub |
| Fila, lease, tentativa e evento de execução | SQLite local |
| Segredos | Vault/armazenamento seguro do SO |
| Uso e custo | eventos observados pelo adapter; custo pode ser estimado ou desconhecido |

O SQLite guarda hash e referência da revisão documental; não mantém outra cópia editável dos documentos aprovados. Estado externo é sempre confirmado na origem. Silêncio, cache ou ausência de evento não são evidência de conclusão.

## 8. Fluxo da V1

1. O PI cria o projeto e escolhe owner, nome, visibilidade, diretório e template.
2. O bootstrapper cria o repositório e o checkout local controlado.
3. O Wizard A refina o prompt e salva cada resposta.
4. O Planning Orchestrator gera o PRD preliminar.
5. O fluxo pausa até receber `DESIGN-SYSTEM.md` e ao menos um protótipo HTML.
6. O validator registra origem e hash dos anexos; o preview HTML roda isolado.
7. O Planning Orchestrator gera a arquitetura e o pacote documental.
8. O PI aprova a revisão exata de PRD + arquitetura + anexos de design.
9. Claude propõe MVPs; o PI aprova cada MVP.
10. Claude gera o DAG, a spec e os critérios executáveis da primeira fatia; o PI aprova a spec.
11. O GitHub Adapter cria a issue da fatia e suas relações.
12. A Durable Queue libera a primeira fatia pronta.
13. Claude Code implementa em worktree dedicado, com testes e documentação.
14. O validator verifica escopo e qualidade local; GitHub Adapter abre o PR.
15. O adapter acompanha CI e o Recovery Controller corrige falhas elegíveis.
16. Todos os gates verdes autorizam merge automático por squash.
17. O reconciler confirma o merge e o ledger registra a evidência terminal.

## 9. Wizard A

### 9.1 Comportamento

O wizard é guiado por `ProjectBriefSchema`. Ele mostra uma pergunta por vez, mantém progresso visível e salva após cada resposta. A IA pode criar perguntas complementares, mas não pode omitir os blocos obrigatórios.

Cada pergunta oferece:

- duas ou três alternativas e campo livre;
- recomendação destacada, com justificativa e impacto;
- `Não sei`, que cria uma decisão pendente;
- `Decida por mim`, que delega explicitamente a escolha à IA;
- explicação de por que a pergunta existe e quais artefatos ela influencia.

### 9.2 Blocos obrigatórios

1. identidade, owner, diretório e repositório;
2. problema, usuários e resultado esperado;
3. escopo, fora de escopo e métricas de sucesso;
4. jornadas e comportamento principal;
5. domínio, entidades e dados;
6. integrações e dependências externas;
7. stack, restrições e decisões arquiteturais;
8. requisitos não funcionais, testes e CI;
9. política Git, provider, limites e orçamento;
10. riscos, hipóteses e decisões abertas.

### 9.3 Decida por mim

A ação é válida somente por comando explícito do PI naquela pergunta. A resposta registra:

- `decisionSource: ai_delegated`;
- opção escolhida e alternativas consideradas;
- justificativa;
- hipóteses usadas;
- nível de confiança;
- impacto nos artefatos e no escopo.

A IA pode escolher a solução de produto ou técnica que considere mais adequada às restrições já registradas. Ela não pode inventar credenciais, owner, fatos externos ou dados de negócio inexistentes. Quando faltar fato necessário, a decisão permanece pendente.

Todas as decisões delegadas aparecem agrupadas na revisão final. A aprovação do pacote pelo PI confirma essas escolhas.

### 9.4 Condição de conclusão

`Finalizar planejamento` só fica disponível quando:

- o schema está válido;
- não há contradição aberta;
- decisões de escopo estão resolvidas ou delegadas;
- riscos críticos possuem mitigação ou aceite;
- critérios de sucesso são executáveis;
- provider, orçamento e política Git estão definidos.

Editar após a finalização cria nova revisão. Nenhuma aprovação anterior é reaproveitada silenciosamente.

## 10. Artefatos

### 10.1 Gerados antes dos anexos de design

- `project.json`: contrato canônico validável por JSON Schema;
- `docs/PRD.md`: PRD preliminar derivado da revisão do wizard.

### 10.2 Anexos obrigatórios do PI

- `docs/design/DESIGN-SYSTEM.md`;
- um ou mais protótipos HTML;
- manifesto com origem, nome, hash e relação com jornadas do PRD.

O HTML nunca roda com acesso ao Electron, Node, filesystem, credenciais ou cookies do app. O preview usa origem isolada e sandbox restritivo. Arquivos anexados são tratados como entrada não confiável.

### 10.3 Gerados após os anexos

- `docs/ARCHITECTURE.md`;
- `docs/DECISIONS.md`;
- `docs/CONVENTION.md`;
- `docs/STATUS.md`;
- `docs/mvp/mvp-<nnn>-<slug>.md` após proposta e aprovação do MVP;
- `docs/spec/spec-<mvp>-<fatia>-<slug>.md` após decomposição da fatia.

O pacote aprovado referencia hashes do PRD, arquitetura, design system e protótipos. Mudar qualquer entrada estrutural cria nova revisão e invalida as aprovações dependentes.

## 11. Modelo mínimo de dados

### 11.1 Entidades

- **Project**: identidade, owner, repo, diretório, template, status derivado e próxima ação derivada.
- **PlanningSession**: schema, respostas, recomendações, decisões delegadas e pendências.
- **ArtifactBundle**: revisão imutável, paths, hashes e estado de aprovação.
- **WorkItem**: `mvp` ou `slice`, spec, dependências e referências GitHub.
- **DependencyEdge**: relação direcionada entre work items.
- **Approval**: alvo, revisão, PI, decisão e timestamp.
- **ExecutionRun**: snapshot da spec, commit base, provider, política, lease e resultado.
- **Attempt**: número, hipótese, delta, falha, uso e resultado.
- **ExternalRef**: issue, branch, PR, check run, base SHA, head SHA e merge SHA.
- **ExecutionEvent**: evento operacional ordenado e correlacionado.
- **UsageEvent**: tokens observados, custo estimado ou `unknown`.
- **FailureSignature**: categoria, alvo, trecho normalizado e hash.

### 11.2 Máquinas de estado

#### Planejamento

`draft → refining → review → awaiting_pi → approved`

Alteração de uma revisão aprovada cria nova revisão em `refining`; não reabre nem sobrescreve o registro anterior.

#### MVP/fatia

`planned → awaiting_pi → ready → running → pr_ci → merged | blocked`

`ready` exige aprovação da revisão correta e todas as dependências satisfeitas.

#### Run/tentativa

`created → running → succeeded | failed | timed_out | cancelled | blocked`

O run agrupa até três tentativas de geração/correção de código.

### 11.3 Invariantes

1. Aprovação referencia alvo e revisão exatos.
2. O run mantém snapshot da spec, base SHA, provider, política e schema.
3. Índice/lease transacional impede dois runs ativos no mesmo projeto.
4. Checks verdes só valem para o head SHA observado.
5. O teto é uma tentativa inicial e no máximo duas correções.
6. Mesma assinatura de falha sem nova hipótese bloqueia antes do teto.
7. Estado externo é confirmado no GitHub antes de qualquer declaração ou merge.
8. Alteração estrutural invalida apenas artefatos e aprovações dependentes, com rastreabilidade.

## 12. Git automático

Cada fatia usa um worktree exclusivo. O checkout ativo do usuário nunca é usado para construção automatizada.

1. buscar a branch-base e registrar o SHA;
2. criar branch e worktree da fatia;
3. executar Claude Code, testes e validação de artefatos;
4. confirmar que o diff está dentro do escopo aprovado;
5. commitar, fazer push e abrir PR;
6. acompanhar CI com processo monitorado equivalente a `gh pr checks <n> --watch`;
7. verificar novamente head SHA, checks, conflitos, diff e política;
8. fazer merge automático por squash;
9. confirmar o merge na origem;
10. remover o worktree operacional e registrar os hashes.

Branch protection exige checks obrigatórios, mas não revisão humana do PR. Se a branch-base avançar, a pipeline faz rebase e revalida. Resolução do conflito pelo Claude consome tentativa quando houver alteração de código.

## 13. Recuperação e falhas

| Categoria | Ação | Consome tentativa? |
|---|---|---:|
| Schema/prompt incompleto | voltar ao wizard com a lacuna | não |
| Aguardando PI | pausar de forma durável | não |
| Autenticação ou quota | `BLOCKED_PROVIDER` | não |
| Política negada | bloquear imediatamente | não |
| GitHub indisponível/rate limit | backoff limitado; depois `BLOCKED_EXTERNAL` | não |
| Processo não iniciou | `BLOCKED_INFRA` | não |
| Claude caiu/expirou após iniciar | matar árvore; permitir nova tentativa | sim |
| Build/teste local falhou | enviar delta e erros relevantes | sim |
| CI falhou | nova tentativa no mesmo PR/head atual | sim |
| Falha repetida sem delta | bloquear antes de nova chamada | não cria tentativa |
| Conflito com base | rebase; Claude resolve se necessário | se chamar o Claude |

O prompt de recuperação recebe somente:

- snapshot da spec;
- diff da tentativa;
- checks ou comandos que falharam;
- trechos relevantes de log;
- assinaturas das falhas anteriores;
- mudanças já tentadas.

Histórico completo não é injetado indiscriminadamente.

## 14. Segurança operacional

- `--dangerously-skip-permissions` é proibido na V1.
- O adapter usa binário e argumentos controlados, sem shell intermediário.
- O cwd é o worktree aprovado.
- Ferramentas e diretórios são explicitamente permitidos.
- Credenciais são resolvidas por referência e não entram no prompt, renderer ou log.
- GitHub Actions não recebe autenticação do Claude.
- Comando destrutivo, caminho fora da allowlist, outro projeto ou elevação são bloqueados.
- Timeout encerra toda a árvore de processos no Windows.
- Reinício dispara reconciliação; ação inconclusiva não é repetida sem consultar as fontes reais.
- Conteúdo de issue, PR, log, arquivo e HTML é entrada não confiável e não substitui instruções aprovadas.
- Anexo HTML é armazenado como arquivo e visualizado em sandbox isolado.
- Exclusão/arquivamento do projeto no JARVIS OS nunca apaga automaticamente o repositório remoto.

## 15. Observabilidade, auditoria e custo

Toda transição material produz:

- `ExecutionEvent` para progresso e estado operacional;
- `AuditEvent` antes/depois do efeito real;
- log estruturado em pt-BR, com `correlationId` e redaction;
- `UsageEvent` com tokens observados e custo estimado;
- `FailureSignature` para repetição e recuperação.

O ledger separa:

- tokens observados;
- custo monetário observado, quando fornecido;
- custo estimado;
- limite conhecido da assinatura;
- custo `unknown` quando o provider não expõe valor monetário.

Plano Max/Pro não é tratado como API de orçamento exato. Quota ou sessão esgotada vira falha de provider, não falha de código.

## 16. Testes

### 16.1 Regras puras

- `ProjectBriefSchema` e conclusão do wizard;
- `Decida por mim`, justificativa e origem;
- revisão e invalidação de aprovação;
- DAG sem ciclos ou dependências ausentes;
- teto de tentativas e detecção de repetição;
- gates de merge pelo SHA correto.

### 16.2 Banco e recuperação

- autosave e retomada;
- WIP/lease transacional;
- reinício durante execução;
- reconciliação de evento incompleto;
- auditoria e ledger append-only.

### 16.3 Contratos de adapter

- Claude Code com eventos gravados e fixtures;
- GitHub com issues, PRs e checks simulados;
- timeout, quota, autenticação e CI;
- normalização de eventos externos.

As suítes comuns não gastam assinatura do Claude.

### 16.4 Git real temporário

- repo, branch e worktree;
- commit restrito ao escopo;
- rebase e conflito;
- limpeza após merge;
- preservação do checkout ativo.

### 16.5 Interface Electron

- recomendação, `Decida por mim` e revisão das decisões delegadas;
- fechamento e retomada do pop-up;
- upload obrigatório de design system e HTML;
- preview isolado;
- estados de espera, execução, recuperação e bloqueio.

### 16.6 Segurança

- path traversal;
- HTML malicioso;
- prompt injection em issue, log e arquivo;
- segredo na saída do Claude;
- comando ou path fora da allowlist;
- alteração fora do worktree;
- checks verdes de outro SHA.

### 16.7 Prova operacional real

A prova roda localmente, sob comando explícito, e não no CI comum:

1. criar projeto;
2. responder parte do wizard e delegar parte à IA;
3. gerar PRD;
4. anexar design system e protótipos;
5. gerar arquitetura, MVP e primeira spec;
6. aprovar os três gates;
7. criar repo/issues reais;
8. implementar com Claude Code real;
9. abrir PR, acompanhar CI e recuperar falha elegível;
10. fazer merge automático;
11. verificar ledger, hashes e referências.

## 17. Critérios de aceite da V1

1. Um projeto novo percorre o Wizard A com autosave, recomendação e `Decida por mim` auditável.
2. PRD preliminar é gerado e o fluxo bloqueia arquitetura até receber `DESIGN-SYSTEM.md` e protótipo HTML.
3. O preview do HTML não acessa Electron, Node, filesystem ou credenciais.
4. O pacote PRD/arquitetura/anexos é versionado e aprovado por revisão.
5. MVP e primeira spec passam por aprovações distintas.
6. O DAG é acíclico e somente fatia aprovada, desbloqueada e no topo da fila vira `ready`.
7. Claude Code executa em worktree dedicado, nunca no checkout ativo.
8. Testes, docs e validação de escopo são executados antes do PR.
9. CI é observado e confirmado no GitHub para o head SHA atual.
10. Falha corrigível recebe no máximo duas correções; repetição sem delta bloqueia cedo.
11. Merge por squash é automático quando todos os gates técnicos e de política passam.
12. Reinício não duplica execução, commit, PR ou merge.
13. Resultado terminal é `merged` ou `blocked` com evidência e próxima ação.
14. A jornada real completa passa com Claude Code e GitHub reais.

## 18. Dependências no roadmap

Esta capacidade não deve furar os guardrails já planejados:

1. execução real e terminal controlado do MVP-004;
2. vault, primeiro provider, BudgetPolicy e adapter de Claude Code do MVP-005;
3. conector GitHub no MVP-006;
4. workflow durável, squads e automação ampla no Corte 4.

A especificação e o plano podem ser preparados antes, mas a implementação deve respeitar essas dependências ou transformá-las em fatias explícitas do mesmo programa, sem duplicar infraestrutura.

## 19. Referências técnicas verificadas

- Claude Code CLI: modo não interativo com `-p` e saída `json`/`stream-json`; limite de turns e allow/disallow tools devem ser configurados pelo adapter.
- Codex futuro: o modo não interativo é `codex exec`; eventos são JSONL com `--json`, e o resultado final pode usar `--output-schema`. Não reutilizar as flags do Claude.
- GitHub: runner self-hosted não é considerado ambiente efêmero confiável; a V1 mantém Claude e credenciais fora do GitHub Actions.

## 20. Questões encerradas

Não há questão de produto aberta para este design. Escolhas de implementação — schemas exatos, contratos IPC, migrations, nomes de eventos, templates e divisão em fatias — pertencem ao plano de implementação e não podem alterar as decisões desta especificação sem nova aprovação do PI.

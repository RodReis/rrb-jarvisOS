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
11. Não existe aceite duplo: a mesma revisão aprovada não volta ao PI, e merge não exige aprovação humana adicional. Uma mudança estrutural cria outra revisão e reabre somente o gate afetado.
12. A pipeline executa apenas requisitos fornecidos ou aprovados pelo PI. Ela não deduz exigências legais, regulatórias, de consentimento ou classificações de domínio.

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

| Artefato | Responsabilidade e limite |
|---|---|
| `docs/ARCHITECTURE.md` | Desenho, módulos, fronteiras, dados, integrações e resiliência. Não recebe histórico de execução. |
| `docs/DECISIONS.md` | Índice dos ADRs e decisões estruturais vigentes. Toda mudança estrutural exige leitura prévia; a decisão completa vive em `docs/adr/`. |
| `docs/CONVENTION.md` | Contrato de domínio: entidades, estados, invariantes e regras de negócio. É o coração do produto, não um manual genérico de estilo. |
| `docs/STATUS.md` | Kanban/roadmap curto e **índice Fatia ↔ SPEC**, fonte única da numeração. Mantém somente estado atual, ordem e referências; prosa longa é proibida. |
| `docs/STATUS-ARQUIVO.md` | Histórico detalhado que complementa o `STATUS.md`. Recebe decisões operacionais encerradas, mudanças de ordem e contexto removido do status corrente. Não governa estado atual. |
| `docs/LANDSCAPE.md` | Cenário competitivo atual: o que o mercado já oferece, o que deixou de ser diferencial ou morreu e quais gatilhos obrigam nova análise. Toda afirmação externa registra fonte e data; não pode ser preenchido por memória não verificada. |
| `docs/TESTING.md` | Estratégia, classificação, critérios, matriz e índice de evidência por SPEC/issue. Resume o resultado atual sem números escritos à mão. |
| `docs/REVIEW.md` | Política exclusiva da pipeline de revisão: o que sinalizar, severidade, evidência mínima, falsos positivos, formato do relatório e elegibilidade para autocorreção. |
| `docs/AGENT-POLICY.md` | Política humana de execução: orçamento de contexto, autoridade de decisão, bloqueios legítimos, resolução de skills e ciclo de vida Docker. Não redefine requisito do produto. |
| `skills-policy.json` | Contrato validável de capacidades, aliases aceitos, obrigatoriedade, fallback e restrições de uso por perfil de tarefa. |
| `skills.lock.json` | Resolução efetiva e reproduzível de skills, MCPs e ferramentas, com origem, versão ou hash e disponibilidade verificada. |
| `docs/DEVELOPMENT.md` | Progresso interno da fatia em execução: passos e evidências locais. Não duplica a coluna da issue nem o roadmap do `STATUS.md`. |
| `reports/TESTS.md` | Evidência detalhada gerada por máquina por SPEC/issue. É referenciada por `docs/TESTING.md` e nunca editada manualmente. |
| `docs/mvp/mvp-<nnn>-<slug>.md` | Tese, fatias previstas, dependências macro, fora de escopo e critérios de encerramento do MVP, criado após aprovação do MVP. |
| `docs/spec/spec-<mvp>-<fatia>-<slug>.md` | Contrato executável da fatia, criado após decomposição e antes da aprovação do PI. |
| `docs/adr/adr-<nnn>-<slug>.md` | Registro imutável de uma decisão estrutural, contexto, alternativas, consequências e estado. |

### 10.4 Regras antideriva documental

1. `STATUS.md` é a única fonte da numeração Fatia ↔ SPEC. GitHub confirma o estado externo da issue; nenhum outro documento mantém uma segunda numeração ou coluna.
2. `STATUS-ARQUIVO.md` é histórico complementar, nunca fonte do estado atual.
3. `DEVELOPMENT.md` responde onde a execução está dentro da fatia; `STATUS.md` responde qual fatia vem antes ou depois. O mesmo fato não mora nos dois.
4. `DECISIONS.md` é índice; o conteúdo integral de cada decisão vive em um ADR.
5. `TESTING.md` define e indexa evidência; `reports/TESTS.md` contém o resultado detalhado gerado pelos runners.
6. `LANDSCAPE.md` inclui `verificado_em`, fontes e gatilhos de revisão. Mudança relevante de concorrente, plataforma, preço, licença, integração ou capacidade gratuita marca o documento como desatualizado até nova pesquisa.
7. `REVIEW.md` é injetado nos agentes da pipeline de revisão como a política de projeto de maior prioridade, abaixo apenas de segurança da plataforma, instruções do ambiente e spec aprovada. Ele não pode ampliar escopo nem redefinir requisito do PI.
8. Todo merge de fatia atualiza no mesmo commit os documentos afetados e o índice de evidência. Documento sem mudança material não recebe edição cosmética.
9. O `ArtifactBundle` registra path e hash de cada documento estrutural. Alteração estrutural cria nova revisão e invalida somente aprovações dependentes.
10. `AGENT-POLICY.md` explica a política; `skills-policy.json` é sua parte executável. Divergência entre ambos falha na validação antes do run.
11. `skills.lock.json` registra o que foi realmente resolvido para o run. Nome de skill ausente não bloqueia quando existir fallback aprovado para a mesma capacidade.

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
- **ContextPolicy**: limites de entrada, saída, turnos, arquivos, bytes, expansão e exceções por fase e tentativa.
- **SkillResolution**: capacidade requerida, aliases, implementação escolhida, versão ou hash, fallback e resultado do preflight.
- **ResourceLease**: projeto, run, stack Docker, portas, volumes, expiração e estado de limpeza.

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

### 13.1 Autoridade de decisão e bloqueios

“Documento não bloqueia código” vale depois de a revisão da fatia estar aprovada. Antes disso, os três gates de entrada continuam obrigatórios; depois disso, documento auxiliar ou ADR faltante é criado ou atualizado no mesmo PR, sem novo aceite.

| Situação | Autoridade | Comportamento |
|---|---|---|
| Escolha técnica reversível dentro da spec | agente | decide, implementa, testa e registra no PR; ADR somente quando estrutural |
| Documento de apoio desatualizado após aprovação da fatia | agente | implementa e atualiza no mesmo PR |
| Comportamento de produto ausente, irreversível ou fora da spec | PI | retorna ao gate afetado com uma pergunta objetiva; não cria aceite adicional para a mesma revisão |
| Revisão aprovada inexistente, alterada ou com hash divergente | gate existente | não inicia ou suspende o run até aprovação da revisão correta |
| Autenticação, quota, segredo obrigatório, política negada ou path fora da allowlist | infraestrutura/política | bloqueia com causa e próxima ação verificável |
| Dependência ou CI obrigatório indisponível além do prazo configurado | infraestrutura externa | bloqueia sem inventar sucesso |
| Base/SHA obsoleto, conflito sem resolução segura ou risco de sobrescrever trabalho do usuário | Git/política | reconcilia; bloqueia se não houver ação segura dentro do escopo |
| Orçamento esgotado ou falha repetida sem hipótese nova | orçamento/recuperação | compacta quando possível; caso contrário bloqueia cedo |

A frase “se parou, o motivo está errado” não é uma regra operacional: ela esconderia bloqueios reais e estimularia a pipeline a fabricar conclusão. Todo bloqueio precisa de categoria fechada, evidência, responsável e ação de desbloqueio.

### 13.2 Docker e portas

- A pipeline pode iniciar automaticamente a stack declarada quando ela estiver desligada.
- Cada projeto/run usa nome de projeto Compose determinístico e um lease persistido no SQLite para portas, containers e volumes.
- Uma stack saudável do mesmo projeto pode ser reutilizada; recurso de outro projeto nunca é reutilizado implicitamente.
- Porta é alocada de um intervalo configurado, testada antes do uso e reservada transacionalmente. “Sempre criar porta nova” sem lease é proibido porque vaza recursos e ainda permite corrida.
- Recursos temporários são removidos no encerramento ou pelo reconciler. Volumes persistentes seguem a política explícita do projeto e nunca são apagados como limpeza automática.
- Docker indisponível vira `BLOCKED_INFRA` somente quando for dependência obrigatória da fatia.

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

### 15.1 Orçamento de contexto

Cada fase e tentativa recebe `ContextPolicy` com limites configuráveis de tokens de entrada, tokens de saída, turnos, arquivos, bytes e expansões. A entrada contabiliza instruções, skills, resultados de ferramentas e contexto de tentativas anteriores — não apenas arquivos do repositório.

Antes de chamar o provider, o adapter faz preflight do orçamento. Ao atingir o limiar de alerta configurado, reduz expansão, resume evidência preservando referências e sinaliza o ledger. Se a tarefa não puder continuar com fidelidade dentro do teto, termina em `BLOCKED_BUDGET`; exceder silenciosamente não é permitido.

`wholeRepoAllowed` é `false` por padrão. Leitura integral exige exceção explícita da política, motivo, estimativa e registro no ledger. Limites iniciais pertencem ao template do projeto e podem ser ajustados pelo PI sem alterar a regra global.

### 15.2 Aquisição progressiva de contexto

O contexto é montado nesta ordem:

1. spec aprovada, política aplicável e snapshot da tentativa;
2. diff, arquivos alterados, testes e erros diretamente relacionados;
3. busca por `rg`, manifestos e dependências imediatas;
4. consulta a índice estrutural opcional;
5. expansão para arquivos adicionais somente com relação demonstrável e motivo registrado.

Resultados são cacheados por hash do arquivo e base SHA. Recuperação recebe apenas o delta desde a tentativa anterior e assinaturas de falhas já conhecidas. Relatório anterior completo não é reapresentado quando o conteúdo relevante não mudou.

### 15.3 Índice estrutural opcional com Graphify

Graphify é um acelerador opcional, não fonte de verdade nem dependência universal. A configuração inicial é `strict=false` e análise de código local, sem passagem semântica por modelo. Ele é ativado quando o tamanho ou a transversalidade da tarefa ultrapassar o limiar configurado e deve consultar o grafo antes de expandir arquivos.

O índice registra o base SHA, é reconstruído ou invalidado quando ficar obsoleto e permanece fora do contexto automático e do cache de prompt. Falha ou ausência do Graphify usa `rg` e manifestos como fallback. Torná-lo padrão exige experimento A/B que preserve qualidade e reduza tokens totais observados pelo provider.

### 15.4 Compressão experimental

Caveman ou skill equivalente fica desativada por padrão. Pode ser testada somente em saídas naturalmente curtas — status, mensagem de commit e resumo de revisão — com telemetria própria desativada, origem aprovada e versão/hash fixados.

O gate A/B mede tokens totais faturáveis ou reportados pelo provider, qualidade, número de correções, tempo e falhas; contar linhas removidas de um arquivo não prova economia de tokens. A compressão é rejeitada se aumentar entrada, ocultar evidência ou piorar a taxa de primeira passagem. Arquitetura, invariantes, segurança técnica e regras críticas nunca dependem de linguagem comprimida para manter significado.

### 15.5 Orquestração de skills e ferramentas

A política resolve **capacidade**, não um nome literal. Cada entrada de `skills-policy.json` contém capacidade, aliases aceitos, perfil de tarefa, `required` ou `optional`, fallback executável e restrições. O preflight gera `skills.lock.json` e o run registra o que foi realmente usado.

Ausência de uma skill não autoriza pular a disciplina nem bloqueia por nome: usa-se o fallback aprovado. Skill externa só pode vir de catálogo/origem aprovada, com versão ou hash fixado; instalação arbitrária durante o run é proibida.

Perfis mínimos:

- toda mudança de código: testes proporcionais e uma revisão independente;
- UI: design de frontend, crítica visual, smoke ao vivo e evidência visual;
- comportamento crítico: TDD e revisão aprofundada de invariantes e segurança técnica;
- mobile: disciplina Expo quando a stack exigir;
- biblioteca, SDK, API, CLI ou cloud: documentação atual via Context7, com fallback documentado se o MCP não estiver exposto;
- documentação: schema, links, hashes e antideriva; não aciona suíte visual sem interface;
- finalização: testes completos aplicáveis, CI, PR, merge e limpeza de worktree.

Skills sobrepostas não são empilhadas por ritual. O perfil escolhe o conjunto mínimo que cubra as capacidades e evita múltiplas revisões equivalentes consumindo o mesmo contexto.

### 15.6 Limite dos requisitos da pipeline

A pipeline não cria, presume ou impõe requisito legal, regulatório, jurídico, de consentimento ou classificação de domínio que não conste dos artefatos fornecidos e aprovados pelo PI. Se o PI não passou o requisito, ele não existe para a execução. Isso não reduz os guardrails técnicos da plataforma — segredos, allowlist, isolamento de processo, hashes e verificação de SHA — e não cria gate ou aceite adicional.

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

### 16.8 Contexto e custo

- preflight soma instruções, skills, ferramentas e arquivos;
- ordem progressiva de aquisição e cache por hash/SHA;
- tentativa de leitura integral negada sem exceção registrada;
- compactação no limiar e `BLOCKED_BUDGET` no teto;
- recuperação não reinjeta relatório antigo sem delta;
- Graphify obsoleto é invalidado e seu fallback funciona;
- experimento de compressão mede total do provider e rejeita regressão de qualidade.

### 16.9 Skills e recursos locais

- aliases resolvem a mesma capacidade e geram lock reproduzível;
- skill ausente executa o fallback aprovado;
- skill externa sem origem ou versão/hash é recusada;
- perfis não acionam revisões redundantes;
- leases de Docker impedem colisão entre projetos;
- stack saudável do mesmo projeto é reutilizada e recursos temporários são limpos após falha e sucesso.

### 16.10 Aprovação e limite de requisitos

- a mesma revisão não solicita aprovação duas vezes;
- mudança estrutural reabre somente o gate dependente;
- merge técnico não cria aceite final do PI;
- requisito não fornecido pelo PI não é inventado pelo planejamento, implementação ou revisão;
- guardrail técnico não é convertido em regra de produto.

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
15. A árvore documental da seção 10.3 é gerada, os papéis não se sobrepõem e os testes antideriva confirmam numeração, links, hashes e evidências.
16. Nenhum run lê o repositório inteiro sem exceção explícita registrada.
17. Cada fase e tentativa respeita o orçamento de contexto ou termina em `BLOCKED_BUDGET` com evidência.
18. Ausência de skill nominal usa o fallback da capacidade; não elimina a disciplina nem bloqueia sem necessidade.
19. Graphify, quando usado, referencia o base SHA e falha com fallback funcional.
20. Compressão só vira padrão após A/B com redução de tokens totais e qualidade não inferior.
21. Docker não colide com outro projeto e não deixa recurso temporário órfão após reconciliação.
22. A mesma revisão recebe um único aceite em cada gate aplicável, e nenhum requisito externo ao pacote aprovado é criado pela pipeline.

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
- Graphify: análise estrutural local e consulta por grafo podem reduzir leitura bruta; o índice é derivado e precisa ser preso ao SHA. `https://github.com/Graphify-Labs/graphify`
- Caveman: compressão de saída pode adicionar contexto de entrada; economia líquida deve ser medida no provider. `https://github.com/JuliusBrussee/caveman` e `https://github.com/JuliusBrussee/caveman/blob/main/docs/HONEST-NUMBERS.md`
- Estudo “84%”: o número publicado compara linhas de contexto carregado, não custo faturado ponta a ponta; a pipeline aproveita deduplicação e carregamento sob demanda, mas exige sua própria medição. `https://www.tabnews.com.br/andersonlimadev/como-criei-uma-skill-que-economiza-84-por-cento-dos-tokens-no-claude-code`

## 20. Questões encerradas

Não há questão de produto aberta para este design. Escolhas de implementação — schemas exatos, contratos IPC, migrations, nomes de eventos, templates e divisão em fatias — pertencem ao plano de implementação e não podem alterar as decisões desta especificação sem nova aprovação do PI.

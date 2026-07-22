# Fronteiras: Desenvolvimento, NOA e JARVIS OS

## Objetivo

Separar claramente o que pertence à plataforma de desenvolvimento, ao espaço pessoal `NOA` e ao espaço profissional `JARVIS OS`. Essa separação evita que decisões técnicas virem features de produto e impede que demandas pessoais/profissionais contaminem o runtime comum.

## Regra Principal

- `Desenvolvimento`: constrói a plataforma, o runtime, a segurança, o banco, o Electron app e as integrações base.
- `NOA`: usa a plataforma para vida pessoal.
- `JARVIS OS`: usa a plataforma para operações profissionais, agentes, squads e automações de negócio.

Nenhum domínio deve depender de telas, dados ou políticas exclusivas do outro.

## Camada 1: Desenvolvimento

### Responsabilidade

Desenvolvimento é a base técnica compartilhada. Ele não é um espaço de usuário final.

Inclui:

- Electron app.
- React UI shell.
- Runtime local.
- IPC seguro.
- Supabase local via Docker.
- Migrações, RLS e seeds.
- Auth multiusuário.
- Policy Engine.
- AuditEvent.
- BudgetPolicy.
- Terminal Executor.
- File Explorer controlado.
- System Monitor.
- Provider adapters.
- Connector registry.
- Voice layer online.
- Build, lint, testes e empacotamento.
- Documentação técnica.

Não inclui:

- Rotina pessoal do usuário.
- Projetos de negócio.
- Conteúdo SEO real.
- Agenda pessoal real.
- Metas financeiras pessoais reais.
- Squads de negócio reais.

### Backlog de Desenvolvimento

Tipos de tarefa:

- Bootstrap técnico.
- Arquitetura.
- Segurança.
- Persistência.
- Testes.
- Performance.
- Observabilidade.
- Integrações base.
- DevOps local.
- Empacotamento.

Exemplos:

- Criar app Electron + React + TypeScript.
- Configurar Supabase Docker.
- Criar schema `workspaces`, `users`, `audit_events`.
- Implementar Policy Engine.
- Implementar allowlist de diretórios.
- Implementar contrato de `ProviderAdapter`.

## Camada 2: NOA

### Responsabilidade

NOA é o espaço pessoal. Ele deve cuidar da vida privada do operador sem misturar dados com o JARVIS OS.

Inclui:

- Agenda pessoal.
- Conteúdo pessoal.
- Finanças pessoais.
- Saúde, hábitos e rotina.
- Memória pessoal.
- Automações pessoais.
- Alertas pessoais.
- Resumo diário pessoal.

Não inclui:

- Harness de desenvolvimento.
- Squads profissionais.
- SEO pipeline profissional.
- Deploy de produção.
- Auditoria operacional de negócio.
- Catálogo profissional de agentes.

### Módulos NOA

- `Agenda`: compromissos, lembretes, eventos e sincronização com Google Workspace pessoal quando autorizado.
- `Conteúdo`: ideias, notas, drafts pessoais e organização de conhecimento.
- `Finanças`: orçamento pessoal, alertas, contas e metas financeiras.
- `Saúde`: hábitos, sono, treino, alimentação, medicamentos e sinais manuais.
- `Memória`: contexto pessoal privado, preferências e histórico.
- `Automações`: rotinas pessoais e resumos.

### Restrições NOA

- Dados pessoais são privados por padrão.
- Compartilhamento com JARVIS OS é bloqueado no MVP.
- Acesso a saúde, finanças e documentos pessoais é sempre alto risco.
- Qualquer envio externo em nome do usuário exige aprovação.

## Camada 3: JARVIS OS

### Responsabilidade

JARVIS OS é o espaço profissional e operacional. Ele coordena agentes, squads, skills, workflows e operações de negócio.

`Agentic OS` é uma área interna deste espaço. Ele reúne a operação de agentes e conhecimento profissional, mas não cria um quarto workspace e não representa a camada técnica de Desenvolvimento.

Inclui:

- Agentic OS.
- Agents.
- Squads.
- Catálogo de skills.
- Projetos.
- Metas profissionais.
- Studio.
- SEO Content Pipeline.
- Video Director.
- Email Outreach.
- Mission Control.
- Kanban operacional.
- Workflows.
- Automations.
- Backend Services.
- Connectors profissionais.
- Providers.
- Security.
- Notifications.
- Analytics.
- Insights.

Não inclui:

- Dados de saúde pessoal.
- Finanças pessoais.
- Agenda pessoal privada.
- Memória pessoal não autorizada.

### Módulos JARVIS OS

- `Agentic OS`: área interna que agrupa Core, Harnesses, Teams, Governance e Knowledge.
- `Mission Control`: estado de agentes, execuções, custo, sucesso e terminal/logs controlados.
- `Specialties`: organização de agentes, squads e skills por especialidade profissional.
- `Kanban`: tarefas multiagente e decomposição de prompts.
- `Workflows`: fluxos sequenciais/paralelos com aprovação humana.
- `Automations`: squads, skills, crons, integrações e self-improve.
- `Agents`: agentes individuais e harnesses.
- `Squads`: equipes especializadas.
- `Skills Catalog`: skills profissionais e de sistema.
- `Agent Memory`: memória profissional com fontes rastreáveis, busca textual/vetorial, grafo de conceitos e recuperação RAG.
- `Notebook`: notas profissionais versionadas e opcionalmente indexadas para uso por agentes.
- `SEO Content`: pesquisa, geração, revisão e deploy de conteúdo.
- `Connectors`: Google Gemini, Google Workspace, OpenAI, Claude, ElevenLabs e demais integrações.
- `Providers`: roteamento de modelos e custos.
- `Services`: serviços internos do runtime.
- `Analytics`: performance e custos.

### Restrições JARVIS OS

- Deploy, publicação, envio de mensagem e alteração de banco remoto sempre exigem aprovação.
- Operações profissionais não podem acessar memória pessoal sem compartilhamento explícito.
- O Agentic OS usa o `workspace_id` do JARVIS OS; não possui identidade, credenciais, orçamento ou memória de workspace próprios.
- Relações inferidas no grafo de memória devem ser distinguíveis de relações confirmadas.
- Toda recuperação de memória usada por agente deve preservar a rastreabilidade até as fontes.
- Squads não podem executar terminal real sem política aprovada.
- Custos devem respeitar limites diários e mensais.

## Camada Compartilhada

Alguns recursos existem na plataforma e são consumidos por NOA e JARVIS OS com escopo separado:

- Autenticação.
- Workspaces.
- Permissões.
- Auditoria.
- BudgetPolicy.
- Conectores.
- Providers.
- Memória.
- Notificações.
- Voice layer.
- Settings.

Regra:

- O recurso é compartilhado como capacidade técnica.
- Os dados e políticas são separados por `workspace_id`, `user_id` e, quando houver, `organization_id`.

## Separação Visual

### Desenvolvimento

Não deve aparecer como espaço principal de usuário final no MVP. Deve existir como modo/admin técnico, documentação e eventualmente painel interno.

### NOA

Deve usar linguagem pessoal, calma e privada:

- Agenda.
- Rotina.
- Saúde.
- Finanças.
- Conteúdo.
- Memória.

### JARVIS OS

Deve usar linguagem operacional:

- Agentic OS.
- Mission Control.
- Agents.
- Squads.
- Skills.
- Workflows.
- Automations.
- Services.
- Deploy.
- Analytics.

Ao abrir o Agentic OS, a navegação interna deve usar os grupos:

- `Core`: Mission Control, Specialties e Skills Catalog.
- `Harnesses`: agentes executores disponíveis.
- `Teams`: Specialist Teams.
- `Governance`: Operator Central.
- `Knowledge`: Agent Memory e Notebook.

## Separação de Dados

Entidades devem carregar campos mínimos:

- `workspace_id`: identifica NOA ou JARVIS OS.
- `owner_user_id`: dono direto quando aplicável.
- `organization_id`: organização profissional quando aplicável.
- `visibility`: private, shared, organization ou system.
- `sensitivity`: public, internal, personal, financial, health, credential ou secret.

Regras:

- NOA usa `visibility=private` por padrão.
- JARVIS OS pode usar `organization`, mas nunca acessa `personal`, `financial` ou `health` sem aprovação explícita.
- Dados do Agentic OS usam o mesmo `workspace_id` do JARVIS OS e podem ser segmentados por projeto, agente, squad e sensibilidade.
- Índices textual, vetorial e de grafo devem aplicar as mesmas regras de RLS e autorização da fonte original.
- Excluir ou revogar uma fonte deve removê-la de todos os índices e impedir sua recuperação por RAG.
- Desenvolvimento usa dados fake/seeds e nunca dados reais como fixture.

## Separação de Backlog

### Backlog Desenvolvimento

Exemplo de épicos:

- Bootstrap Electron.
- Runtime local.
- Supabase local.
- Policy Engine.
- Terminal controlado.
- Provider adapters.
- Testes e build.

### Backlog NOA

Exemplo de épicos:

- Agenda pessoal.
- Finanças pessoais.
- Saúde e hábitos.
- Conteúdo pessoal.
- Memória pessoal.
- Rotinas e resumos.

### Backlog JARVIS OS

Exemplo de épicos:

- Agentic OS.
- Mission Control.
- Specialties.
- Kanban multiagente.
- Workflows.
- Automations.
- Agents e squads.
- Skills Catalog.
- Agent Memory, grafo de conhecimento e RAG.
- Notebook profissional.
- SEO Content Pipeline.
- Connectors profissionais.

## Ordem Recomendada

1. Desenvolvimento: shell, domínio, segurança, auditoria e dados mockados.
2. JARVIS OS: Agentic OS, Mission Control, Agent Memory, Notebook, Kanban, Workflows e Connectors mockados.
3. NOA: shell pessoal, Agenda, Finanças e Memória com dados mockados.
4. Desenvolvimento: Supabase local, RLS e Policy Engine.
5. JARVIS OS: execução controlada e providers reais.
6. NOA: integrações pessoais reais, apenas depois de privacidade/RLS testadas.

## Critérios de Aceite da Separação

- Existe documentação separando `Desenvolvimento`, `NOA` e `JARVIS OS`.
- A spec não trata desenvolvimento como domínio de usuário.
- O plano técnico identifica quais fases são plataforma, NOA ou JARVIS OS.
- Toda entidade persistida tem escopo de workspace/usuário.
- Backlog de desenvolvimento não contém tarefas pessoais/profissionais reais.
- Backlog NOA não contém tarefas de arquitetura.
- Backlog JARVIS OS não acessa dados pessoais por padrão.
- Agentic OS está documentado e implementável como área interna do JARVIS OS, nunca como workspace independente.

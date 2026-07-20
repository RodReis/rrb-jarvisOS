# Requisitos: Agent OS JARVIS OS / NOA

## Decisões Confirmadas

1. O produto alvo será um `desktop app` em Electron.
2. O sistema será `multiusuário`.
3. O MVP deve nascer com os dois espaços: `NOA` e `JARVIS OS`, usando um shell comum.
4. Conectores obrigatórios do primeiro release real: Google Gemini, Google Workspace, OpenAI, ElevenLabs e Claude.
5. O cofre de memória será híbrido: local para operação/offline e Supabase para sincronização/auditoria.
6. O banco principal de metadados e auditoria será Supabase, rodando local via Docker durante o desenvolvimento.
7. O sistema executará comandos reais no terminal, mas isso exige governança, allowlist e auditoria desde o MVP.
8. O orçamento de agentes será configurável por dia e por mês, com limites separados e padrão inicial de USD 1 para cada limite.
9. Voz será online no desenvolvimento/MVP; voz offline fica como evolução planejada.
10. Ações sensíveis devem ser listadas, classificadas por risco e passar por aprovação humana conforme política.
11. Diretórios permitidos para Terminal e File Explorer serão configuráveis pelo administrador.
12. Claude deve ser suportado via API e via Claude Code CLI.
13. O desenvolvimento inicial será em Windows, com arquitetura preparada para macOS e Linux no futuro.
14. `Desenvolvimento`, `NOA` e `JARVIS OS` devem ser tratados como fronteiras separadas: desenvolvimento é plataforma, NOA é domínio pessoal e JARVIS OS é domínio profissional/operacional.
15. `Agentic OS` será uma área interna do `JARVIS OS`, não um workspace, produto ou camada de desenvolvimento adicional.

## Premissas Mantidas

1. A interface de voz será uma camada de comando sobre o Agent OS, não um produto separado.
2. Integrações externas, modelos de IA e skills devem ser tratadas como conectores configuráveis.
3. As referências citadas pelo usuário são candidatas de pesquisa, não decisões técnicas confirmadas.
4. Electron deve entregar experiência local, tray/background services e controle de permissões, sem tratar o app como simples página web empacotada.
5. A separação detalhada entre plataforma, NOA e JARVIS OS fica documentada em `docs/fronteiras-desenvolvimento-noa-jarvisos.md`.
6. O nome `Agentic OS` identifica a experiência operacional de agentes dentro do JARVIS OS; o runtime, a memória e os mecanismos de segurança continuam sendo capacidades da plataforma compartilhada.

## Objetivo

Construir um Agent OS para centralizar agentes de IA, skills, automações, memória e monitoramento operacional em uma interface única. O sistema deve reduzir a fragmentação entre ferramentas pessoais e profissionais, permitindo coordenar agentes, acompanhar execução de tarefas, auditar custos e preservar contexto de trabalho.

## Personas

- `Operador`: usuário principal que aciona comandos por texto ou voz, acompanha tarefas e aprova ações sensíveis.
- `Agente`: unidade executora especializada, com modelo, ferramentas, permissões, memória e histórico.
- `Squad`: grupo de agentes organizado para executar fluxos complexos.
- `Administrador`: configura provedores, credenciais, segurança, custos e políticas de execução.

## Espaços Operacionais

O produto deve separar três camadas:

- `Desenvolvimento`: plataforma técnica compartilhada, sem ser espaço de usuário final.
- `NOA`: espaço pessoal.
- `JARVIS OS`: espaço profissional/operacional.

Detalhamento: `docs/fronteiras-desenvolvimento-noa-jarvisos.md`.

### NOA, pessoal

Áreas mínimas:

- Agenda e compromissos.
- Conteúdo pessoal e anotações.
- Finanças pessoais.
- Saúde, hábitos e rotina.
- Memória pessoal.
- Automações pessoais.

### JARVIS OS, profissional

Áreas mínimas:

- Agentic OS.
- Agents.
- Esquadrões especializados.
- Catálogo de skills.
- Projetos.
- Metas.
- Studio.
- SEO Content.
- Video Director.
- Email Outreach.
- Serviços.
- Conectores.
- Providers.
- Segurança.
- Notificações.
- Analytics.
- Insights.

#### Agentic OS dentro do JARVIS OS

O `Agentic OS` organiza a operação profissional de agentes em cinco grupos:

- `Core`: Mission Control, Specialties e Skills Catalog.
- `Harnesses`: Antigravity, Claude Code, OpenCode, Kiro Dev, NeoCode, Hermes e futuros executores.
- `Teams`: Specialist Teams.
- `Governance`: Operator Central.
- `Knowledge`: Agent Memory e Notebook.

Ele deve usar o `workspace_id` do JARVIS OS e não pode ser selecionado, persistido ou autorizado como um workspace independente.

## Requisitos Funcionais

### RF-001: Alternância entre espaços

O sistema deve permitir alternar entre `NOA` e `JARVIS OS` sem misturar memória, credenciais, tarefas, custos ou automações.

Critérios de aceite:

- Cada espaço possui navegação, dados e políticas próprias.
- O usuário consegue identificar visualmente o espaço ativo.
- Uma tarefa criada em um espaço não aparece no outro, salvo se for explicitamente compartilhada.
- `Desenvolvimento` não aparece como workspace comum; ele é tratado como plataforma/admin técnico.

### RF-002: Command Center

O sistema deve oferecer um Command Center para comandos por texto e voz.

Critérios de aceite:

- Exibe estado do sistema.
- Permite executar ações rápidas como `System Status`, `Deploy`, `Scan Network` e `Run Agents`.
- Possui botão ou gatilho de voz com estado claro: escutando, processando, respondendo e erro.
- Deve registrar cada comando no histórico operacional.

### RF-003: Persona JARVIS OS por voz

O sistema deve ter uma camada de voz para interpretar comandos, selecionar skills e retornar respostas.

Critérios de aceite:

- Suporta entrada por microfone.
- Suporta saída por voz.
- Permite trocar provedor de TTS/STT.
- ElevenLabs pode ser considerado como provedor TTS, mas deve entrar como conector, não como dependência fixa.
- No MVP, voz usa provedores online configurados.
- Voz offline deve ser desenhada como evolução sem bloquear o desenvolvimento inicial.
- Ações sensíveis exigem confirmação antes da execução.

### RF-004: Navegação principal

A interface deve ter navegação lateral com agrupamento por domínio.

Itens extraídos das imagens:

- Command: `Command Center`, `HUD`.
- Operations: `Kanban`, `Workflows`, `Automations`, `OS Desktop`.
- Intel: `Analytics`, `Insights`.
- Business: `Projects Hub`, `Goals`, `Studio`, `SEO Content`, `Video Director`, `Email Outreach`.
- System: `Services`, `Connectors`, `Providers`, `Security`, `Notifications`.
- Agentic OS, interno ao JARVIS OS:
  - Core: `Mission Control`, `Specialties`, `Skills Catalog`.
  - Harnesses: executores disponíveis e seu estado.
  - Teams: `Specialist Teams`.
  - Governance: `Operator Central`.
  - Knowledge: `Agent Memory`, `Notebook`.

Critérios de aceite:

- A navegação mostra o item ativo.
- O menu suporta rolagem quando a lista excede a altura da tela.
- Os módulos podem ser habilitados ou ocultados por espaço.
- O Agentic OS aparece somente quando o workspace ativo é JARVIS OS.
- Entrar no Agentic OS não altera o workspace ativo nem cria um quarto contexto de dados.

### RF-005: Kanban operacional

O sistema deve permitir acompanhar tarefas de agentes em quadro Kanban.

Critérios de aceite:

- Estados visíveis mínimos: `Triage`, `To Do`, `Ready`, `Running`.
- Estados internos mínimos: backlog, planejado, em execução, aguardando aprovação, concluído, falhou, cancelado.
- O usuário pode soltar um prompt em `Triage` para o orquestrador decompor, classificar e atribuir tarefas.
- Cada card indica agente/squad responsável, prioridade, custo estimado e última atualização.
- Cada card pode indicar harness responsável, por exemplo `neocode`, `claude-code` ou `hermes`.
- Tarefas podem ser abertas para ver logs, artefatos e decisões.
- O quadro deve suportar input rápido de novo card por título/prompt.

### RF-006: Workflows

O sistema deve permitir criar e executar workflows multiagente.

Critérios de aceite:

- Workflow contém etapas, agente responsável, skill usada, entradas, saídas e critérios de sucesso.
- Suporta execução sequencial e paralela.
- Suporta pausa para aprovação humana.
- Cada execução gera rastreio auditável.
- Cada workflow exibe status `online`, `offline`, `paused`, `failed` ou `disabled`.
- Cada workflow exibe agenda, última execução e próxima execução quando aplicável.
- Deve existir um `Trigger Registry` para registrar crons, eventos e webhooks.
- Workflows longos podem solicitar `Power Guard` para impedir suspensão do sistema enquanto estiverem em execução.

Workflows iniciais extraídos das imagens:

- `Daily Summary`: resumo diário com finanças, energia e eventos, entregue via web.
- `Power Guard`: previne sleep durante workflows longos com `power_mode: prevent_sleep`.
- `Finance Alert`: monitora despesas e dispara alerta quando consumo ultrapassar 80% do orçamento.
- `Google Workspace Sync`: sincroniza eventos do Calendar e conteúdo do Drive.

### RF-007: Automations

O sistema deve ter módulo de automações com abas:

- `Squads`.
- `Skills`.
- `Crons`.
- `Integrations`.
- `Self-Improve`.

Critérios de aceite:

- Permite criar automações baseadas em agenda, evento, webhook ou comando manual.
- Permite associar automação a um squad ou skill.
- Exibe estado de execução e próxima execução.
- Registra falhas e retentativas.

### RF-008: Skill Creator

O sistema deve permitir criar e gerenciar skills personalizadas.

Critérios de aceite:

- Skill possui nome, descrição, categoria, espaço, permissões, parâmetros, comandos e exemplos.
- Deve ser possível versionar skills.
- Deve haver validação antes de publicar uma skill.
- Deve haver opção de importar skills de catálogos externos, após revisão de segurança.

### RF-009: Catálogo de Skills

O sistema deve manter catálogo de skills por área.

Áreas iniciais:

- Pessoal: agenda, conteúdo, finanças, saúde, memória.
- Profissional: agentes, squads, projetos, código, marketing, vendas, operações.
- Sistema: arquivos, terminal, navegador, conectores, provedores, segurança.

Critérios de aceite:

- Skills são filtráveis por área, provedor, status, risco e custo.
- Cada área deve permitir destacar um conjunto inicial de `top skills`.
- Fontes como `skills.sh`, `vercel-labs/skills` e `vercel-labs/agent-skills` devem passar por curadoria antes de importação.

### RF-009.1: Specialties

O Agentic OS deve permitir organizar agentes, equipes e skills por especialidade profissional.

Critérios de aceite:

- Especialidade possui nome, descrição, domínio, responsáveis e conjunto recomendado de skills.
- Agentes e squads podem possuir uma ou mais especialidades.
- A tela mostra cobertura de skills, executores disponíveis e lacunas por especialidade.
- Especialidades pertencem ao workspace JARVIS OS e não classificam dados pessoais do NOA.

### RF-010: Connectors & Credentials

O sistema deve ter painel de conectores e credenciais.

Itens extraídos das imagens:

- Google AI Gemini.
- Google Workspace.
- OpenAI.
- Groq.
- Ollama local.
- Tavily Search.
- Telegram Bot.
- Discord Bot.
- Slack.
- Obsidian MCP.
- GitHub.
- Patreon.
- ElevenLabs.
- Claude Code CLI.
- NeoCode CLI.
- Meta Business.
- YouTube.
- WhatsApp.
- Spotify.
- Supabase.

Critérios de aceite:

- Cada conector exibe status: `connected`, `partial` ou `missing`.
- Cada conector indica contexto: pessoal, profissional ou ambos.
- Google Gemini, Google Workspace, OpenAI, ElevenLabs e Claude são conectores obrigatórios do primeiro release real.
- Claude deve suportar dois modos: Claude API e Claude Code CLI.
- Credenciais ficam fora da UI e devem ser lidas de ambiente, vault ou provedor seguro.
- A UI deve informar quais variáveis estão ausentes sem exibir segredos.
- OAuth não deve ser improvisado no MVP se não houver fluxo seguro.

### RF-011: Providers de IA

O sistema deve abstrair provedores de modelo.

Provedores citados:

- Claude.
- OpenAI.
- Kimi.
- Ollama.
- OpenRouter.
- Gemini.
- Groq.
- NVIDIA NIM.

Critérios de aceite:

- Cada agente pode declarar provedor preferencial e fallback.
- O sistema registra custo, latência, tokens e taxa de erro por provedor.
- Modelos locais devem ser suportados via Ollama ou adaptador equivalente.
- A tela de providers deve mostrar status online/loading/offline, modelo ativo, latência, origem local/cloud e botão para troca de modelo.
- Deve existir lógica de roteamento por tarefa, com preferência por local/offline quando viável.

Roteamento inicial sugerido:

- Reasoning e Planning: Ollama local como primeira opção, Groq como fallback cloud.
- Coding e Debug: Ollama com modelo coder como primeira opção, Claude/OpenAI como fallback.
- Voz no MVP: STT/TTS online via provedores configurados; offline entra como evolução.
- Multimodal e Visão: modelo local quando disponível; Google/Gemini ou OpenAI como fallback.

### RF-012: Mission Control

O sistema deve ter painel central de controle operacional.

Itens extraídos das imagens:

- Métricas de harnesses.
- Execuções.
- Taxa de sucesso.
- Skills disponíveis.
- Abas: `Builds`, `Active`, `Costs`, `Terminal`.

Critérios de aceite:

- Mostra agentes/harnesses disponíveis e indisponíveis.
- Exibe execuções ativas e concluídas.
- Exibe custo acumulado por período.
- Permite abrir terminal/log controlado por permissão.

### RF-013: Harnesses e agentes executores

O sistema deve suportar harnesses para ferramentas/agentes externos.

Itens extraídos das imagens:

- Antigravity.
- Claude Code.
- OpenCode.
- Kiro Dev.
- NeoCode.
- Hermes.

Critérios de aceite:

- Harness possui status, descrição, comando externo, permissões e métricas.
- Cada execução registra comando, diretório, saída, erro, duração e custo estimado.
- Harnesses perigosos exigem aprovação explícita para arquivos, terminal e rede.

### RF-014: Specialist Teams

O sistema deve permitir criar equipes especializadas.

Critérios de aceite:

- Equipe contém agentes, papéis, objetivo, workflow padrão e limites de custo.
- Pode ser acionada manualmente ou por automação.
- Deve existir visão de performance por equipe.

### RF-015: Agent Memory

O sistema deve ter um cofre de memória profissional dentro do Agentic OS para preservar, relacionar e recuperar contexto utilizado por agentes e equipes.

Critérios de aceite:

- Memória separada por espaço, projeto, agente e sensibilidade.
- Suporta busca semântica e busca textual.
- Suporta ingestão de notas manuais, artefatos de execução, arquivos permitidos e páginas provenientes do Obsidian MCP.
- Cada conteúdo ingerido preserva fonte, autor, timestamps, workspace, projeto, sensibilidade e versão.
- O pipeline de memória separa documento, entrada, trecho, conceito e relação sem perder a rastreabilidade até a fonte.
- A visualização `Rede` apresenta conceitos e relações como grafo navegável, com filtros por categoria, fonte, projeto, agente e período.
- A interface oferece as visões `Rede`, `Recentes`, `Notas` e `Busca`, além de contadores de memórias, entradas e categorias.
- Agentes recuperam contexto por RAG combinando busca textual, vetorial e relações do grafo.
- Toda resposta que usar memória deve registrar quais fontes e trechos foram recuperados.
- Correlações sugeridas por IA ficam distinguíveis de relações confirmadas pelo usuário ou por fonte explícita.
- Permite expiração, arquivamento e exclusão.
- Memória sensível exige classificação e política de retenção.
- Exclusão ou expiração remove o item dos índices textual, vetorial e de grafo.
- A memória do Agentic OS usa exclusivamente o workspace JARVIS OS e não consulta a memória pessoal do NOA sem compartilhamento explícito e aprovação.

### RF-015.1: Notebook

O Agentic OS deve oferecer um Notebook profissional integrado ao cofre de memória.

Critérios de aceite:

- Permite criar, editar, categorizar, vincular e arquivar notas.
- Uma nota pode ser vinculada a projeto, agente, squad, skill, execução ou memória.
- O usuário decide se a nota será apenas registrada ou também indexada para recuperação por agentes.
- Alterações mantêm histórico de versão e autoria.
- Notas indexadas aparecem em `Recentes`, `Busca` e, quando houver conceitos relacionados, na `Rede`.

### RF-016: Operator Central

O sistema deve ter área de governança para aprovações humanas.

Critérios de aceite:

- Lista ações pendentes de aprovação.
- Mostra risco, agente solicitante, impacto esperado e comando planejado.
- Permite aprovar, rejeitar ou solicitar alteração.
- Mantém trilha de auditoria.

### RF-017: OS Desktop

O sistema deve oferecer uma área de desktop operacional.

Critérios de aceite:

- Deve concentrar atalhos, janelas ou painéis para tarefas em andamento.
- Deve permitir abrir artefatos produzidos por agentes.
- Deve ter `File Explorer`, `Terminal` e `System Monitor`.
- O `System Monitor` deve exibir CPU, RAM, GPU, disco e rede.
- O terminal executará comandos reais, com logs, permissões, working directory, allowlist e bloqueio de comandos perigosos.
- Diretórios acessíveis pelo terminal e explorador de arquivos devem ser configuráveis pelo administrador.
- Erros de execução devem aparecer no terminal e gerar evento de auditoria.
- O desktop deve suportar janelas movíveis/redimensionáveis ou painéis equivalentes.

### RF-018: Analytics e custos

O sistema deve auditar desempenho e custo operacional.

Critérios de aceite:

- Métricas mínimas: execuções, sucesso, falhas, custo, tokens, duração, latência e provedor.
- Filtros por espaço, agente, squad, workflow, skill e período.
- Alertas quando custo ou falhas excederem limites configurados.

### RF-019: Segurança e permissões

O sistema deve ter modelo de permissões antes de habilitar execução autônoma.

Critérios de aceite:

- Permissões por agente, skill, conector e espaço.
- Ações sensíveis exigem confirmação.
- Segredos não aparecem em logs nem na UI.
- Todas as execuções com terminal, filesystem, rede externa ou envio de mensagem devem ser auditadas.

### RF-020: Autonomous Remote

O sistema pode ter modo remoto/autônomo, mas com limites.

Critérios de aceite:

- O modo autônomo deve indicar claramente quando está ativo.
- Deve haver pausa global de automações.
- Deve haver limites de custo, horário, escopo e permissões.
- Deve haver kill switch operacional.

### RF-021: Backend Services

O sistema deve ter painel de serviços internos.

Itens extraídos das imagens:

- `Channel Gateway`: roteamento multi-canal e sessões.
- `Multi-Agent System`: registry, orquestrador e harness agents.
- `Memory Manager`: memória file-first e SQLite/vector.
- `Local Nodes`: filesystem, computer, body scan e gesture.
- `Integrations Registry`: Google, Meta, RapidAPI, Claude Code e outros conectores.
- `Trigger / Cron Scheduler`: crons e gatilhos agendados.
- `MCP Manager`: conectores MCP, incluindo Obsidian e Windows.
- `Control Mode`: passivo, autônomo e remote gates.

Critérios de aceite:

- Cada serviço exibe status, criticidade, descrição, última inicialização e healthcheck.
- Serviços críticos devem bloquear automações dependentes quando estiverem offline.
- O app deve suportar auto-start dos serviços locais no boot, com opção de desativar.
- Falha em serviço crítico deve gerar notificação e evento de auditoria.

### RF-022: SEO Content Pipeline

O sistema deve ter pipeline profissional de SEO Content.

Itens extraídos das imagens:

- Métricas: sites GSC conectados, cliques em 28 dias, transcrições e deploys.
- Abas: `Research`, `OpenSEO`, `Generate`, `Deploy`, `History`, `Transcripts`, `Skill`.
- Integração com Google Search Console.
- Pesquisa por site, período e seed keyword.

Critérios de aceite:

- O usuário informa domínio, período e palavra-chave inicial.
- O sistema executa pesquisa de palavras-chave e concorrentes.
- O pipeline gera artigo a partir de keyword e transcrição.
- O pipeline registra histórico de geração, revisão e deploy.
- Deploy de conteúdo é ação sensível e exige aprovação humana.
- Quando endpoint real estiver indisponível, a UI deve deixar claro que está usando amostra local.

### RF-023: Settings

O sistema deve ter área de configurações por usuário.

Itens extraídos das imagens:

- Perfil de usuário com e-mail.
- Idioma `pt-BR` e `en-US`.
- Notificações.
- Efeitos sonoros.
- Autosave.
- AI Engine com seleção de modelo.
- Stream de respostas.
- `Identity / Soul`, com personalidade e tom do assistente.

Critérios de aceite:

- Configurações são salvas por usuário e por espaço quando aplicável.
- Idioma padrão deve ser `pt-BR`.
- O usuário pode escolher modelo padrão entre provedores habilitados.
- O usuário pode ativar/desativar stream de resposta.
- A identidade/persona deve ser editável sem alterar regras de segurança.

### RF-024: Multiusuário

O sistema deve suportar múltiplos usuários.

Critérios de aceite:

- Cada usuário possui perfil, permissões, preferências e trilha de auditoria.
- Dados pessoais do NOA são privados por padrão.
- Dados profissionais do JARVIS OS podem ser compartilhados por organização, projeto ou squad.
- O modelo de permissão deve distinguir owner, admin, operator, viewer e agent-service-account.

### RF-025: Voz Online no MVP e Offline como Evolução

O sistema deve implementar voz online no MVP e manter arquitetura preparada para voz offline.

Critérios de aceite:

- O app deve aceitar comandos por microfone usando provedores online configurados.
- O estado de voz deve indicar provedor ativo, modo local/cloud, escutando, processando, respondendo, erro ou indisponível.
- Cloud STT/TTS pode ser requisito do MVP, desde que exista fallback textual para comandos essenciais.
- A evolução offline deve prever wake/listen/transcribe local quando houver modelo local configurado.
- Ações por voz devem seguir as mesmas políticas de aprovação do texto.

## Ações Possíveis e Política de Aprovação

### Baixo risco, pode executar sem aprovação se o usuário configurar assim

- Criar tarefa no Kanban.
- Mover tarefa entre colunas.
- Criar anotação/memória não sensível.
- Consultar status de serviço.
- Listar arquivos em diretórios permitidos.
- Executar workflow simulado.
- Gerar rascunho de texto sem publicar.
- Rodar análise local somente leitura.
- Alterar preferência visual, idioma, som ou autosave.

### Médio risco, exige aprovação por padrão

- Criar ou alterar automação.
- Ativar/desativar workflow.
- Instalar ou atualizar skill.
- Conectar novo provider.
- Ler arquivo fora de diretório previamente permitido.
- Executar comando de terminal allowlisted.
- Fazer chamada para API externa.
- Gravar arquivo em diretório permitido.
- Criar branch, commit ou PR.
- Enviar mensagem para canal interno em modo rascunho/aprovação.
- Sincronizar memória local com Supabase.

### Alto risco, sempre exige aprovação explícita

- Executar comando destrutivo no terminal.
- Apagar, mover ou sobrescrever arquivos.
- Alterar credenciais, tokens, `.env`, vault ou secrets.
- Publicar conteúdo em site, rede social, e-mail marketing ou canal externo.
- Enviar e-mail, WhatsApp, Telegram, Slack ou Discord para terceiros.
- Fazer deploy em produção.
- Alterar banco de dados remoto.
- Alterar permissões de usuário, agente, squad ou workspace.
- Ativar modo autônomo remoto.
- Instalar dependência, binário, extensão ou MCP server.
- Executar código baixado da internet.
- Acessar dados de saúde, finanças ou documentos pessoais sensíveis.
- Exportar memória, logs, relatórios financeiros ou dados pessoais.
- Gastar acima do orçamento configurado.

### Bloqueado no MVP

- Execução autônoma sem limite de custo.
- Comandos administrativos do sistema operacional sem sandbox.
- Coleta contínua de microfone sem indicador visual.
- Publicação externa sem revisão humana.
- Compartilhamento entre NOA e JARVIS OS sem ação explícita do usuário.
- Execução de skills de origem externa sem revisão de segurança.

## Requisitos Não Funcionais

### RNF-001: Separação de contexto

Dados pessoais e profissionais não devem compartilhar memória, credenciais ou automações por padrão.

### RNF-001.2: Separação de plataforma e produto

Backlog técnico de desenvolvimento, features pessoais do NOA e features profissionais do JARVIS OS devem ser documentados e planejados separadamente.

### RNF-001.1: Isolamento multiusuário

Dados, permissões, custos e auditorias devem ser isolados por usuário e organização.

### RNF-002: Auditabilidade

Toda ação executada por agente deve gerar evento auditável com autor, entrada, decisão, ferramenta, resultado e timestamp.

### RNF-003: Observabilidade

O sistema deve expor logs, métricas e rastros suficientes para depurar falhas de agentes e workflows.

### RNF-004: Segurança por padrão

O MVP não deve executar comandos destrutivos, enviar mensagens, publicar conteúdo, alterar dados externos ou ultrapassar orçamento sem aprovação explícita.

### RNF-005: Extensibilidade

Novos provedores, conectores, skills e harnesses devem ser adicionados por adaptadores isolados.

### RNF-006: Disponibilidade operacional

O sistema deve suportar execução contínua, mas com monitoramento, retentativa, fallback e parada manual.

### RNF-007: UX

A interface deve seguir estética de command center escuro, com alto contraste, status luminosos e painéis densos. A estética não pode prejudicar leitura, acessibilidade ou clareza operacional.

### RNF-008: Operação local e evolução offline

Comandos essenciais devem ter fallback textual local. Voz offline e roteamento local sem internet ficam como evolução planejada, sem bloquear o MVP online.

## Modelo de Informação Inicial

Entidades mínimas:

- `Workspace`: NOA ou JARVIS OS.
- `Agent`: executor individual.
- `Squad`: grupo de agentes.
- `Skill`: capacidade executável.
- `Workflow`: fluxo composto por etapas.
- `Automation`: gatilho agendado, evento ou manual.
- `Connector`: integração externa.
- `Provider`: provedor de IA, voz, busca ou storage.
- `CredentialRef`: referência segura a segredo.
- `Execution`: execução de agente, skill ou workflow.
- `MemoryItem`: item de memória contextual.
- `ApprovalRequest`: pedido de aprovação humana.
- `CostEvent`: evento financeiro de execução.
- `AuditEvent`: registro operacional imutável.
- `ServiceHealth`: estado de serviço interno.
- `ProviderRoute`: regra de roteamento por tipo de tarefa.
- `UserProfile`: perfil, preferências e identidade do usuário.
- `BudgetPolicy`: orçamento diário/mensal por usuário, espaço, squad ou agente.
- `Specialty`: especialidade que agrupa agentes, squads e skills.
- `MemorySource`: origem versionada de conteúdo, como nota, arquivo, artefato ou página do Obsidian.
- `MemoryEntry`: unidade lógica de conhecimento extraída de uma fonte.
- `MemoryChunk`: trecho indexável usado em busca e RAG.
- `MemoryConcept`: conceito identificado ou confirmado na memória.
- `MemoryRelation`: relação tipada entre conceitos, entradas e fontes.
- `MemoryRetrieval`: registro dos trechos e fontes recuperados para uma execução.
- `Notebook`: coleção profissional de notas do Agentic OS.
- `Note`: nota versionada, categorizada e opcionalmente indexada.

## MVP Proposto

### Corte 1: Fundação

- App desktop Electron.
- Shell visual com alternância NOA/JARVIS OS.
- Navegação lateral com módulos extraídos das imagens.
- Multiusuário básico com perfis e isolamento de workspace.
- Mission Control com dados mockados.
- Catálogo inicial de agents, squads e skills.
- Área Agentic OS interna ao JARVIS OS com Core, Harnesses, Teams, Governance e Knowledge.
- Agent Memory e Notebook com dados mockados, incluindo as visões Rede, Recentes, Notas e Busca.
- Painel de conectores com status mockado.
- Settings com idioma, notificações, autosave, modelo padrão e identidade.

### Corte 2: Execução local controlada

- Supabase local via Docker para desenvolvimento.
- Registro de workflows.
- Registro de automações manuais.
- Execução simulada e execução real allowlisted com logs e auditoria.
- Modelo de permissões básico.
- Terminal controlado dentro do OS Desktop.
- Diretórios permitidos configuráveis pelo administrador.
- BudgetPolicy com limites separados de USD 1 por dia e USD 1 por mês, ajustáveis pelo administrador.

### Corte 3: Integrações reais

- Providers de IA configuráveis.
- Conectores reais prioritários: Google Gemini, Google Workspace, OpenAI, ElevenLabs, Claude API, Claude Code CLI, Ollama e Supabase.
- Vault/env seguro para credenciais.
- Métricas reais de custo e execução.
- Memória híbrida local + Supabase.
- Ingestão de fontes permitidas, indexação textual/vetorial, grafo de conceitos e recuperação RAG com rastreabilidade.
- Obsidian MCP como fonte opcional do Agent Memory.

### Corte 4: Voz e automação

- Entrada por voz online.
- Saída por voz online com ElevenLabs ou provedor configurado.
- Crons.
- Squads executando workflows com aprovação humana.
- Power Guard para workflows longos.

### Corte 5: Evolução offline e multiplataforma

- Voz offline local.
- Empacotamento para macOS e Linux.
- Roteamento local/offline quando modelos locais estiverem configurados.

## Fora do Escopo Inicial

- Controle profundo do sistema operacional sem allowlist/sandbox.
- OAuth completo para todos os conectores.
- Marketplace público de skills.
- Execução totalmente autônoma sem aprovação.
- Controle de hardware externo ou robótica.

## Riscos

- Escopo amplo demais para MVP.
- Mistura indevida entre contexto pessoal e profissional.
- Credenciais expostas em UI, logs ou prompts.
- Automação sem governança gerando custo ou ações externas indevidas.
- Dependência de frameworks ou repositórios externos sem validar licença, manutenção e segurança.
- Interface visualmente forte, mas pouco legível em uso real.
- Desktop app com terminal real aumenta risco de dano local; a primeira versão precisa de permissões conservadoras.
- Multiusuário com memória híbrida aumenta risco de vazamento entre NOA, JARVIS OS, usuários e organizações.

## Perguntas Abertas

1. Qual provedor online será usado para STT no MVP: OpenAI, Google ou outro?
2. Supabase Docker será apenas desenvolvimento local ou também modo single-user/offline de produção local?
3. Quais papéis terão permissão administrativa para configurar diretórios permitidos?
4. A primeira build distribuível será apenas Windows ou já haverá pipeline preparado para macOS/Linux sem release público?

## Critérios de Sucesso do Primeiro Release

- Usuário alterna entre NOA e JARVIS OS.
- Usuário faz login multiusuário.
- App roda como desktop app Electron em Windows durante o desenvolvimento.
- Mission Control mostra agentes, execuções, sucesso, skills e custo.
- Agentic OS aparece como área interna do JARVIS OS e não como workspace independente.
- Agent Memory permite navegar pela rede, consultar itens recentes, editar notas e buscar conteúdo.
- Recuperação RAG registra fontes e trechos usados sem consultar a memória pessoal do NOA por padrão.
- Command Center aceita comando de texto, comando de voz online e registra execução.
- Painel de conectores mostra status sem expor segredos.
- Catálogo de skills permite listar, filtrar e abrir detalhes.
- Automations permite cadastrar ao menos uma automação manual.
- OS Desktop mostra File Explorer, Terminal e System Monitor.
- Terminal real só executa comandos permitidos e auditados.
- Toda execução gera `AuditEvent`.
- Ações sensíveis ficam bloqueadas por aprovação humana.
- BudgetPolicy impede gasto acima dos limites diário e mensal configurados.

# PRD: Design System da Plataforma

## Metadados

- Status: aprovado para planejamento.
- Data: 18 de julho de 2026.
- Produto inicial: JARVIS OS.
- Plataforma: shell e capacidades compartilhadas entre JARVIS OS e, futuramente, NOA.
- Público do documento: Produto, Design, Front-end, QA e responsáveis pela arquitetura da Plataforma.
- Documentos relacionados:
  - `docs/requisitos-agent-os.md`.
  - `docs/plano-implementacao-agent-os.md`.
  - `docs/fronteiras-desenvolvimento-noa-jarvisos.md`.

## 1. Resumo executivo

A Plataforma precisa de um design system compartilhado que permita construir o JARVIS OS sem criar componentes, estilos e comportamentos diferentes em cada módulo. A primeira versão deve entregar foundations, componentes acessíveis e padrões operacionais reutilizáveis para navegação, execução de agentes, aprovações, risco, custos, logs, sincronização e feedback.

O sistema visual terá carbono como base, modos claro e escuro, densidade confortável ou compacta e uma cor de destaque configurável pelo usuário. Cores semânticas permanecerão controladas pelo design system para preservar significado e contraste.

O design system será implementado em React e TypeScript, usando Tailwind CSS v4 para tokens e estilos, Radix Primitives como base headless acessível, Lucide React para iconografia, Storybook como catálogo executável, Vitest e Testing Library para comportamento e Playwright para regressão visual.

O primeiro consumidor será o JARVIS OS. O NOA deverá reutilizar os mesmos fundamentos e componentes quando entrar no roadmap, sem criar um segundo design system.

## 2. Contexto e problema

Os documentos atuais descrevem uma aplicação Electron extensa, com Command Center, Mission Control, agents, providers, automações, memória, terminal, auditoria e múltiplos estados operacionais. Sem uma base visual e comportamental comum, cada módulo tende a criar:

- cores e espaçamentos próprios;
- controles com estados diferentes;
- mensagens inconsistentes;
- fluxos divergentes de aprovação e risco;
- baixa previsibilidade para teclado e leitores de tela;
- duplicação de componentes;
- dificuldade para suportar claro, escuro e densidades diferentes;
- regressões visuais difíceis de identificar.

O design system deve resolver essas inconsistências sem virar um repositório de telas completas nem absorver regras de negócio dos módulos.

## 3. Decisões de produto e arquitetura relacionadas

Este PRD adota as seguintes decisões aprovadas durante a análise dos documentos:

1. `Plataforma` é o shell e o núcleo compartilhado. Não é um terceiro workspace.
2. JARVIS OS é o primeiro produto funcional. NOA permanece preparado pelo design system, mas não integra o primeiro release comercial.
3. A Plataforma será um SaaS multi-tenant compartilhado, com isolamento por usuário, organização e workspace.
4. Supabase Cloud será a fonte de verdade dos dados sincronizados.
5. Supabase Docker será usado somente em desenvolvimento e testes.
6. Um armazenamento local embarcado poderá atuar como cache e outbox reconstruíveis, não como backup ou única fonte de verdade.
7. O runtime Electron executará em processo isolado e supervisionado, separado do renderer e das responsabilidades de janela do processo principal.
8. Providers de IA usarão BYOK. O usuário arcará diretamente com o consumo do provider configurado.
9. No MVP, chaves de IA ficarão somente no cofre seguro do sistema operacional.
10. Agentes e automações funcionarão apenas enquanto a Plataforma estiver aberta.
11. O design system será organizado em pacotes de tokens, componentes e padrões, com documentação executável no Storybook.

Essas decisões são dependências do design system, mas não transferem persistência, segurança, sincronização ou regras de negócio para os componentes visuais.

## 4. Visão do produto

Permitir que qualquer módulo da Plataforma componha uma experiência operacional coerente, acessível, tematizável e segura usando contratos visuais e comportamentais compartilhados.

## 5. Objetivos

### 5.1 Objetivos principais

- Estabelecer uma linguagem visual compartilhada para a Plataforma.
- Entregar componentes React acessíveis e tipados.
- Padronizar fluxos operacionais recorrentes.
- Suportar modos claro e escuro sem divergência funcional.
- Suportar densidades confortável e compacta.
- Permitir cor de destaque configurável com validação de contraste.
- Reduzir componentes e estilos locais nos módulos.
- Transformar Storybook em catálogo, documentação e superfície de testes.
- Permitir que o futuro NOA reutilize a mesma base com identidade semântica própria.

### 5.2 Não objetivos

- Construir telas completas do JARVIS OS.
- Definir regras de domínio de agents, workflows, custos ou aprovações.
- Criar um design system separado para NOA.
- Entregar biblioteca mobile nativa.
- Criar marketplace público de temas.
- Armazenar chaves BYOK na nuvem.
- Habilitar execução remota de agentes.
- Tornar Figma a fonte oficial na primeira versão.

## 6. Usuários e necessidades

### 6.1 Operador da Plataforma

Precisa identificar rapidamente o estado do sistema, executar comandos, acompanhar agentes, entender custos, distinguir riscos e agir sobre falhas sem ambiguidade.

### 6.2 Administrador

Precisa configurar providers, políticas, temas e permissões com indicação clara de impacto e segurança.

### 6.3 Desenvolvedor de produto

Precisa compor módulos sem recriar tokens, acessibilidade, estados e padrões operacionais.

### 6.4 QA e responsável por acessibilidade

Precisam de casos executáveis, matriz de estados, baselines visuais e critérios objetivos de aprovação.

## 7. Princípios de design

1. Clareza antes de efeito visual.
2. Densidade sem compressão ilegível.
3. Estado nunca comunicado apenas por cor.
4. Ações sensíveis devem mostrar impacto antes da confirmação.
5. Componentes não conhecem infraestrutura nem domínio.
6. Preferências visuais não alteram significado semântico.
7. Teclado é uma forma de interação primária, não um complemento.
8. Falhas devem ser visíveis, localizáveis e recuperáveis.
9. Padrões compartilhados prevalecem sobre customizações locais.
10. Código documentado e testado é a fonte de verdade.

## 8. Arquitetura do design system

```text
@plataforma/tokens
  - valores-base
  - tokens semânticos
  - temas claro/escuro
  - densidades
  - movimento

@plataforma/ui
  - componentes React
  - Radix Primitives
  - Tailwind CSS v4
  - Lucide React

@plataforma/patterns
  - padrões operacionais compostos
  - contratos tipados
  - sem acesso a dados ou infraestrutura

Storybook
  - documentação executável
  - estados e exemplos
  - testes de interação
  - acessibilidade
  - baselines visuais
```

### 8.1 Regras de dependência

- `tokens` não depende de React.
- `ui` depende de `tokens` e primitivas acessíveis.
- `patterns` depende de `ui` e contratos públicos.
- Módulos de produto dependem dos pacotes públicos.
- Pacotes do design system não importam módulos do JARVIS OS ou NOA.
- Componentes não acessam Supabase, Electron Main, filesystem, providers ou secrets.
- Padrões recebem dados, estado e callbacks por props tipadas.
- Estilos internos não fazem parte da API pública.

## 9. Sistema de tokens

### 9.1 Camadas

#### Tokens-base

- Paleta de cores.
- Escala tipográfica.
- Espaçamento.
- Tamanhos.
- Raios.
- Bordas.
- Sombras e elevação.
- Duração e curvas de movimento.
- Z-index.
- Breakpoints.

#### Tokens semânticos

- `surface`, `surface-raised`, `surface-overlay`.
- `text-primary`, `text-secondary`, `text-muted`, `text-inverse`.
- `border-default`, `border-strong`, `border-focus`.
- `action-primary`, `action-secondary`, `action-danger`.
- `status-success`, `status-info`, `status-warning`, `status-error`.
- `risk-low`, `risk-medium`, `risk-high`, `risk-blocked`.
- `focus-ring`, `selection`, `backdrop`.

#### Tokens de componente

Tokens específicos só serão criados quando um componente não puder ser expresso de forma estável pelos tokens semânticos existentes.

### 9.2 Tema carbono

- Carbono é a identidade-base da Plataforma.
- O modo escuro usa superfícies grafite e contraste controlado.
- O modo claro usa superfícies neutras claras sem abandonar a hierarquia carbono.
- Brilho e glow são reservados para foco, atividade e estados operacionais importantes.
- Efeitos decorativos não podem competir com texto, custo, risco ou aprovação.

### 9.3 Cor de destaque

- O usuário pode escolher a cor de destaque.
- A cor é aplicada a seleção, foco de marca, controles ativos e ações primárias permitidas.
- A cor passa por validação de contraste nos modos claro e escuro.
- Uma cor inválida é ajustada para o tom acessível mais próximo ou rejeitada com explicação.
- A cor de destaque nunca substitui sucesso, informação, alerta, erro ou risco.

### 9.4 Modos e densidade

- Modos: `system`, `light` e `dark`.
- `system` é o padrão inicial.
- Densidades: `comfortable` e `compact`.
- `comfortable` é o padrão inicial.
- A mudança de tema ou densidade ocorre sem reload.
- Preferências podem ser sincronizadas no perfil cloud.
- Uma cópia local é aplicada antes da primeira renderização para evitar flash visual.

## 10. Tipografia e iconografia

### 10.1 Tipografia

- A tipografia deve priorizar leitura prolongada em interfaces densas.
- Números de custo, tokens, duração e métricas devem usar algarismos tabulares.
- Logs e comandos usam fonte monoespaçada definida por token.
- Títulos não podem depender apenas de caixa alta para indicar hierarquia.
- O layout deve suportar expansão de texto para localização.

### 10.2 Iconografia

- Lucide React será o conjunto padrão.
- Ícones serão importados individualmente.
- Tamanhos, stroke e alinhamento serão definidos por tokens.
- Ícone decorativo será ocultado de tecnologia assistiva.
- Ícone que representa ação precisa de nome acessível.
- Cor do ícone herda `currentColor`, salvo estado semântico explícito.

## 11. Componentes da primeira versão

### 11.1 Ações

- Button.
- IconButton.
- ButtonGroup.
- Link.

### 11.2 Formulários

- Field.
- Label.
- Input.
- PasswordInput.
- Textarea.
- Select.
- Combobox.
- Checkbox.
- RadioGroup.
- Switch.
- Slider.
- FormMessage.

### 11.3 Navegação e estrutura

- AppShell.
- Sidebar.
- NavigationGroup.
- WorkspaceSwitcher.
- TopBar.
- Breadcrumb.
- PageHeader.
- Tabs.
- Accordion.
- CommandBar.
- CommandPalette.
- ThemeSwitcher.
- DensitySwitcher.
- AccentColorPicker.

### 11.4 Exibição de dados

- Card.
- Panel.
- Badge.
- Tag.
- Avatar.
- Table.
- Tree.
- Separator.
- Tooltip.
- Progress.
- Meter.
- Skeleton.
- Spinner.
- EmptyState.

### 11.5 Overlays e feedback

- Popover.
- DropdownMenu.
- Dialog.
- AlertDialog.
- Drawer.
- Toast.
- InlineAlert.
- ErrorState.
- LoadingState.

## 12. Padrões operacionais da primeira versão

### 12.1 Status

- AgentStatus.
- ServiceStatus.
- ProviderStatus.
- ConnectorStatus.
- ExecutionStatus.
- SyncStatus.

Cada padrão combina texto, ícone e cor semântica.

### 12.2 Risco e aprovação

- RiskIndicator.
- SensitiveActionSummary.
- ApprovalRequestCard.
- ApprovalDialog.
- RejectionReason.

O padrão deve exibir ação, solicitante, impacto, risco, custo estimado e escopo antes da confirmação.

### 12.3 Execução e custo

- ExecutionCard.
- ExecutionRow.
- ExecutionTimeline.
- CostMeter.
- BudgetStatus.
- DurationIndicator.

### 12.4 Operação e diagnóstico

- AuditEvent.
- LogViewer.
- RuntimeUnavailable.
- RetryAction.
- OfflineBanner.
- PendingSyncNotice.

### 12.5 Providers e BYOK

- ProviderSetup.
- ApiKeyField.
- ProviderValidationStatus.
- MaskedCredentialSummary.
- RemoveCredentialDialog.

Mensagem obrigatória no setup:

> Suas chaves de IA ficam protegidas neste dispositivo e não são armazenadas na nuvem. Agentes e automações funcionam somente enquanto a Plataforma estiver aberta. Se você trocar de computador, precisará configurar as chaves novamente.

### 12.6 Notificações

- ToastViewport.
- NotificationCenter.
- NotificationItem.
- UnreadIndicator.

## 13. Regras de toast e mensagens

### 13.1 Variantes

- `success`: confirmação relevante concluída.
- `info`: informação contextual não crítica.
- `warning`: atenção necessária sem bloqueio imediato.
- `error`: falha que precisa ser compreendida.

### 13.2 Comportamento

- Todo toast possui título, mensagem, ícone e fechamento manual.
- Ação opcional deve ser específica, como `Tentar novamente` ou `Abrir detalhes`.
- `success` e `info` usam anúncio não interruptivo.
- `warning` e `error` usam anúncio prioritário sem mover o foco automaticamente.
- O temporizador pausa em hover ou foco.
- No máximo três toasts aparecem simultaneamente.
- Eventos equivalentes são deduplicados.
- Mensagens relevantes permanecem na NotificationCenter.
- Erro que exige ação permanece também no contexto da falha.
- Ação destrutiva ou sensível usa AlertDialog, nunca apenas toast.

## 14. Acessibilidade

### 14.1 Meta

Todos os componentes e padrões públicos devem atender WCAG 2.2 nível AA.

### 14.2 Requisitos

- Operação completa por teclado.
- Ordem de foco previsível.
- Foco visível e não encoberto.
- Escape fecha overlays quando não houver risco de perda silenciosa.
- Contraste mínimo em claro e escuro.
- Alvos de interação compatíveis com WCAG 2.2.
- Nome, papel e estado expostos corretamente.
- Estados não dependem apenas de cor.
- Zoom e reflow não podem ocultar ações essenciais.
- Movimento respeita `prefers-reduced-motion`.
- Drag and drop deve possuir alternativa por teclado.
- Autenticação e setup não devem depender de testes cognitivos desnecessários.
- Textos de erro devem identificar problema e próxima ação.

## 15. Segurança e privacidade na interface

- Chaves BYOK são persistidas somente pelo runtime no cofre seguro do sistema operacional.
- O renderer não persiste chaves em storage, cache, logs ou telemetria.
- Chaves não são enviadas ao Supabase.
- Depois da configuração, a UI exibe apenas provider, status, últimos quatro caracteres e data da validação.
- Remover uma chave exige confirmação e informa execuções afetadas.
- Inputs sensíveis desabilitam cópia acidental em superfícies de resumo.
- Erros de provider não podem incluir request headers ou segredo bruto.
- Componentes de logs devem permitir redaction antes da exibição.
- Estados de risco usam texto explícito e não podem ser retematizados pelo usuário.

## 16. Fluxos de configuração

### 16.1 Tema

```text
Preferência local inicial
  -> modo system/light/dark
  -> tema carbono
  -> cor de destaque validada
  -> densidade comfortable/compact
  -> tokens semânticos
  -> componentes
```

### 16.2 Eventos operacionais

```text
Runtime ou módulo de produto
  -> contrato tipado de evento
  -> padrão operacional
  -> feedback contextual
  -> toast quando aplicável
  -> NotificationCenter quando persistência for necessária
```

### 16.3 Falha do runtime

Uma falha no runtime isolado não pode derrubar o shell. A interface deve:

1. preservar navegação e contexto visual;
2. indicar indisponibilidade;
3. bloquear ações dependentes;
4. permitir copiar diagnóstico redigido;
5. oferecer reinício do runtime quando permitido;
6. informar se existem alterações pendentes.

## 17. Storybook e documentação

Cada componente público terá:

- propósito;
- quando usar e quando não usar;
- API tipada;
- variantes;
- estados de interação;
- exemplos com conteúdo realista;
- exemplo de erro;
- exemplo com texto longo;
- comportamento em claro e escuro;
- comportamento em confortável e compacto;
- instruções de teclado;
- requisitos de acessibilidade;
- antipadrões.

Stories são casos executáveis e podem ser reutilizadas por testes. Componentes sem documentação e story não integram a API pública.

## 18. Governança

### 18.1 Fluxo de contribuição

1. Identificar necessidade não atendida.
2. Verificar se composição existente resolve o caso.
3. Definir contrato e semântica.
4. Alterar tokens somente quando necessário.
5. Implementar de forma isolada.
6. Documentar no Storybook.
7. Adicionar testes.
8. Revisar acessibilidade.
9. Publicar changelog.

### 18.2 Versionamento

- APIs públicas seguem versionamento semântico.
- Correção compatível gera patch.
- Funcionalidade compatível gera minor.
- Remoção ou quebra de contrato gera major.
- Mudança incompatível exige guia de migração.
- Depreciação deve permanecer documentada por pelo menos uma versão minor antes da remoção, salvo vulnerabilidade.

### 18.3 Restrições

- Módulos não podem criar novos valores de cor, espaçamento ou tipografia sem proposta ao design system.
- Overrides internos por seletor CSS não são permitidos.
- Componente especializado de produto não entra no design system sem pelo menos dois casos reais de reutilização ou um padrão transversal comprovado.

## 19. Estratégia de testes

### 19.1 Unitários e contratos

- Vitest cobre lógica, variantes, reducers e contratos.
- Tipos públicos são validados durante build.
- Alterações de tokens passam por validação estrutural.

### 19.2 Interação e semântica

- Testing Library cobre comportamento pelo papel acessível.
- Stories de interação são reutilizadas quando aplicável.
- Fluxos cobrem teclado, foco, fechamento e recuperação de erro.

### 19.3 Acessibilidade

- Auditoria automatizada em todas as stories públicas.
- Teste manual por teclado nos componentes interativos.
- Revisão manual de leitores de tela nos padrões críticos.
- Contraste validado em claro, escuro e cor personalizada.

### 19.4 Regressão visual

- Playwright mantém screenshots de componentes e padrões estáveis.
- A matriz cobre claro/escuro, confortável/compacto e uma cor personalizada extrema.
- Estados cobertos: default, hover, focus, active, disabled, loading e error.
- Conteúdo coberto: vazio, curto, longo e localizado.
- Animações, cursores e dados variáveis são estabilizados antes do snapshot.
- Mudança de baseline exige revisão explícita.

### 19.5 Electron

- Testes integrados validam tema do sistema, atalhos, escala, overlays e comportamento após falha do runtime.

## 20. Gate de release

Um componente ou padrão público só pode ser liberado quando possuir:

- API tipada e estável;
- documentação e story;
- estados claro e escuro;
- densidades confortável e compacta;
- testes de interação;
- verificação de teclado e foco;
- auditoria automática sem falhas críticas;
- baseline visual aprovada;
- changelog;
- ausência de segredo ou dado sensível em exemplos.

## 21. Plano de entrega

### Fase DS-0: Infraestrutura

- Criar os pacotes.
- Configurar tokens e Tailwind CSS v4.
- Configurar Storybook.
- Configurar testes e CI.
- Definir convenções públicas.

### Fase DS-1: Foundations

- Implementar tema carbono.
- Implementar claro/escuro.
- Implementar densidades.
- Implementar cor de destaque validada.
- Implementar tipografia, iconografia e movimento.

### Fase DS-2: Componentes essenciais

- Implementar ações, formulários, navegação, dados, overlays e feedback.
- Documentar estados e acessibilidade.

### Fase DS-3: Shell e padrões operacionais

- Implementar AppShell.
- Implementar padrões de status, execução, risco, aprovação, custo, logs, sincronização, providers e notificações.

### Fase DS-4: Adoção e hardening

- Construir a primeira jornada do JARVIS OS.
- Remover duplicações locais.
- Executar revisão de acessibilidade.
- Estabilizar baselines visuais.
- Publicar a primeira versão interna.

## 22. Requisitos e critérios de aceite

### DS-001: Tema compartilhado

O sistema deve aplicar o tema carbono a todos os componentes públicos.

Aceite:

- claro e escuro apresentam paridade funcional;
- troca ocorre sem reload;
- preferência `system` acompanha o sistema operacional.

### DS-002: Cor configurável

O usuário deve poder escolher a cor de destaque.

Aceite:

- contraste é validado;
- estados semânticos não são alterados;
- preferência é restaurada localmente e pode ser sincronizada.

### DS-003: Densidade

O usuário deve poder alternar entre confortável e compacto.

Aceite:

- confortável é padrão;
- compacto preserva alvos e legibilidade;
- troca ocorre sem reload.

### DS-004: Componentes acessíveis

Todos os componentes públicos devem atender WCAG 2.2 AA.

Aceite:

- operação por teclado;
- foco visível;
- nome, papel e estado corretos;
- nenhuma falha crítica na auditoria automatizada.

### DS-005: Toast padrão

O sistema deve oferecer toast para `success`, `info`, `warning` e `error`.

Aceite:

- variante possui semântica adequada;
- temporizador pausa em hover e foco;
- fechamento manual está disponível;
- mensagens relevantes persistem na NotificationCenter;
- erro acionável também aparece no contexto.

### DS-006: Ações sensíveis

Ações sensíveis devem usar padrões explícitos de risco e aprovação.

Aceite:

- ação, solicitante, impacto, risco e custo são exibidos;
- confirmação usa verbo específico;
- alto risco não usa confirmação genérica.

### DS-007: BYOK local

O setup deve informar e aplicar o armazenamento local das chaves.

Aceite:

- mensagem aprovada é exibida;
- chave não é enviada à nuvem;
- resumo exibe somente dados mascarados;
- remoção informa dependências afetadas.

### DS-008: Estados de sincronização

O sistema deve distinguir sincronização concluída, em andamento, offline, pendente e falha.

Aceite:

- estado usa texto, ícone e cor;
- risco de perda de alteração pendente é informado;
- retry é oferecido quando aplicável.

### DS-009: Documentação executável

Todos os componentes públicos devem existir no Storybook.

Aceite:

- documentação, estados e acessibilidade estão descritos;
- stories são executáveis em CI;
- componente sem story não é exportado publicamente.

### DS-010: Independência de domínio

O design system não deve acessar domínio ou infraestrutura.

Aceite:

- nenhum pacote importa módulos do JARVIS OS, Supabase ou Electron Main;
- padrões recebem dados e callbacks por contratos tipados.

## 23. Métricas de sucesso

- 100% dos componentes públicos documentados no Storybook.
- 100% dos componentes públicos com testes de interação aplicáveis.
- Zero falha crítica de acessibilidade no gate de release.
- Zero segredo BYOK em logs, telemetria, Supabase ou fixtures.
- Primeira jornada do JARVIS OS sem novos tokens ou componentes paralelos.
- Troca de tema e densidade sem reload ou perda de contexto.
- Redução progressiva de estilos locais não registrados.
- Toda nova funcionalidade do shell usa padrões públicos quando houver equivalente.

## 24. Riscos e mitigação

### Escopo excessivo

Risco: transformar o design system em coleção de módulos completos.

Mitigação: exigir transversalidade e manter telas de produto fora dos pacotes.

### Customização sem controle

Risco: cor de destaque comprometer contraste ou semântica.

Mitigação: validar contraste e bloquear substituição de cores de estado.

### Carbono virar estética ilegível

Risco: excesso de glow, caixa alta e painéis densos.

Mitigação: reservar efeitos para estados, testar leitura prolongada e manter modo claro equivalente.

### Radix exposto diretamente

Risco: consumidores dependerem da API interna das primitivas.

Mitigação: encapsular contratos públicos em `@plataforma/ui`.

### Snapshots instáveis

Risco: regressão visual gerar ruído.

Mitigação: estabilizar animação, fonte, viewport, dados e ambiente de execução.

### BYOK inconsistente

Risco: módulos tratarem chaves de formas diferentes.

Mitigação: usar um único ProviderSetup e persistência exclusiva pelo runtime seguro.

## 25. Dependências

- Bootstrap Electron + React + TypeScript.
- Runtime isolado e IPC tipado.
- Store de preferências visuais.
- Contratos de execução, risco, aprovação, custo e sincronização.
- Estratégia de cofre seguro do sistema operacional.
- CI capaz de executar Storybook, Vitest e Playwright.

## 26. Referências técnicas

- Electron Security: <https://www.electronjs.org/docs/latest/tutorial/security>.
- React: <https://react.dev/learn>.
- Tailwind CSS Theme Variables: <https://tailwindcss.com/docs/theme>.
- Radix Primitives: <https://www.radix-ui.com/primitives/docs>.
- Storybook: <https://storybook.js.org/docs>.
- Playwright Visual Comparisons: <https://playwright.dev/docs/test-snapshots>.
- Lucide React: <https://lucide.dev/guide/packages/lucide-react>.
- WCAG 2.2: <https://www.w3.org/TR/WCAG22/>.
- WAI-ARIA Authoring Practices: <https://www.w3.org/WAI/ARIA/apg/patterns/>.

## 27. Resultado esperado

Ao final da primeira versão, o JARVIS OS deverá possuir um shell coerente e uma primeira jornada funcional construída exclusivamente com tokens, componentes e padrões públicos. A base deverá aceitar a futura identidade do NOA sem duplicar a infraestrutura visual nem comprometer isolamento de dados e comportamento.

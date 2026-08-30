# SPEC-Shell-01 — Menu do JARVIS OS e do Agents OS

- MVP/Fatia: MVP-019 · M19-F01 (`docs/mvp/mvp-019-shell-de-produto.md`).
- Issue: — (nasce quando a spec virar `aprovada-pi`).
- Status: **rascunho** (2026-08-30) — três decisões do PI já cravadas (ver MVP-019); **perguntas abertas no fim**. Implementação não autorizada.
- Depende de: M3-F04a (AppShell, rail dual, `navegacao.ts`), M4-F03/FIX #172 (Settings em abas). Entregues.
- Fontes: protótipo `docs/design/design-system/JARVISOS.md §2` (forma do menu — **vence o PRD**), SPEC-Fundacao-02 (isolamento por espaço), SPEC-DesignSystem-04a (shell), CLAUDE.md ("Agentic OS é área interna do JARVIS OS, nunca um quarto workspace"; "sem mock").

## Objetivo

Substituir as listas placeholder de `navegacao.ts` pelo menu do protótipo, **mostrando apenas os itens que abrem módulo entregue**, com HARNESSES vindo dos executores registrados e um único caminho para cada tela.

## O que o protótipo já decide (não se rediscute aqui)

- Rail dual: Command Center ⇄ Agents OS; atalho NOA; Sair.
- Sidebar com header dinâmico ("JARVIS / PROFESSIONAL OPS" · "AGENTS OS / HARNESSES · TEAMS · SKILLS").
- Grupos, ordem e rótulos dos dois sub-módulos (tabela abaixo, colunas *grupo* e *item*).
- Estilo: grupo em mono uppercase, item ativo com dot no acento, título da view na topbar.

## Regras

1. **Menu é projeção do registro de módulos.** Cada módulo entregue se registra com `{ id, subModulo: 'command' | 'agents', grupo, ordem, rota, rotulo (chave i18n), disponivel(): boolean }`. A sidebar renderiza `registro.filter(disponivel)` agrupado e ordenado; **não existe lista de itens escrita na tela**. `navegacao.ts` passa a derivar `ROTAS_POR_SUB_MODULO` do registro, preservando `navegar`/`rotaDoWorkspace`/`subModuloDaRota` e seus testes.
2. **Item sem módulo não existe no menu** (decisão 1). Grupo sem item visível não é renderizado. Nenhuma rota leva ao cabeçalho de placeholder do AppShell — quando o último placeholder sair, o ramo `moduloDaRota === null` vira erro de programação, não estado de tela.
3. **HARNESSES é dinâmico** (decisão 2): um item por executor registrado no runtime de execução (hoje o adapter `claude-code` do MVP-005; `CodingExecutorRuntime` do MVP-010 quando existir). O item só aparece quando **existe a página de harness** que ele abre; até lá, o grupo inteiro fica oculto pela regra 2. Nomes, chips e cores por harness vêm do registro do executor, não de tabela fixa na UI.
4. **Um caminho por tela** (decisão 3): `Connectors`, `Providers` e `Permissões` **não** são itens; são abas do Settings. SISTEMA = `Terminal` + `Settings`. `Terminal` é acréscimo ao protótipo (ele não o previa) — decisão do PI.
5. **Rota inicial de cada sub-módulo = primeiro item visível do primeiro grupo visível** (já é o contrato de `rotaInicialDoSubModulo`). Não existe rota `inicio` própria; `Início` sai.
6. **Isolamento por espaço mantido:** a rota lembrada por workspace (SPEC-Fundacao-02) continua; rota que deixou de existir (módulo removido) cai na rota inicial do sub-módulo, nunca em placeholder.
7. **Nada inventado:** pill "● MODO AUTÔNOMO" do rodapé, contadores de sessão e status por harness **só aparecem quando lidos de estado real do app** (o kill-switch de merge autônomo do MVP-009 é o primeiro candidato ao pill). Até lá, rodapé sem pill.
8. **O grupo "AGENTS OS" dentro do Professional Ops** (Mission Control · Specialties · Skills Catalog) é atalho para o sub-módulo `agents` — segue as regras 1–2 como qualquer item: aparece quando o módulo-alvo existir.
9. **Rótulos por i18n** (`navegacao.<id>`), como hoje. Identificadores de rota em inglês (`projects`, `operator`, `terminal`, `settings`), rótulos em pt-BR conforme o protótipo (`Projects Hub`, `Operator Central`, …) — o protótipo mistura idiomas de propósito nos nomes próprios das telas.

## Mapa item ↔ módulo ↔ MVP (fonte única de encaixe)

Coluna *hoje* = o que fica visível ao entregar esta fatia. Coluna *MVP* = quem torna o item visível depois — **proposta do Cowork derivada do roadmap, PI pode vetar**.

### Professional Ops (`command`)

| grupo | item (protótipo) | rota | módulo | hoje | MVP que entrega |
|---|---|---|---|---|---|
| COMANDO | Command Center | `command` | — (voz/mascote) | oculto | sem MVP |
| COMANDO | HUD | `hud` | — | oculto | sem MVP |
| AGENTS OS | Mission Control | `mission` (→ `agents`) | painel de runs | oculto | MVP-009 F06 (Interface) |
| AGENTS OS | Specialties | `specialties` (→ `agents`) | — | oculto | MVP-011 |
| AGENTS OS | Skills Catalog | `skills` (→ `agents`) | — | oculto | MVP-011 F01 |
| OPERAÇÕES | Kanban | `kanban` | board do roadmap | oculto | MVP-013 |
| OPERAÇÕES | Workflows | `workflows` | registro de workflows (MVP-002 F04, sem tela) | oculto | fatia de UI a definir |
| OPERAÇÕES | Automations | `automations` | idem | oculto | fatia de UI a definir |
| OPERAÇÕES | OS Desktop | `osdesktop` | — | oculto | sem MVP |
| INTEL | Analytics | `analytics` | — | oculto | MVP-015 |
| INTEL | Insights | `insights` | — | oculto | MVP-015 |
| NEGÓCIOS | Projects Hub | `projects` | `ProjetosLocais` (+ wizard, pacote, roadmap) | **visível** | MVP-008 (entregue) |
| NEGÓCIOS | Metas | `goals` | — | oculto | sem MVP |
| NEGÓCIOS | Studio | `studio` | — | oculto | sem MVP |
| NEGÓCIOS | SEO Content | `seo` | — | oculto | sem MVP |
| NEGÓCIOS | Video Director | `video` | — | oculto | sem MVP |
| SISTEMA | Services | `services` | — | oculto | MVP-015 (saúde de serviços) |
| SISTEMA | Connectors | — | aba do Settings | **não é item** | — |
| SISTEMA | Providers | — | aba do Settings | **não é item** | — |
| SISTEMA | **Terminal** (acréscimo) | `terminal` | `TerminalControlado` | **visível** | MVP-004 (entregue) |
| SISTEMA | Settings | `settings` | `Settings` (5 abas) | **visível** | entregue |

### Agents OS (`agents`)

| grupo | item (protótipo) | rota | módulo | hoje | MVP que entrega |
|---|---|---|---|---|---|
| CORE | Mission Control | `mission` | painel de runs | oculto | MVP-009 F06 |
| CORE | Specialties | `specialties` | — | oculto | MVP-011 |
| CORE | Skills Catalog | `skills` | — | oculto | MVP-011 F01 |
| HARNESSES | *(dinâmico)* | `h_<executor>` | página de harness | oculto (sem página) | MVP-009/MVP-010 |
| TEAMS | Specialist Teams | `teams` | — | oculto | MVP-011 |
| GOVERNANCE | Operator Central | `operator` | `AprovacoesPendentes` (fila de aprovação, hoje rota `operacoes`) | **visível** | MVP-002/004 (entregue) |
| KNOWLEDGE | Agent Memory | `memory` | — | oculto | MVP-007 F07 |
| KNOWLEDGE | Notebook | `notebook` | — | oculto | MVP-007 F07 |

**Resultado ao entregar:** Professional Ops = NEGÓCIOS › Projects Hub · SISTEMA › Terminal, Settings. Agents OS = GOVERNANCE › Operator Central. Rota inicial: `projects` e `operator`. É pouco — e é **verdade**.

## Critérios de aceite

1. A sidebar não contém lista literal de itens: teste registra um módulo falso no registro e ele aparece no grupo/ordem declarados sem alteração no AppShell; remove e some.
2. Nenhuma rota visível cai no placeholder: teste percorre todos os itens visíveis e afirma `moduloDaRota !== null`.
3. Grupo sem item visível não é renderizado (teste com o registro de hoje: só NEGÓCIOS, SISTEMA e GOVERNANCE aparecem).
4. HARNESSES reflete o registro de executores: com executor sem página, o grupo não aparece; com executor e página registrados, um item por executor, nome/cor vindos do registro. Contrafactual: tabela fixa de 6 harnesses reprova.
5. `Connectors`/`Providers`/`Permissões` não são itens; o Settings continua alcançável em um clique nos dois sub-módulos.
6. Rail dual e isolamento por espaço preservados: os testes de `navegacao.spec.ts` e `shell-navegacao.test.tsx` continuam verdes; rota `operacoes` renomeada para `operator` migra a rota lembrada sem cair em placeholder.
7. Rodapé sem pill "MODO AUTÔNOMO" enquanto não houver estado real que o alimente (teste afirma ausência).
8. Rótulos i18n para cada item do mapa (inclusive os ocultos, para a fatia futura só registrar o módulo).
9. `dev`, `test`, `lint` verdes; relatório `SPEC-Shell-01` em `reports/TESTS.md`.

## Testes e evidência

Unitários do registro/projeção (Regras); testes de tela da sidebar (Tela) com registro injetado; E2E: abrir o app, entrar no JARVIS, alternar rail e confirmar exatamente os itens visíveis de hoje. Verificação visual do PI contra os mockups (mesma limitação de sessão Google dos E2E anteriores).

## Fora

- Menu do NOA (o protótipo `NOA.md §2` o trata como atalhos de view; sem sub-módulo).
- Conteúdo de qualquer tela oculta (Command Center, Mission Control, harness pages…) — são de seus MVPs.
- Command Palette / busca de rotas (PRD §11.3) — componente existe na 04a, integração ao registro fica para quando houver itens suficientes para procurar.

## Perguntas abertas ao PI

1. **Numeração e posição na fila.** MVP-019 é provisório (010–018 reservados pela Pipeline V2/V3). Onde entra: antes do MVP-009 fechar, ou depois?
2. **`Terminal` em SISTEMA** foi minha leitura da sua resposta "só em Settings" (Terminal não cabe como aba). Confirma o item, ou Terminal vira aba "Terminal" do Settings também?
3. **Rota inicial do JARVIS = Projects Hub** e do Agents OS = Operator Central (primeiro visível). Aceita, ou prefere fixar uma rota inicial explícita por sub-módulo (que hoje seria a mesma)?
4. **Coluna "MVP que entrega"** do mapa: é derivação minha do roadmap. Os "sem MVP" (Command Center, HUD, OS Desktop, Metas, Studio, SEO Content, Video Director) ficam no mapa como reserva de lugar, ou saem do mapa até existir MVP?
5. **Workflows/Automations**: o MVP-002 entregou registro sem tela. Vira fatia de UI própria (onde?) ou o item fica reservado sem dono?

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Registro de módulos, não lista na tela** — é a única forma de "item entra na fatia que entrega o módulo" não virar edição do AppShell a cada fatia.
- **`operacoes` → `operator`**: a fila de aprovação é governança (Operator Central do protótipo), não "Operações" (que no protótipo é Kanban/Workflows).
- **Identificadores de rota em inglês**, rótulos em pt-BR/nomes próprios do protótipo — código em inglês é regra do CLAUDE.md.

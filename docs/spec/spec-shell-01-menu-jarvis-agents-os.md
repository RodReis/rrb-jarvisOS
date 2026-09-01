# SPEC-Shell-01 — Menu do JARVIS OS e do Agents OS

- MVP/Fatia: MVP-022 · M22-F01 (`docs/mvp/mvp-022-shell-de-produto.md`).
- Issue: [#206](https://github.com/RodReis/rrb-jarvisOS/issues/206); épico [#205](https://github.com/RodReis/rrb-jarvisOS/issues/205).
- Status: **aprovada-pi** (2026-08-30) — as quatro perguntas estruturais foram respondidas pelo PI e estão resolvidas abaixo; nenhuma pergunta em aberto.
- Depende de: M3-F04a (AppShell, rail dual, `navegacao.ts`), M4-F03 / FIX #172 (Settings em abas). Entregues.
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
2. **Item sem módulo não existe no menu** (decisão 1 do MVP). Grupo sem item visível não é renderizado. Nenhuma rota leva ao cabeçalho de placeholder do AppShell — quando o último placeholder sair, o ramo `moduloDaRota === null` vira erro de programação, não estado de tela.
3. **HARNESSES é dinâmico** (decisão 2): um item por executor registrado no runtime de execução (hoje o adapter `claude-code` do MVP-005; `CodingExecutorRuntime` do MVP-010 quando existir). O item só aparece quando **existe a página de harness** que ele abre; até lá, o grupo inteiro fica oculto pela regra 2. Nomes, chips e cores por harness vêm do registro do executor, não de tabela fixa na UI.
4. **Um caminho por tela** (decisão 3): `Connectors`, `Providers` e `Permissões` **não** são itens; são abas do Settings. SISTEMA = `Terminal` + `Settings`.
5. **`Terminal` é item de SISTEMA** (decisão 5), embora o protótipo não o previsse: é ferramenta de operação, não configuração — enterrá-lo numa aba de Settings o esconderia de quem o usa para trabalhar.
6. **Rota inicial de cada sub-módulo = primeiro item visível do primeiro grupo visível** (já é o contrato de `rotaInicialDoSubModulo`). Não existe rota `inicio` própria; `Início` sai.
7. **Isolamento por espaço mantido:** a rota lembrada por workspace (SPEC-Fundacao-02) continua; rota que deixou de existir cai na rota inicial do sub-módulo, nunca em placeholder.
8. **Nada inventado:** pill "● MODO AUTÔNOMO" do rodapé, contadores de sessão e status por harness **só aparecem quando lidos de estado real do app** (o kill-switch de merge autônomo do MVP-009 é o primeiro candidato ao pill). Até lá, rodapé sem pill.
9. **O grupo "AGENTS OS" dentro do Professional Ops** (Mission Control · Specialties · Skills Catalog) é atalho para o sub-módulo `agents` — segue as regras 1–2 como qualquer item.
10. **Rótulos por i18n** (`navegacao.<id>`), como hoje. Identificadores de rota em inglês (`projects`, `operator`, `terminal`, `settings`), rótulos em pt-BR conforme o protótipo (`Projects Hub`, `Operator Central`, …) — o protótipo usa nomes próprios em inglês para as telas, de propósito.

## Mapa item ↔ módulo ↔ MVP (fonte única de encaixe)

Coluna *hoje* = o que fica visível ao entregar esta fatia. Coluna *MVP* = quem torna o item visível depois. Itens sem MVP permanecem no mapa como **reserva de lugar** (decisão 7): registram o que o protótipo previu, sem prometer data.

### Professional Ops (`command`)

| grupo | item (protótipo) | rota | módulo | hoje | MVP que entrega |
|---|---|---|---|---|---|
| COMANDO | Command Center | `command` | UI do Command Center | oculto | **MVP-017 F05** |
| COMANDO | HUD | `hud` | — | oculto | sem MVP (reserva) |
| AGENTS OS | Mission Control | `mission` (→ `agents`) | painel de runs | oculto | MVP-009 F06 |
| AGENTS OS | Specialties | `specialties` (→ `agents`) | — | oculto | MVP-011 |
| AGENTS OS | Skills Catalog | `skills` (→ `agents`) | — | oculto | MVP-011 F01 |
| OPERAÇÕES | Kanban | `kanban` | board do roadmap | oculto | MVP-013 |
| OPERAÇÕES | Workflows | `workflows` | registro de workflows (MVP-002 F04, sem tela) | oculto | fatia de UI sem dono |
| OPERAÇÕES | Automations | `automations` | idem | oculto | fatia de UI sem dono |
| OPERAÇÕES | OS Desktop | `osdesktop` | — | oculto | sem MVP (reserva) |
| INTEL | Analytics | `analytics` | — | oculto | MVP-015 |
| INTEL | Insights | `insights` | — | oculto | MVP-015 |
| NEGÓCIOS | Projects Hub | `projects` | `ProjetosLocais` (+ wizard, pacote, roadmap) | **visível** | MVP-008 (entregue) |
| NEGÓCIOS | Metas | `goals` | — | oculto | sem MVP (reserva) |
| NEGÓCIOS | Studio | `studio` | — | oculto | sem MVP (reserva) |
| NEGÓCIOS | SEO Content | `seo` | — | oculto | sem MVP (reserva) |
| NEGÓCIOS | Video Director | `video` | — | oculto | sem MVP (reserva) |
| SISTEMA | Services | `services` | — | oculto | MVP-015 |
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
| HARNESSES | *(dinâmico)* | `h_<executor>` | página de harness | oculto (sem página) | MVP-009 / MVP-010 |
| TEAMS | Specialist Teams | `teams` | — | oculto | MVP-011 |
| GOVERNANCE | Operator Central | `operator` | `AprovacoesPendentes` (fila de aprovação, hoje rota `operacoes`) | **visível** | MVP-002/004 (entregue) |
| KNOWLEDGE | Agent Memory | `memory` | — | oculto | MVP-007 F07 |
| KNOWLEDGE | Notebook | `notebook` | — | oculto | MVP-007 F07 |

**Resultado ao entregar:** Professional Ops = NEGÓCIOS › Projects Hub · SISTEMA › Terminal, Settings. Agents OS = GOVERNANCE › Operator Central. Rota inicial: `projects` e `operator`. É pouco — e é **verdade**.

**Como cresce:** a fatia que entrega a tela registra o módulo, e o item aparece sozinho. A M9-F06 acende Mission Control; a M17-F05 acende o Command Center e, com ele, a rota inicial do JARVIS passa a ser a tela que dá identidade ao produto — **sem tocar nesta fatia**. É por isso que o menu é registro, não lista.

## Critérios de aceite

1. A sidebar não contém lista literal de itens: teste registra um módulo falso e ele aparece no grupo/ordem declarados sem alteração no AppShell; remove e some.
2. Nenhuma rota visível cai no placeholder: teste percorre todos os itens visíveis e afirma `moduloDaRota !== null`.
3. Grupo sem item visível não é renderizado (teste com o registro de hoje: só NEGÓCIOS, SISTEMA e GOVERNANCE aparecem).
4. HARNESSES reflete o registro de executores: com executor sem página, o grupo não aparece; com executor e página registrados, um item por executor, nome/cor vindos do registro. Contrafactual: tabela fixa de seis harnesses reprova.
5. `Connectors`/`Providers`/`Permissões` não são itens; o Settings continua alcançável em um clique nos dois sub-módulos.
6. Rail dual e isolamento por espaço preservados: `navegacao.spec.ts` e `shell-navegacao.test.tsx` continuam verdes; a rota `operacoes` renomeada para `operator` migra a rota lembrada sem cair em placeholder.
7. Rodapé sem pill "MODO AUTÔNOMO" enquanto não houver estado real que o alimente (teste afirma ausência).
8. Rótulos i18n para cada item do mapa — **inclusive os ocultos**, para a fatia futura só precisar registrar o módulo.
9. `dev`, `test`, `lint` verdes; relatório `SPEC-Shell-01` em `reports/TESTS.md`.

## Testes e evidência

Unitários do registro/projeção (Regras); testes de tela da sidebar (Tela) com registro injetado; E2E: abrir o app, entrar no JARVIS, alternar o rail e confirmar exatamente os itens visíveis de hoje. Verificação visual do PI contra os mockups (mesma limitação de sessão Google dos E2E anteriores).

## Fora

- Menu do NOA (o protótipo `NOA.md §2` o trata como atalhos de view; sem sub-módulo).
- Conteúdo de qualquer tela oculta (Command Center, Mission Control, harness pages…) — são de seus MVPs.
- Command Palette / busca de rotas (PRD §11.3): o componente existe na 04a; ligá-lo ao registro espera haver itens suficientes para procurar.

## Perguntas resolvidas pelo PI (2026-08-30)

1. **Command Center sem MVP.** Resposta: **MVP próprio** — e ele **já existe**: MVP-017, com a `M17-F05 UI do Command Center` prevista. Nenhum MVP novo foi criado; o mapa aponta para a M17-F05, e o item acende quando aquela fatia registrar o módulo. — decidido.
2. **Numeração e fila.** MVP renumerado de 019 para **022** (017–021 são a série do Command Center, já na `main`; 010–016 seguem reservados pela Pipeline V2/V3). Entra **depois do MVP-009 fechar**, para nascer já com Mission Control visível. — decidido.
3. **`Terminal`.** **Item de SISTEMA**, não sexta aba do Settings. — decidido.
4. **Itens sem MVP.** **Ficam no mapa como reserva de lugar**, ocultos no app. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Registro de módulos, não lista na tela** — é a única forma de "item entra na fatia que entrega o módulo" não virar edição do AppShell a cada fatia.
- **`operacoes` → `operator`**: a fila de aprovação é governança (Operator Central do protótipo), não "Operações" (que no protótipo é Kanban/Workflows).
- **Rota inicial = primeiro item visível** de cada sub-módulo, em vez de rota fixa: rota fixa apontaria para tela que pode não existir ainda, que é o problema que esta fatia resolve.
- **Workflows/Automations ficam no mapa sem dono**, ocultos, até existir fatia de UI: o MVP-002 F04 entregou registro sem tela, e inventar o dono aqui seria escolher escopo pelo PI.
- **Identificadores de rota em inglês**, rótulos em pt-BR/nomes próprios do protótipo — código em inglês é regra do CLAUDE.md.

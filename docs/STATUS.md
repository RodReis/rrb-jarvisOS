# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-07-24**. Mantido pelo Code a cada entrega (junto com `DEVELOPMENT.md`). Este arquivo espelha o board das GitHub Issues (`proplan:*`) — se divergirem, as **Issues vencem** e este arquivo deve ser corrigido.

## Board

### Backlog (`proplan:backlog` — spec `aprovada-pi`, aguardando fila)

| Issue | Fatia | MVP | Spec | Índice |
|---|---|---|---|---|
| [#34](https://github.com/RodReis/rrb-jarvisOS/issues/34) | — (`[INFRA]`) | — | *(sem spec — infra)* | — |
| [#41](https://github.com/RodReis/rrb-jarvisOS/issues/41) | — (`[FIX]`) | MVP-001 | *(sem spec — bug documentado)* | — |

> **`proplan:next` = [#34](https://github.com/RodReis/rrb-jarvisOS/issues/34)** (`[INFRA]` — separar o E2E em job de CI próprio).

> ✅ **MVP-003 aceito pelo PI em 2026-07-23.** As 8 fatias (#17–#24) estão `closed` + `proplan:finalizado` e o épico **[#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) foi fechado**. Os três `[FIX]` que nasceram durante o corte (#43, #47, #52) seguem em `proplan:done`, aguardando aceite à parte.

> Card **[#58](https://github.com/RodReis/rrb-jarvisOS/issues/58)** (`[FIX]`, 2026-07-24): **o Tailwind não varria `src/design/`** — o v4 detecta os arquivos a partir da pasta do CSS de entrada (`src/renderer/`), e sem `@source` o design system inteiro ficava fora do scanning. Toda classe usada **só** por um componente do DS nunca entrou no bundle: `text-[var(--jos-cor-texto)]` (37 usos em 20 arquivos), `disabled:opacity-45`, `mix-blend-screen`, os anéis do `VoiceMascot`. Efeito visível: o `Button` secundário caía no `button { color: inherit }` do reset e herdava a cor do `body` — **texto quase preto sobre superfície escura**. CSS compilado 22,9 KB → 56,8 KB depois da correção. Achado ao portar o login (#57), na captura do app real; confirmado por CDP (`CSS.getMatchedStylesForNode`). Os 562 testes passavam porque **jsdom não aplica folha de estilo**. Corrigido junto com #57 porque a tela não fica correta sem ele. **Mergeado em 2026-07-24** (PR [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59)), aguardando aceite.

> Card **[#57](https://github.com/RodReis/rrb-jarvisOS/issues/57)** (`[FIX]`, 2026-07-24): **a tela de login não seguia o protótipo** — era o placeholder de 66 linhas da F03 (um botão `sky-600` num card cinza), escrito quando ainda não havia design system e declarando isso no próprio cabeçalho. O MVP-003 fechou e a dívida venceu: o protótipo tem o markup completo da tela, o mockup canônico está em `screens/01-login.png`, `SUPERFICIES_DE_MARCA` já previa `'login'` e o `Button` documenta `larguraTotal` como *"o 'ACESSAR' do login"*. O DS foi construído para esta tela e nunca foi aplicado nela. Portada fiel: fundo carbono com Ken Burns, véu radial, sheen, dots, card glass 340px, `VoiceMascot`, rodapé institucional. **Google segue como única entrada** — o mockup mostra usuário/senha e GitHub, que o backend não tem (decisão do PI: fatia nova, com spec própria). **Mergeado em 2026-07-24** (PR [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59)), aguardando aceite.

> Card **[#52](https://github.com/RodReis/rrb-jarvisOS/issues/52)** (`[FIX]`, 2026-07-23): **o `Meter` escondia o rótulo em `aria-label`** — acessível a quem usa leitor de tela, invisível para quem enxerga. Achado ao **revisar a captura do JARVIS HUD para o aceite**: quatro barras de telemetria com números à direita e nenhuma forma de saber qual era CPU, RAM, GPU ou DISK. É o inverso do critério 5 (F06): informação essencial ausente da tela. Corrigido no componente (prop `rotuloVisivel`), não no uso. **Mergeado** (PR [#53](https://github.com/RodReis/rrb-jarvisOS/pull/53)), aguardando aceite.

> Card **[#47](https://github.com/RodReis/rrb-jarvisOS/issues/47)** (`[FIX]`, 2026-07-23): **`navegacao.spec.ts` nunca rodou** — o `include` da categoria Regras não alcançava `src/renderer`, e 75 linhas cobrindo o isolamento de rota por espaço (SPEC-Fundacao-02, critérios 1 e 5) ficaram fora de toda categoria desde o PR #28. Achado de raspão durante a F04a: o teste novo do rail dual não rodava, e os antigos também não. Corrigido em branch próprio, **sem misturar na fatia**. **Mergeado** (PR [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48)), aguardando aceite. Regras 203 → 212.

> Card **[#34](https://github.com/RodReis/rrb-jarvisOS/issues/34)** (`[INFRA]`, Backlog): separar o E2E em job de CI próprio, condicional por paths. Criado pelo Code durante a F03 — o cache do Electron (parte fácil) já saiu no PR #35; a separação do E2E do relatório é infra maior e vai em PR dedicado.

> Card **[#43](https://github.com/RodReis/rrb-jarvisOS/issues/43)** (`[FIX]`, 2026-07-23): **o app nunca lia o arquivo `.env`** — `dotenv` não existia no repo e `readSupabaseConfig()` consulta `process.env` cru. O login da SPEC-Fundacao-03 só funcionava com as variáveis exportadas no shell; a partir do repo, dava "credenciais ausentes" com o arquivo preenchido. Achado ao subir o app durante a F03b; corrigido em branch próprio (`fix/carregar-env-no-main`), **sem misturar na fatia**. Provado no app real com o shell limpo: login concluído, tokens cifrados no cofre, sessão de 30 dias. **Mergeado** (PR [#44](https://github.com/RodReis/rrb-jarvisOS/pull/44)), aguardando aceite. Detalhe no `DEVELOPMENT.md` § Fatia 03.

> ⚠️ **O merge do #44 fechou a issue #43 sozinho** — reaberta e carimbada `proplan:done` à mão. Causa: o squash concatena as mensagens do PR, e um commit se chamava `docs: registra o FIX #43 (...)`; o GitHub leu `FIX #43` como palavra-chave. Todos os commits usavam só `refs #43`. Regra registrada no `CONVENTION.md` §1.

> A Fatia 06 saiu como **#8** (o número 7 já estava ocupado). Sub-issue do épico #1; assignee PI.

### Feito (`proplan:done` — entregue, aguardando aceite do PI)

| Issue | Fatia | MVP | Spec | Índice | PR | Mergeado |
|---|---|---|---|---|---|---|
| [#43](https://github.com/RodReis/rrb-jarvisOS/issues/43) | — (`[FIX]`) | MVP-001 | *(sem spec — fonte: `.env.example` §1-8)* | — | [#44](https://github.com/RodReis/rrb-jarvisOS/pull/44) | 2026-07-23 |
| [#47](https://github.com/RodReis/rrb-jarvisOS/issues/47) | — (`[FIX]`) | MVP-001 | *(sem spec — fonte: `TESTING.md` §2/§3, ADR-003)* | — | [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48) | 2026-07-23 |
| [#52](https://github.com/RodReis/rrb-jarvisOS/issues/52) | — (`[FIX]`) | MVP-003 | *(sem spec — fonte: SPEC-DS-03b crit. 4, SPEC-DS-06 crit. 5)* | — | [#53](https://github.com/RodReis/rrb-jarvisOS/pull/53) | 2026-07-23 |
| [#57](https://github.com/RodReis/rrb-jarvisOS/issues/57) | — (`[FIX]`) | MVP-001 | *(sem spec — fonte: protótipo `Login`, `01-login.png`, README §2.6)* | — | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#58](https://github.com/RodReis/rrb-jarvisOS/issues/58) | — (`[FIX]`) | MVP-003 | *(sem spec — fonte: `src/design/README.md` § Base técnica)* | — | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |

> **04 e 02 saíram no mesmo PR**, por decisão do PI (2026-07-22): o critério 4 da SPEC-04 exige `AuditEvent` de `workspace-switch`, cujo fluxo nasce na F02 — separá-las exigiria um stub que a F02 jogaria fora. O critério 4 fica **parcialmente atendido**: `workspace-switch` está provado ponta a ponta; `login`/`logout`/`login-offline-reuse` têm o tipo no contrato e o fluxo nasce na F03.

### Finalizado (`closed` + `proplan:finalizado` — aceito pelo PI)

| Issue | Fatia | MVP | Spec | Índice | PR | Aceite |
|---|---|---|---|---|---|---|
| [#2](https://github.com/RodReis/rrb-jarvisOS/issues/2) | 01 Bootstrap e estrutura | MVP-001 (#1) | `spec-fundacao-01-bootstrap.md` | F01 | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) | 2026-07-22 |
| [#8](https://github.com/RodReis/rrb-jarvisOS/issues/8) | 06 Observabilidade e Logging | MVP-001 (#1) | `spec-fundacao-06-observabilidade-logging.md` | F06 | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) | 2026-07-22 |
| [#5](https://github.com/RodReis/rrb-jarvisOS/issues/5) | 04 Dados mínimos + AuditEvent | MVP-001 (#1) | `spec-fundacao-04-dados-audit.md` | F04 | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | 2026-07-22 |
| [#3](https://github.com/RodReis/rrb-jarvisOS/issues/3) | 02 AppShell e WorkspaceSwitcher | MVP-001 (#1) | `spec-fundacao-02-appshell-workspaces.md` | F02 | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | 2026-07-22 |
| [#6](https://github.com/RodReis/rrb-jarvisOS/issues/6) | 05 Settings mínimo | MVP-001 (#1) | `spec-fundacao-05-settings.md` | F05 | [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) | 2026-07-22 |
| [#4](https://github.com/RodReis/rrb-jarvisOS/issues/4) | 03 Auth Google local-first | MVP-001 (#1) | `spec-fundacao-03-auth-google.md` | F03 | [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) | 2026-07-22 |
| [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) | 01 Supabase local + ambiente de sync | MVP-002 (#9) | `spec-execucao-local-01-supabase-local.md` | M2-F01 | [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) | 2026-07-22 |
| [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) | 02 Policy Engine mínimo (classificação) | MVP-002 (#9) | `spec-execucao-local-02-policy-engine.md` | M2-F02 | [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) | 2026-07-22 |
| [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) | 03 Diretórios permitidos (allowlist) | MVP-002 (#9) | `spec-execucao-local-03-allowlist-diretorios.md` | M2-F03 | [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) | 2026-07-22 |
| [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) | 04 Registro de workflows + automações | MVP-002 (#9) | `spec-execucao-local-04-registro-workflows.md` | M2-F04 | [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36) | 2026-07-22 |
| [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) | 05 Motor de execução simulado | MVP-002 (#9) | `spec-execucao-local-05-execucao-simulada.md` | M2-F05 | [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37) | 2026-07-23 |
| [#17](https://github.com/RodReis/rrb-jarvisOS/issues/17) | 01 Infra do design system | MVP-003 (#16) | `spec-design-system-01-infra.md` | M3-F01 | [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38) | 2026-07-23 |
| [#18](https://github.com/RodReis/rrb-jarvisOS/issues/18) | 02 Foundations + ponte com o protótipo | MVP-003 (#16) | `spec-design-system-02-foundations.md` | M3-F02 | [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40) | 2026-07-23 |
| [#19](https://github.com/RodReis/rrb-jarvisOS/issues/19) | 03a Componentes: ações + formulários | MVP-003 (#16) | `spec-design-system-03a-componentes-acoes-forms.md` | M3-F03a | [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42) | 2026-07-23 |
| [#20](https://github.com/RodReis/rrb-jarvisOS/issues/20) | 03b Componentes: dados + overlays + feedback | MVP-003 (#16) | `spec-design-system-03b-componentes-dados-overlays.md` | M3-F03b | [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45) | 2026-07-23 |
| [#23](https://github.com/RodReis/rrb-jarvisOS/issues/23) | 05 Identidades NOA e JARVIS | MVP-003 (#16) | `spec-design-system-05-identidades.md` | M3-F05 | [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46) | 2026-07-23 |
| [#21](https://github.com/RodReis/rrb-jarvisOS/issues/21) | 04a AppShell + navegação | MVP-003 (#16) | `spec-design-system-04a-appshell-navegacao.md` | M3-F04a | [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49) | 2026-07-23 |
| [#22](https://github.com/RodReis/rrb-jarvisOS/issues/22) | 04b Padrões operacionais | MVP-003 (#16) | `spec-design-system-04b-padroes-operacionais.md` | M3-F04b | [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) | 2026-07-23 |
| [#24](https://github.com/RodReis/rrb-jarvisOS/issues/24) | 06 Adoção & hardening | MVP-003 (#16) | `spec-design-system-06-adocao-hardening.md` | M3-F06 | [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51) | 2026-07-23 |

### A Fazer · Em Andamento

*(vazios)*

### MVP-003 Design System — 8 fatias (todas `aprovada-pi`, assignee PI)

Épico: **[#16](https://github.com/RodReis/rrb-jarvisOS/issues/16)**. Criadas e vinculadas em 2026-07-21. Ordem: F01 → F02 → (F03a, F03b, F05 ‖) → F04a → F04b → F06. Iniciado em 2026-07-23.

| Issue | Fatia | Índice | Spec | Coluna |
|---|---|---|---|---|

> Base técnica (Fatia 01): **Radix + Tailwind v4 + Lucide**. Specs `03`/`04` originais viraram stubs *superseded* (divididas em a/b).

### Índice Fatia ↔ SPEC (fonte única do par MVP↔SPEC↔Fatia)

Não há catálogo numérico `SPEC-nnn` para o MVP-001: as specs são identificadas por slug (`SPEC-Fundacao-01..06`) e mapeiam 1:1 para a fatia (F01↔spec-01, …, F06↔spec-06). Por isso os títulos das issues usam `[MVP1][Fnn]` sem token `[SPEC-nnn]` (regra de ouro: não inventar número). **Pendência ao PI:** decidir se o projeto adota numeração `SPEC-nnn` — se sim, atribuir os números aqui e ajustar os títulos.

## MVPs

| MVP | Issue | Estado | Fatias fechadas |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | **fechado** — épico aceito pelo PI em 2026-07-22; todas as 6 filhas `proplan:finalizado` (#2, #3, #4, #5, #6, #8) | **6 / 6** |
| MVP-002 Execução local controlada (fundação) | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | **fechado** — épico aceito pelo PI em 2026-07-23; todas as 5 filhas `proplan:finalizado` (#15, #11, #12, #13, #14) | **5 / 5** |
| MVP-003 Design System da Plataforma (base única, 2 identidades) | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | **fechado** — épico aceito pelo PI em 2026-07-23; todas as 8 filhas `proplan:finalizado` (#17–#24) | **8 / 8** |
| MVP-004 Execução real (terminal + execução allowlisted) | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | renumerado de MVP-003 (título/rótulo atualizados + carimbo); 2 fatias lazy | 0 / 2 |
| MVP-providers (Corte 3) | — | planejado; incluirá **BudgetPolicy** (modelo decidido no ADR-001 #1) + providers/conectores/RAG | — |

> **Redefinição do MVP-003 (2026-07-21).** Por decisão do PI, o slot MVP-003 passou a ser o **Design System da Plataforma**; a "Execução real" foi renumerada para **MVP-004** (`docs/mvp/mvp-004-execucao-real.md`; o antigo `mvp-003-execucao-real.md` é um stub superseded). Decisões que moldam o novo MVP-003: (1) redefinir o slot; (2) conciliar protótipo `docs/design/design-system/` (referência visual) com a direção do PRD (implementação tipada, claro/escuro, WCAG 2.2); (3) base única, 2 identidades; (4) peso **leve solo+IA** — sem Storybook/Playwright/governança de 9 passos (mantém a suspensão do LANDSCAPE); (5) especificar agora, **executar depois de MVP-001/002**.

## Próximas ações

1. **MVP-001 entregue por inteiro** (2026-07-22): **6 das 6 fatias** — F01 (#2), F06 (#8), F04 (#5), F02 (#3), F05 (#6) e F03 (#4). Ordem executada: **01 → 06 → 04+02 → 05 → 03**. A F03 destravou quando o PI criou as credenciais e saiu no mesmo dia. O `proplan:next` avançou para o **MVP-002** (#9), começando pela F01 (#15), que é independente das demais.
2. ~~Resolver as "Perguntas ao PI" das specs do MVP-003~~ — **feito** (2026-07-21): as 8 specs estão `aprovada-pi`.
3. ~~Renumerar #10 → MVP-004 e criar o épico MVP-003 + issues~~ — **feito** (2026-07-21): #10 retitulada MVP-004 (carimbo), épico **#16** criado, 8 filhas **#17–#24** em Backlog e vinculadas.
4. ~~**Code**: iniciar o MVP-003 pela F01 (#17)~~ — **feito** (2026-07-23): F01 no PR [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38) e **F02 no PR [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40)**, ambas no mesmo dia. Segue com WIP = 1, na ordem (F03a/F03b/F05) → F04a → F04b → F06. **F03a (#19)** no PR [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42) e **F03b (#20)** no PR [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45), **F05 (#23)** no PR [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46) **F04a (#21)** no PR [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49) **F04b (#22)** no PR [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) e **F06 (#24)** no PR [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51). **MVP-003 entregue por inteiro** — 8 fatias em um dia. A partir daqui as fatias são de UI: por decisão do PI (2026-07-23), a skill **impeccable** entra para construir, verificar e polir — sem substituir o piso de `dev`/`test`/`lint` verdes.
5. ~~**PI — desbloqueia a F03 (#4)**~~ — **feito** (2026-07-22): projeto Supabase de dev criado, cliente OAuth do Google Cloud registrado e `.env` preenchido. A fatia foi entregue no mesmo dia ([#30](https://github.com/RodReis/rrb-jarvisOS/pull/30)). *Nota:* o `GOOGLE_OAUTH_CLIENT_SECRET` do `.env` **não é consumido pelo app** — no desenho do ADR-002 quem fala com o Google é o Supabase, e o secret vive no painel dele. Decisão do PI: manter a variável sem uso.
6. ~~**Code**: MVP-002 F01–F05~~ — **MVP-002 entregue por inteiro** (2026-07-22): F01 [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32), F02 [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33), F03 [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35), F04 [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36), F05 [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37). A F05 fecha o corte: o motor percorre um workflow classificando (F02) e checando allowlist (F03) **sem tocar recurso real** — invariante provado pelo efeito (arquivo não criado, diretório idêntico).
9. ~~**PI**: decidir a próxima frente~~ — **decidido** (2026-07-23): **MVP-003 Design System** (#16). O card `[INFRA]` **#34** (separar o E2E em job próprio) segue em Backlog e independe do MVP.
10. ~~**PI**: aceitar as fatias entregues do MVP-003~~ — **feito** (2026-07-23): **as 8 fatias aceitas** (`proplan:finalizado`) e o épico **[#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) fechado**. O corte inteiro — F01 a F06 — saiu em um dia. Segue em aberto o aceite dos três `[FIX]` que nasceram durante ele: **#43** (o app nunca lia o `.env`), **#47** (`navegacao.spec.ts` nunca rodou) e **#52** (o `Meter` escondia o rótulo), todos em `proplan:done`.
11. **PI — decidir a próxima frente**: o card `[INFRA]` **#34** (separar o E2E em job de CI próprio, hoje o `next`), o `[FIX]` **#41** (renderer sobe em porta variável, contra o `strictPort` do CLAUDE.md) ou o **MVP-004** ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10), execução real + terminal).
12. **Cowork — spec de login por senha + GitHub** (decisão do PI, 2026-07-24). O mockup `01-login.png` mostra usuário/senha, GitHub e "cadastre-se com"; o backend só tem Google OAuth, e o **#57 entregou a tela sem esses controles** justamente para a UI não prometer o que o sistema não faz. Virar fatia exige a spec resolver, com o PI: política de senha; quem pode se cadastrar (aberto? convite? domínio restrito? — um app local-first com workspace por usuário não tem cadastro aberto óbvio); recuperação de senha (**depende de e-mail transacional, que não existe** — o CLAUDE.md mantém o ambiente 100% local até o fim do MVP); vinculação de contas com o mesmo e-mail via Google e GitHub; verificação de e-mail. **Não é `[FIX]`** — há decisão de produto em cada linha, e reclassificar para escapar da spec é exatamente o que o CLAUDE.md § *"Fatia exige spec"* impede.
13. ~~**PI — decidir sobre o `VoiceMascot`**~~ — **dispensado** (2026-07-24, PR [#61](https://github.com/RodReis/rrb-jarvisOS/pull/61)): a medida de 112px do protótipo saiu por **enquadramento na tela**, não por prop nova no DS. O protótipo monta o emblema em três camadas irmãs (anel de 112px, glow, tile de 94px) e o `VoiceMascot` é peça única com `overflow-hidden` — a moldura passou a morar na `TelaLogin` e o componente do DS ficou intocado. Não há mais decisão a tomar aqui.
14. **PI — decidir sobre a tela CHOICE**: perguntas levantadas em **`docs/kickoff-choice-selecao-de-espaco.md`** (2026-07-24, a pedido do PI). A CHOICE existe no protótipo (`LOGIN → CHOICE → NOA|JARVIS`) e como prova visual do DS (`src/design/prova/jornada/Choice.tsx`), mas **não está no app** — o `App.tsx` vai do login direto ao shell. A questão de fundo é um **conflito entre fontes**, não uma lacuna: o protótipo manda ir para a CHOICE depois do login, enquanto a **pergunta 1 da SPEC-Fundacao-02, resolvida pelo PI em 2026-07-21**, decidiu *"workspace ativo ao abrir: sempre JARVIS OS, ignora último estado"*. A regra de precedência do protótipo cobre **PRD × protótipo**, não protótipo × decisão explícita do PI em spec aprovada — por isso volta para a mesa. Sete perguntas no documento; a Q1 é bloqueante e as demais caem se a resposta for "não entra".
7. **PI**: (opcional) decidir a adoção de numeração `SPEC-nnn`.
8. ~~**PI**: aceitar as fatias do MVP-001 e fechar o épico #1~~ — **feito** (2026-07-22): as 6 filhas aceitas (`proplan:finalizado`) e o épico **#1 fechado**. **#15** (MVP-002 · F01) também aceita. **MVP-002 aceito por inteiro** (2026-07-22/23): as 5 filhas `proplan:finalizado` e o épico **#9 fechado**. Dos MVPs 001/002, **nada pendente** — o aceite em aberto agora é a **F01 do MVP-003** (#17), item 10 abaixo.

## Roadmap macro

MVP-001 Fundação ✅ → Execução local controlada ✅ → Design System ✅ → **Execução real (terminal)** → Integrações reais → Voz e automação → Offline/multiplataforma. Detalhe em `docs/LANDSCAPE.md`.

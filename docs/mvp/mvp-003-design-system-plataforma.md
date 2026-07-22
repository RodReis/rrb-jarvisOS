# MVP-003 — Design System da Plataforma (base única, 2 identidades)

- Tipo: épico (`proplan:mvp`). Container de fatias — **sem spec própria**.
- Status: **definido** (2026-07-21) — redefinição do slot MVP-003 aprovada pelo PI. O antigo MVP-003 "Execução real (terminal + allowlisted)" foi **renumerado para MVP-004** (`docs/mvp/mvp-004-execucao-real.md`).
- Base: `docs/design/design-system/` (README + NOA.md + JARVISOS.md — protótipo), `docs/iniciais/prd-design-system-plataforma.md` (PRD, **parcialmente superado** — ver LANDSCAPE §Estado dos documentos de origem), ADR-001 (local-first), ADR-004 (auditoria), ADR-005 (logging).
- Depende de: **MVP-001 entregue** (shell, AppShell/WorkspaceSwitcher, Settings, dados/AuditEvent, logging). O design system **re-plataforma** o shell placeholder da SPEC-Fundacao-02 sobre tokens e componentes. Sem a fundação, não há shell nem preferências onde ancorar tema/densidade/acento.
- Dono do aceite: PI. Só fecha quando todas as fatias-filhas fecharem.

> **Decisões do PI que moldam este épico (2026-07-21):**
> 1. **Redefinir o MVP-003** para o Design System; execução real vira MVP-004.
> 2. **Fidelidade ao protótipo, conciliada com a direção do PRD:** o protótipo `docs/design/JARVIS Platform (offline).html` (documentado em `design-system/README.md` + `NOA.md` + `JARVISOS.md`) é a **referência de registro** da aparência e do comportamento — telas, estética, cores semânticas, acento, mascote, Toast e o **modo claro/escuro das telas internas** (README §2.6, default escuro, toggle na topbar; login/choice/toast sempre escuros). O PRD governa **só a forma de implementar** (React + TypeScript tipado, tokens em CSS variables, WCAG 2.2 AA). **Onde protótipo e PRD divergirem sobre a UX realizada, o protótipo vence** — o modelo inline/DC do protótipo é o único que se abandona (vira tokens + componentes tipados).
> 3. **Base única, 2 identidades:** um único design system compartilhado; NOA e JARVIS OS entram como **deltas de identidade** sobre a mesma base — **não** dois design systems (PRD §5.2: "Não criar um design system separado para NOA").
> 4. **Peso leve (solo + IA):** mantém a suspensão do LANDSCAPE — **sem Storybook obrigatório, sem baseline visual Playwright, sem governança de 9 passos**. Documentação executável e regressão visual ficam **fora** do MVP. **Base técnica adotada (Fatia 01):** Radix Primitives + Tailwind CSS v4 + Lucide React.
> 5. **Respeitar a ordem:** este épico é **especificado agora**, mas só **executa depois de MVP-001/002 entregues**. As fatia-specs nascem `rascunho` e só viram issue quando `aprovada-pi`.

## Tese

Dar à Plataforma uma **linguagem visual e comportamental única**, tipada e acessível, para que NOA e JARVIS OS componham telas sem recriar tokens, estados e padrões. O protótipo prova a estética-alvo (carbono, acento configurável, Toast, mascote); este MVP transforma essa estética em **tokens + componentes React + padrões operacionais** reutilizáveis — no peso certo para um time solo+IA, sem a máquina pesada de governança que o LANDSCAPE suspendeu.

Fronteira dura (herdada do PRD §5.2 e reforçada pelo ADR): o design system **não** conhece domínio nem infraestrutura. Componentes recebem dados, estado e callbacks por props tipadas; **não** acessam Supabase, Electron Main, filesystem, providers ou secrets. Telas completas de produto ficam **fora** — são consumidoras, não parte do DS.

## Checklist de fatias previstas

**8 fatias** (03 e 04 divididas em a/b — decisão do PI 2026-07-21). Todas com spec **`aprovada-pi`** — prontas para virar issue-filha quando o épico existir no board:

- [ ] **Fatia 01 — Infra do design system:** `src/design/{tokens,ui,patterns}` sobre **Radix + Tailwind v4 + Lucide**, regra ESLint de fronteira (DS não importa domínio/infra), Vitest + Testing Library. Spec: `spec-design-system-01-infra.md`.
- [ ] **Fatia 02 — Foundations + ponte com o protótipo:** tema carbono, **modo claro/escuro interno** fiel ao protótipo (`uiTheme`, README §2.6), tokens-base/semânticos, **acento por paleta fixa** (ajuste de tom só para leitura), tipografia (Michroma/Rajdhani/Share Tech Mono), movimento. Spec: `spec-design-system-02-foundations.md`.
- [ ] **Fatia 03a — Componentes: ações + formulários.** Spec: `spec-design-system-03a-componentes-acoes-forms.md`.
- [ ] **Fatia 03b — Componentes: dados + overlays + feedback** (inclui **Toast + NotificationCenter**, fiel ao protótipo). Spec: `spec-design-system-03b-componentes-dados-overlays.md`.
- [ ] **Fatia 04a — AppShell + navegação:** shell sobre o DS (re-plataforma a SPEC-Fundacao-02), toggle `uiTheme` no TopBar, rail dual do JARVIS. Spec: `spec-design-system-04a-appshell-navegacao.md`.
- [ ] **Fatia 04b — Padrões operacionais:** status, risco/aprovação, execução/custo, logs/diagnóstico, providers/BYOK, notificações — UI por props, sem domínio. Spec: `spec-design-system-04b-padroes-operacionais.md`.
- [ ] **Fatia 05 — Identidades NOA e JARVIS:** os dois módulos como **deltas** sobre a base (tokens de identidade, tom, mascote, acento default, par claro/escuro), sem duplicar componentes. Spec: `spec-design-system-05-identidades.md`.
- [ ] **Fatia 06 — Adoção & hardening:** jornada de prova **CHOICE + NOA (Hoje) + JARVIS (HUD)** só com componentes públicos; remoção de estilos locais; a11y por teclado (Testing Library). Spec: `spec-design-system-06-adocao-hardening.md`.

## Ordem e dependências

MVP-001 entregue → 01 (infra) → 02 (foundations) → **03a e 03b** (componentes, paralelizáveis entre si) e **05** (identidades, consome 02, paralelo) → **04a** (shell, re-plataforma SPEC-Fundacao-02, consome 03) → **04b** (padrões, consome 03b e 04a) → 06 (adoção, consome 03/04/05). Após a 02, 03a/03b/05 podem andar em paralelo.

## Fora deste MVP

- **Telas completas de produto** (Command Center com voz real, Mission Control, Kanban, as 7 telas do NOA etc.) — são **consumidoras** do DS, entram nos MVPs de produto (Corte 3+).
- **Storybook, regressão visual Playwright, governança de contribuição de 9 passos, versionamento semântico de pacotes publicados** — suspensos (decisão do PI §4; LANDSCAPE).
- **Voz/áudio real** (TTS/STT online) — Corte 4. O mascote reativo entra apenas como **componente visual** (sem motor de voz) na Fatia 05.
- **Enforcement de política, execução real, terminal** — MVP-004. Os padrões de risco/aprovação da Fatia 04 são **UI** (recebem estado por props); a decisão continua no Policy Engine (MVP-002/004).
- **Persistência das preferências** (tema/densidade/acento) — o **modelo** é do Settings (SPEC-Fundacao-05) e dos dados (SPEC-Fundacao-04); o DS apenas **lê e aplica** via props/contrato.

## Critérios de done do MVP

- Uma tela real do JARVIS OS é composta **exclusivamente** com tokens e componentes públicos do DS, em claro e escuro, sem novos tokens paralelos (métrica do PRD §23).
- Troca de tema, densidade e acento ocorre **sem reload** e sem quebrar contraste (acento inválido é ajustado/rejeitado com explicação).
- Nenhum pacote/módulo do DS importa domínio (JARVIS/NOA), Supabase ou Electron Main; padrões recebem dados por contratos tipados (verificável por teste/lint de fronteira).
- Componentes interativos operáveis por teclado, foco visível, nome/papel/estado corretos (Testing Library); estados nunca comunicados só por cor.
- NOA e JARVIS renderizam como **duas identidades sobre a mesma base**, sem componente duplicado.
- `npm run dev`, `npm run test`, `npm run lint` passam; evidência no `reports/TESTS.md`.

## Board (executado 2026-07-21, autorizado pelo PI)

- Épico deste MVP: **[#16](https://github.com/RodReis/rrb-jarvisOS/issues/16)** (`proplan:mvp`).
- 8 fatias-filhas em Backlog e vinculadas ao #16: **#17** (F01), **#18** (F02), **#19** (F03a), **#20** (F03b), **#21** (F04a), **#22** (F04b), **#23** (F05), **#24** (F06) — todas `proplan:backlog`, assignee PI.
- Execução real renumerada MVP-003 → **MVP-004** na issue **[#10](https://github.com/RodReis/rrb-jarvisOS/issues/10)** (título/rótulo atualizados + comentário de carimbo). O número da issue é imutável; muda o rótulo MVP.

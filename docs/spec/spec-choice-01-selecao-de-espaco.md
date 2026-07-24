# SPEC-CHOICE-01 — Tela CHOICE (seleção de espaço + acento)

- MVP: **container em aberto** — o PI decidiu (2026-07-24) que a CHOICE vem **antes do MVP-004** e que o vínculo de épico fica para depois. Ver *Nota de vínculo*.
- Status: **rascunho — todos os residuais resolvidos pelo PI (2026-07-24); aguardando o Cowork marcar `aprovada-pi`.** O Code registrou as respostas, mas não muda o status: o documento é do Cowork, e é ele quem faz a emenda à SPEC-Fundacao-02 e cria a issue-fatia.
- Autor: Claude Cowork (2026-07-24), a partir do kickoff do Code.
- Origem: `docs/kickoff-choice-selecao-de-espaco.md` (Code, 2026-07-24) + captura da CHOICE enviada pelo PI durante o ajuste do login (#57).
- Dependências: Fatias 02 (AppShell/WorkspaceSwitcher), 04 (UserProfile), 05 (Settings) entregues; MVP-003 (design system, inclui `AccentSwatchSelector`, identidades, superfícies de marca) entregue.

> **Esta spec revoga parte de comportamento já entregue e aceito (SPEC-Fundacao-02).** A revogação é
> decisão de escopo do PI, registrada aqui; sua formalização exige **emenda à SPEC-Fundacao-02** (ato do PI).
> Ver § *Supersessão*.

---

## Objetivo

Trazer a tela CHOICE (`LOGIN → CHOICE → NOA | JARVIS`) do protótipo e da prova visual do design
system para dentro do app. A CHOICE passa a ser **a porta de entrada de cada sessão e a única forma
de trocar de espaço**, e o lugar onde o usuário **escolhe o acento de cor** de NOA e de JARVIS — as
duas identidades lado a lado.

## Contexto: o que já existe

| Onde | O que é | Conferido |
|---|---|---|
| `docs/design/JARVIS Platform (offline).html` §`data-screen-label="Escolha de ambiente"` | markup da tela no protótipo | — |
| `src/design/prova/jornada/Choice.tsx` | a tela como prova visual (dois cards, mascote, seletor de acento por módulo, seletor de tema no canto) | ✔ existe |
| `src/design/patterns/AccentSwatchSelector.tsx` | seletor de acento: **paleta fechada de 8 swatches por módulo**; docstring diz que "vive na CHOICE, não no shell interno" (F04a/SPEC-DS-06); restrição é contra *picker livre*, não contra reusar a paleta | ✔ existe |
| `src/design/tokens/acento.ts` | `PALETA_ACENTO` (8 cores), `ACENTO_PADRAO` = { jarvis `#C4C4C4`, noa `#C4C4C4` } | ✔ (`tokens.spec.ts` §254-255) |
| `src/design/tokens/semantic.ts` §53 | `SUPERFICIES_DE_MARCA = ['login','choice','transicao','toast']` — `'choice'` não inverte no tema claro | ✔ |
| `src/renderer/src/app/App.tsx` | vai de `TelaLogin` **direto** ao `AppShell`; nenhum arquivo do renderer importa `Choice` | (Code, kickoff) |
| `src/renderer/src/app/Settings.tsx` | não referencia acento — hoje `ACENTO_PADRAO` é constante fixa | ✔ (grep vazio) |

A CHOICE existe visualmente e no design system; **não está no fluxo do app**. Esta fatia a integra.

---

## Decisões do PI (2026-07-24) — os 4 bloqueadores

1. **A CHOICE entra em TODO login.** Fiel ao protótipo (`LOGIN → CHOICE → espaço`). Isso **revoga** a
   decisão da SPEC-Fundacao-02 de "abrir sempre no JARVIS, ignorando último estado" — ver § Supersessão.
2. **A CHOICE é a porta única de troca de espaço.** O rail do AppShell **deixa de alternar** NOA⇄JARVIS;
   trocar de espaço passa a ser: voltar à CHOICE. Ver § Mecanismo de retorno.
3. **O acento é escolhido na CHOICE e reajustável no Settings** (ambos os lugares).
4. **O seletor de tema fica na CHOICE, como prévia** do que virá ao entrar no espaço (não afeta a
   própria CHOICE, que é superfície de marca).

---

## Escopo

### Dentro

- **Integração da CHOICE no fluxo**: após login bem-sucedido, o app vai para a CHOICE (não direto ao
  shell). A partir da CHOICE, escolher NOA ou JARVIS entra no espaço correspondente, através da
  transição de marca (que entra nesta fatia — decisão do PI, 2026-07-24).
- **Seleção de espaço**: dois cards (NOA · pessoal, JARVIS · profissional), estética de marca do
  protótipo. Escolher um card é o que abre o espaço. Reusa a superfície de marca `'choice'`.
- **Seleção de acento na CHOICE**: `AccentSwatchSelector` por módulo (um para NOA, um para JARVIS),
  paleta fechada de 8 cores. A escolha define o acento ativo de cada espaço e **persiste por usuário**
  (ver *Persistência*).
- **Seleção de acento no Settings**: o **mesmo** `AccentSwatchSelector` (paleta fechada, por módulo)
  disponível também no Settings, para reajuste a qualquer momento sem passar pela CHOICE. **Não** é um
  color picker livre — mantém a restrição da F04a/SPEC-DS-06 que permitiu pré-calcular contraste.
- **Seletor de tema na CHOICE**: claro/escuro/sistema, no canto, como **prévia**. Escreve a mesma
  preferência de tema do Settings (SPEC-Fundacao-05); tem efeito ao entrar no espaço. A CHOICE em si
  não inverte (superfície de marca).
- **Mecanismo de retorno à CHOICE** (consequência da decisão 2): uma ação no shell — "Trocar de
  espaço" — que retorna à CHOICE **sem deslogar**. O controle de alternância de espaço do rail
  (entregue na F02) é **substituído** por essa ação. Ver § Mecanismo de retorno.
- **Tela de transição CHOICE → espaço** (decisão do PI no residual, 2026-07-24): o overlay de marca
  que o protótipo executa entre escolher o card e o espaço abrir. `'transicao'` já está em
  `SUPERFICIES_DE_MARCA`, então não inverte no tema claro. Como toda animação do projeto, respeita
  `prefers-reduced-motion` — e o overlay **não pode ser o gate da navegação**: quem pediu menos
  movimento entra no espaço do mesmo jeito, sem esperar transição alguma.
- **Instrumentação (F06 / CONVENTION §3)**: entrar num espaço pela CHOICE emite o `AuditEvent`
  `workspace-switch` já existente (SPEC-04 crit. 4) e loga `info` na categoria `ipc`/navegação com o
  espaço destino em `ctx`.

### Fora

- **Login por senha e GitHub** — fatia própria (STATUS item 12), com perguntas próprias.
- **Preferência de acento por dispositivo** — esta spec define por usuário (ver Persistência).
- Qualquer módulo funcional dos espaços.

---

## Comportamento detalhado

### Fluxo de entrada

1. Login bem-sucedido (SPEC-Fundacao-03) → **CHOICE** (não mais o shell direto).
2. Na CHOICE: usuário vê os dois cards, os dois seletores de acento (NOA/JARVIS), o seletor de tema.
3. Ajustar acento/tema é opcional; a ação que avança é **escolher um card** (Entrar em NOA ou JARVIS).
4. Ao escolher: entra no espaço, com o acento e o tema vigentes; emite `workspace-switch`.

### Troca de espaço no meio da sessão

- O rail **não** alterna espaços (decisão 2). Para trocar, o usuário aciona **"Trocar de espaço"** no
  shell, que o leva de volta à CHOICE, de onde escolhe o outro card. Volta a emitir `workspace-switch`.
- **Rota preservada por espaço permanece** (invariante da SPEC-Fundacao-02 crit. 1/3): ao reentrar num
  espaço pela CHOICE, o app restaura a última rota daquele espaço; a rota do outro nunca vaza.

### Acento

- Fonte da verdade do acento ativo de cada módulo passa a ser a **preferência do usuário** (não mais
  a constante `ACENTO_PADRAO`). `ACENTO_PADRAO` (jarvis `#C4C4C4`, noa `#C4C4C4`) vira **valor inicial**
  quando o usuário ainda não escolheu.
- CHOICE e Settings editam o **mesmo** valor: mudar num lugar reflete no outro.

---

## Supersessão da SPEC-Fundacao-02

Esta fatia altera comportamento entregue, testado e aceito (PR #28, aceite 2026-07-22). Registrado
explicitamente para que a **emenda à SPEC-Fundacao-02 seja feita pelo PI**:

| SPEC-Fundacao-02 | O que muda |
|---|---|
| "Workspace ativo ao abrir: sempre JARVIS OS, ignora último estado" (Pergunta resolvida 1) | **Revogado.** O app abre na CHOICE em todo login; o espaço ativo é escolhido ali. |
| Crit. 1 — "Alternância NOA⇄JARVIS OS funciona" **via rail** | **Re-homologado.** A alternância migra do rail para a CHOICE. O rail perde o controle de troca de espaço. |
| Crit. 1/3 — isolamento de navegação + **rota preservada por espaço** | **Permanece válido.** A invariante não muda; só muda por onde se dispara a troca. O teste A→B→A continua exigido (agora a troca é via CHOICE). |
| Crit. 7 — `workspace-switch` emite `info`/`AuditEvent` | **Permanece.** Entrar na CHOICE é o mesmo evento. |

> **Risco a registrar:** remover a alternância do rail toca código entregue (`WorkspaceSwitcher`,
> `navegacao.spec.ts` — este último só voltou a rodar no #47). A fatia precisa **atualizar os testes
> de isolamento** para exercitar a troca via CHOICE, não via rail, sem perder a cobertura da invariante.

---

## Critérios de aceite

1. Após login, o app abre na **CHOICE**, não no shell direto.
2. Escolher um card entra no espaço correspondente, aplicando acento e tema vigentes.
3. O rail **não** alterna espaços; a ação "Trocar de espaço" retorna à CHOICE sem deslogar, e de lá se
   troca. Teste: entrar em NOA → "Trocar de espaço" → escolher JARVIS restaura a rota de JARVIS; a rota
   de NOA nunca aparece na tela de JARVIS (invariante da SPEC-Fundacao-02 preservada, disparada pela CHOICE).
4. O acento escolhido na CHOICE aplica no espaço e **persiste entre sessões** (por usuário).
5. O acento é editável no **Settings** com o **mesmo seletor fechado** (não picker livre); mudar num
   lugar reflete no outro.
6. O seletor de tema na CHOICE escreve a preferência de tema (SPEC-Fundacao-05) e tem efeito ao entrar
   no espaço; a CHOICE em si não inverte.
7. Entrar num espaço pela CHOICE emite `workspace-switch` (`info` + `AuditEvent`), categoria correta,
   `workspace` destino em `ctx`.
8. Preferências por usuário: login de outro usuário não herda acento do anterior (paralelo ao crit. 3
   da SPEC-Fundacao-05).
9. **Transição CHOICE → espaço** (entrou por decisão do PI, 2026-07-24): o overlay de marca roda
   entre a escolha e a abertura do espaço, e **não inverte** no tema claro (`'transicao'` é
   superfície de marca).
10. **A transição não é gate da navegação**: com `prefers-reduced-motion: reduce`, o usuário entra no
    espaço sem esperar animação — e a navegação acontece de todo jeito. Testável sem navegador: o
    destino é alcançado independentemente de a animação ter rodado. É a lição da F06 — *"reveal
    animations must enhance an already-visible default"*: gate de visibilidade por transição não
    dispara em aba oculta nem em render headless.
11. `npm run test` e `npm run lint` passam. (UI: skill impeccable para construir/verificar/polir, sem
    substituir o piso verde.)

---

## Perguntas residuais — **resolvidas pelo PI (2026-07-24)**

Registradas pelo Code, a pedido do PI. **Marcar a spec como `aprovada-pi` é ato do Cowork**, dono
deste documento — o Code registra as respostas, não muda o status.

- **Q3 — pular a CHOICE.** **Confirmado: sempre aparece, sem flag de skip.** É a consequência das
  decisões 1 e 2: sendo ela a porta única de troca de espaço, um "lembrar e entrar direto" deixaria
  o usuário sem caminho para trocar.
- **Q6 — persistência do acento.** **Confirmada a proposta do Cowork:** campo(s) no `UserProfile`
  (exige migration), **por usuário**, **sem** `AuditEvent` — mesmo critério de tema/idioma na
  SPEC-Fundacao-05. Entrar num espaço continua auditando (`workspace-switch`).
- **Q-transição — a tela de transição entra nesta fatia?** **Sim — decisão do PI, contrária à
  proposta do Cowork** (que sugeria adiar para reduzir o tamanho). A jornada visual sai completa de
  uma vez. Ver *Nota de tamanho* abaixo.
- **Q7 — MVP e posição na fila.** **A CHOICE vem antes do MVP-004**; o container fica **em aberto**,
  a decidir depois. Ver *Nota de vínculo* abaixo.

### Nota de tamanho (Q-transição)

Com a transição dentro, a fatia acumula quatro frentes: integrar a CHOICE ao fluxo, **revogar a
alternância pelo rail** (código entregue e aceito), **migrar os testes de isolamento** para
exercitarem a troca via CHOICE sem perder a invariante do critério 1/3 da SPEC-Fundacao-02,
**adicionar migration** do acento no `UserProfile` e ainda o overlay de transição.

O risco não é a transição em si — é ela somar-se à revogação do rail, que é a parte delicada. Se
durante a implementação ficar claro que a fatia não fecha em uma entrega, o Code **para e reporta**
em vez de partir por conta própria: fatiar é decisão do PI.

### Nota de vínculo (Q7)

Sem MVP pai, a issue-fatia nasce como **card solto no board** — o ProPlan projeta por label, e um
card sem épico aparece sem agrupamento. Não impede o trabalho; é ruído de visualização que se
resolve quando o container for decidido.

As candidatas naturais a esse container, se ele vier a existir, são as fatias da mesma família — a
porta de entrada do app: **CHOICE**, **transição** e **login por senha/GitHub** (item 12 do
`STATUS.md`).

---

## Fora de escopo desta spec

- Login por senha/GitHub (STATUS item 12).
- Numeração `SPEC-nnn` do projeto (pendência antiga do STATUS §Índice).
- Módulos funcionais de NOA/JARVIS.

---

## Próximo passo (processo)

Quando o PI resolver os residuais acima, o Cowork: (1) marca esta spec `aprovada-pi`; (2) faz/registra a
**emenda à SPEC-Fundacao-02**; (3) cria a issue-fatia (Backlog, assignee PI) com título no padrão
`[MVP?][CHOICE?] Tela CHOICE — seleção de espaço + acento`, ajustando os tokens conforme o vínculo de MVP
decidido. O Code não implementa antes disso.

# SPEC-CHOICE-01 — Tela CHOICE (seleção de espaço + acento)

- MVP: **container em aberto** — o PI decidiu (2026-07-24) que a CHOICE vem **antes do MVP-004** e que o vínculo de épico fica para depois. Ver *Nota de vínculo*.
- Status: **`aprovada-pi` (2026-07-24)** — carimbada pelo Cowork. **Revisão 2026-07-24 (opção A, PI):** a Decisão 2 mudou — a CHOICE é porta de **entrada** (em todo login), e a troca na sessão continua pelo **rail**, não pela CHOICE. Supersessão da SPEC-Fundacao-02 reduzida ao mínimo (só o destino pós-login). Issue-fatia: **[#69](https://github.com/RodReis/rrb-jarvisOS/issues/69)** (Backlog, assignee PI).
- Autor: Claude Cowork (2026-07-24), a partir do kickoff do Code.
- Origem: `docs/kickoff-choice-selecao-de-espaco.md` (Code, 2026-07-24) + captura da CHOICE enviada pelo PI durante o ajuste do login (#57).
- Dependências: Fatias 02 (AppShell/WorkspaceSwitcher), 04 (UserProfile), 05 (Settings) entregues; MVP-003 (design system, inclui `AccentSwatchSelector`, identidades, superfícies de marca) entregue.

> **Supersessão mínima da SPEC-Fundacao-02:** esta spec muda **apenas** o destino pós-login (o app abre
> na CHOICE em vez de ir direto ao JARVIS). A alternância de espaço pelo rail permanece **intacta**.
> Emenda registrada na SPEC-Fundacao-02 (§ Emenda 2026-07-24). Ver § *Supersessão*.

---

## Objetivo

Trazer a tela CHOICE (`LOGIN → CHOICE → NOA | JARVIS`) do protótipo e da prova visual do design
system para dentro do app. A CHOICE passa a ser **a porta de entrada de cada sessão** — aparece em
todo login, igual ao protótipo — e o lugar onde o usuário **escolhe o acento de cor** de NOA e de
JARVIS, as duas identidades lado a lado. **Não** é a forma de trocar de espaço no meio da sessão:
isso continua sendo a sidebar/rail, como na SPEC-Fundacao-02.

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
2. **A CHOICE é porta de ENTRADA, não de troca.** Depois de escolher no login, a troca NOA⇄JARVIS no
   meio da sessão é pela **sidebar/rail, direto** (igual ao protótipo). O rail **continua alternando**
   como na SPEC-Fundacao-02; a CHOICE não reaparece na sessão. *(Revisado em 2026-07-24, opção A: a
   decisão anterior de "porta única / rail deixa de alternar" foi descartada pelo PI.)*
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
- **Troca de espaço na sessão permanece no rail** (não é escopo novo): a sidebar/rail alterna
  NOA⇄JARVIS direto, exatamente como entregue na F02. Esta fatia **não** mexe nesse mecanismo — só o
  preserva. A CHOICE não tem papel na troca durante a sessão.
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

- A sidebar/rail alterna NOA⇄JARVIS **direto**, como na SPEC-Fundacao-02 (entregue e testado). A
  CHOICE não participa: ela só decidiu o espaço de **entrada** ao vir do login. Trocar de espaço emite
  `workspace-switch`, como já emite hoje.
- **Rota preservada por espaço permanece intacta** (SPEC-Fundacao-02 crit. 1/3): ao voltar a um espaço
  pelo rail, o app restaura a última rota daquele espaço; a rota do outro nunca vaza. Nada disso muda.

### Acento

- Fonte da verdade do acento ativo de cada módulo passa a ser a **preferência do usuário** (não mais
  a constante `ACENTO_PADRAO`). `ACENTO_PADRAO` (jarvis `#C4C4C4`, noa `#C4C4C4`) vira **valor inicial**
  quando o usuário ainda não escolheu.
- CHOICE e Settings editam o **mesmo** valor: mudar num lugar reflete no outro.

---

## Supersessão da SPEC-Fundacao-02

Com a opção A (revisão 2026-07-24), a supersessão é **mínima**: um único ponto muda.

| SPEC-Fundacao-02 | O que muda |
|---|---|
| "Workspace ativo ao abrir: sempre JARVIS OS, ignora último estado" (Pergunta resolvida 1) | **Revogado.** O app abre na **CHOICE** em todo login; o espaço de entrada é escolhido ali. |
| Crit. 1 — "Alternância NOA⇄JARVIS OS funciona" **via rail** | **Permanece intacto.** O rail continua sendo o trocador de espaço na sessão. A CHOICE não substitui o rail. |
| Crit. 1/3 — isolamento de navegação + **rota preservada por espaço** | **Permanece intacto.** Nada muda; o teste A→B→A continua valendo como está (via rail). |
| Crit. 7 — `workspace-switch` emite `info`/`AuditEvent` | **Permanece.** Entrar pela CHOICE e trocar pelo rail são o mesmo evento. |

> **Sem risco sobre código de troca:** como o rail **não** muda, esta fatia **não** mexe em
> `WorkspaceSwitcher` nem migra `navegacao.spec.ts`. A única alteração de fluxo entregue é o destino
> pós-login (shell → CHOICE). Isso torna a fatia bem mais leve do que a versão "porta única".

---

## Critérios de aceite

1. Após login, o app abre na **CHOICE**, não no shell direto.
2. Escolher um card entra no espaço correspondente, aplicando acento e tema vigentes.
3. O rail **continua** alternando espaços na sessão (SPEC-Fundacao-02 intacta): a troca NOA⇄JARVIS é
   direta pelo rail, sem passar pela CHOICE. O teste A→B→A de isolamento de rota (crit. 1/3 da
   SPEC-Fundacao-02) continua passando **como está** — esta fatia não o altera.
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

- **Q3 — pular a CHOICE.** **Confirmado: aparece em TODO login, sem flag de skip** (revisão
  2026-07-24, "igual ao protótipo"). A justificativa antiga ("porta única") caiu com a opção A; a
  razão agora é simples: a CHOICE é a tela de entrada de marca a cada login, e o usuário escolhe ali
  onde a sessão começa. Trocar depois é pelo rail.
- **Q6 — persistência do acento.** **Confirmada a proposta do Cowork:** campo(s) no `UserProfile`
  (exige migration), **por usuário**, **sem** `AuditEvent` — mesmo critério de tema/idioma na
  SPEC-Fundacao-05. Entrar num espaço continua auditando (`workspace-switch`).
- **Q-transição — a tela de transição entra nesta fatia?** **Sim — decisão do PI, contrária à
  proposta do Cowork** (que sugeria adiar para reduzir o tamanho). A jornada visual sai completa de
  uma vez. Ver *Nota de tamanho* abaixo.
- **Q7 — MVP e posição na fila.** **A CHOICE vem antes do MVP-004**; o container fica **em aberto**,
  a decidir depois. Ver *Nota de vínculo* abaixo.

### Nota de tamanho (Q-transição)

Com a opção A, a fatia encolheu. As frentes agora são três: integrar a CHOICE ao fluxo (destino
pós-login: shell → CHOICE), **adicionar migration** do acento no `UserProfile` (+ o mesmo seletor no
Settings) e o overlay de transição. **Saíram** a revogação do rail e a migração dos testes de
isolamento — o rail fica intacto.

Ainda assim, se durante a implementação ficar claro que a fatia não fecha em uma entrega, o Code
**para e reporta** em vez de fatiar por conta própria: fatiar é decisão do PI.

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

Estado em 2026-07-24:

- ✅ **(1) `aprovada-pi`** — carimbada pelo Cowork; revisada na opção A (2026-07-24).
- ✅ **(2) Emenda à SPEC-Fundacao-02** registrada (§ Emenda 2026-07-24 daquela spec).
- ✅ **(3) Issue-fatia criada** — **[#69](https://github.com/RodReis/rrb-jarvisOS/issues/69)**, título
  `[CHOICE] Tela CHOICE — seleção de espaço + acento`, em **Backlog** (`proplan:backlog`), assignee **PI**,
  corpo linkando esta spec. Card solto (sem MVP pai, ver *Nota de vínculo*).

O Code **não implementa antes de a issue existir** e de ela entrar na fila via `STATUS.md` — cuja
atualização (posição da CHOICE antes do MVP-004, `proplan:next`) é do Code, não desta spec.

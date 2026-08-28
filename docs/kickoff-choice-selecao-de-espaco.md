# Kickoff — Tela CHOICE (seleção de espaço)

- **Status:** perguntas abertas, aguardando decisão do PI
- **Autor:** Claude Code (2026-07-24), a pedido do PI
- **Destino:** Claude Cowork, para virar spec depois das respostas
- **Origem:** o PI enviou a captura da CHOICE perguntando por ela durante o ajuste da tela de login ([#57](https://github.com/RodReis/rrb-jarvisOS/issues/57))

> **Este documento não é uma spec e não autoriza implementação.** Ele existe para que o PI decida
> uma vez, com o quadro inteiro à vista, em vez de decidir de improviso durante a codificação.

---

## O que já existe

| Onde | O que é |
|---|---|
| `docs/design/JARVIS Platform (offline).html` § `data-screen-label="Escolha de ambiente"` | markup completo da tela no protótipo |
| `docs/design/design-system/README.md` §1 | o diagrama de fluxo: `LOGIN → CHOICE → NOA \| JARVIS` |
| `src/design/prova/jornada/Choice.tsx` | a tela **como prova visual do DS** (F06) — dois cards, mascote, seletor de acento |
| `src/design/tokens/semantic.ts` `SUPERFICIES_DE_MARCA` | `'choice'` já é superfície de marca: nunca inverte no tema claro |

**A tela não está no app.** `src/renderer/src/app/App.tsx` vai de `TelaLogin` direto para `AppShell`;
nenhum arquivo do renderer importa `Choice`. O que existe é a prova visual, que roda numa galeria
separada (`vite.prova.config.ts`), não no produto.

---

## A questão de fundo: duas fontes se contradizem

Esta é a decisão que governa todas as outras, e ela **não é uma lacuna** — é um conflito real
entre dois documentos, ambos legítimos:

| Fonte | O que diz |
|---|---|
| **Protótipo** (`README.md` §1) | `doLogin() → success toast → _go('choice')` — a CHOICE é a 2ª tela, sempre |
| **SPEC-Fundacao-02**, pergunta 1, **resolvida pelo PI em 2026-07-21** | *"Workspace ativo ao abrir: **sempre JARVIS OS** (comportamento determinístico; ignora último estado)"* |

O PI já decidiu, com a spec aprovada, que o app abre direto no JARVIS OS. A CHOICE contradiz
essa decisão: se ela existe, o app **não** abre determinístico — ele pergunta.

A regra de precedência (SPEC-DesignSystem-02) diz que *"onde protótipo e PRD divergirem sobre a
experiência realizada, o protótipo vence"*. Mas ela trata de **PRD × protótipo**, e aqui o conflito
é com uma **decisão explícita do PI numa spec aprovada** — o que a regra não cobre, e por isso
volta para a mesa.

**Nenhuma leitura é obviamente certa**, e é por isso que este documento existe em vez de eu ter
escolhido uma.

---

## As perguntas

### Q1 — A CHOICE entra no fluxo do app? *(bloqueante; todas as outras dependem desta)*

- **(a) Sim, em todo login.** Fiel ao protótipo. Custo: uma tela a mais entre o usuário e o
  trabalho, em toda sessão. Revoga a decisão de 2026-07-21 da SPEC-Fundacao-02.
- **(b) Sim, só no primeiro login** (ou quando não houver espaço lembrado). Depois, entra direto no
  último usado. Preserva o espírito do "determinístico" e mantém a tela como boas-vindas.
- **(c) Não entra.** A CHOICE fica como peça do design system (prova visual), e a troca de espaço
  continua só no rail. Mantém a SPEC-Fundacao-02 como está.

> Se a resposta for **(c)**, as demais perguntas caem e este documento se encerra aqui.

### Q2 — Se entra: o que ela decide, exatamente?

O rail do `AppShell` já alterna NOA ⇄ JARVIS a qualquer momento, com rota preservada por espaço
(critério 1 da SPEC-Fundacao-02). Então a CHOICE **não** é a única forma de escolher espaço — ela é
uma escolha inicial.

- Ela define só o espaço de entrada da sessão, e o rail segue mandando depois?
- Ou ela é a porta e o rail deixa de trocar (o usuário voltaria à CHOICE para mudar)?

A segunda opção muda o critério 1 da SPEC-Fundacao-02, que é comportamento já entregue e testado.

### Q3 — O usuário pode pular?

- Tem "não perguntar de novo" / "lembrar minha escolha"?
- Se tem, onde ele desfaz isso? (Settings, presumivelmente — mas é preferência nova, e o
  `UserProfile` da F04 não tem campo para ela.)

### Q4 — Onde vive o seletor de acento?

Na prova (`Choice.tsx`) a tela traz o `AccentSwatchSelector`, um por módulo. **No app ele não existe
em lugar nenhum** — conferido: `src/renderer/src/app/Settings.tsx` não o referencia, e o
`ACENTO_PADRAO` é usado como constante fixa.

- O acento passa a ser escolhido na CHOICE?
- Ou vai para Settings (onde moram as outras preferências) e a CHOICE só escolhe o espaço?
- Ou os dois lugares?

Isso decide se a CHOICE é "escolha de espaço" ou "tela de configuração inicial" — são fatias de
tamanho bem diferente.

### Q5 — E o seletor de tema no canto?

O protótipo põe um seletor de tema no canto superior direito da CHOICE. Mas a CHOICE é **superfície
de marca**: ela não inverte (README §2.6, e `'choice'` já está em `SUPERFICIES_DE_MARCA`).

Ou seja: o usuário escolheria um tema que **não se aplica à tela onde ele está escolhendo**, e só
teria efeito depois de entrar. Isso é intencional (prévia do que virá) ou é resquício do protótipo,
que não tinha o conceito de superfície de marca?

O Settings já tem seletor de tema entregue (SPEC-Fundacao-05).

### Q6 — Persistência

- A escolha vira campo no `UserProfile` (F04, exige migration) ou fica em storage local simples?
- Ela é por usuário ou por dispositivo?
- Gera `AuditEvent`? (a troca de workspace pelo rail já gera `workspace-switch` — a escolha inicial
  é o mesmo evento ou um novo?)

### Q7 — Onde entra na fila

Não é `[FIX]`: há decisão de produto em cada pergunta acima. É **fatia**, e precisa de posição no
`STATUS.md` — antes ou depois do MVP-004 (execução real), que hoje é a frente candidata.

---

## O que eu recomendaria, se me perguntassem

Não é decisão minha, mas registro para poupar uma rodada:

**Q1 → (b)**, CHOICE no primeiro login apenas. Preserva a intenção do protótipo (a tela existe, com
as duas identidades lado a lado, que é o momento de marca) sem cobrar um clique por sessão de quem
já sabe onde quer trabalhar. E não revoga a decisão de 2026-07-21 — apenas a qualifica: o app segue
determinístico *depois* de o usuário ter dito uma vez qual é o padrão dele.

**Q4 → Settings**, não a CHOICE. Acento é preferência, e preferência tem um lugar no app. Uma tela
de entrada que também configura vira tela de configuração.

**Q5 → sem seletor de tema na CHOICE.** Ele já existe no Settings, e um seletor que não afeta a
tela onde está é confuso — o protótipo o desenhou antes de a superfície de marca existir como
conceito.

---

## Fora de escopo deste documento

- **Login por senha e GitHub** — outra fatia, com perguntas próprias (item 12 do `STATUS.md`).
- A tela de **transição** entre CHOICE e o espaço (o protótipo tem um overlay; ela é superfície de
  marca também, e entra junto ou não conforme a resposta da Q1).

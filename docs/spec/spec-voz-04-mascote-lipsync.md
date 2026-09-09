# SPEC-Voz-04 — Mascote com lip-sync por visemes e estados

- MVP: `docs/mvp/mvp-017-command-center-voz.md` (Fatia 04). Épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Status: **aprovada-pi** (2026-09-09) — a pergunta que travava a fatia (como desenhar 15 formas de boca) foi resolvida pelo PI nesta data; as demais estão cravadas em § Decisões, coerentes com decisões anteriores. A issue-fatia nasce quando esta spec chegar à `main`.
- Dependências: **M17-F02 (#202)** — consome `VisemeEvent[]` e `SpeechHandle` de `src/shared/domain/visemes.ts` e a reprodução de `src/renderer/src/app/reproducao-de-fala.ts`; **M17-F03 (#204)** — consome os estados do loop já mantidos em `Microfone.tsx`; MVP-003 — o `VoiceMascot` existe em `src/design/ui/VoiceMascot.tsx`. **Independe do MVP-005**: não chama LLM e não abre canal de IPC.
- Decisões que sustentam esta spec: invariante do épico #193 (**lip-sync por visemes, nunca por amplitude**); SPEC-Voz-02 (a timeline é o contrato; a F04 não conhece fonema); SPEC-DesignSystem-05 (um componente, duas identidades; `vozPadrao` do NOA é `false` por decisão do PI); `JARVISOS.md §3.2`; `CLAUDE.md` (renderer sem Node; alterações cirúrgicas; sem hardcode).

## Objetivo

A boca do mascote passa a dizer o que a fala está dizendo. Hoje o `VoiceMascot` anima uma barra em laço de 420 ms enquanto `falando` for verdadeiro — movimento genérico, sem relação com o áudio. Esta fatia troca o laço pela `VisemeEvent[]` que a F02 já produz e completa os quatro estados que o Done do épico declara: **idle, ouvindo, pensando, falando**.

Não é enfeite: a boca sincronizada é a diferença entre um rosto que responde e um rosto que finge — e o protótipo prometeu a primeira coisa desde o começo.

## A anatomia real do mascote (do protótipo, verificada na arte)

O JARVIS **não tem lábios**. É uma cabeça mecânica: olhos luminosos grandes e, na parte inferior, uma estrutura de mandíbula e grade. Isso decide o desenho das poses:

- **A "boca" é mecânica** — a pose varia *abertura da mandíbula*, *largura* e *intensidade da grade*, não a curvatura de um lábio. Uma pose desenhada como boca humana ficaria estranha sobre essa arte.
- **Os olhos participam** — no protótipo eles são o elemento mais forte (`eyeblink` idle, `eyeglow` falando). Os quatro estados usam olhos **e** boca; o lip-sync é só da boca.
- **A arte não muda nesta fatia.** O asset é o que já está em `src/design/assets/jarvis-cabeca.jpg`. Verificação obrigatória no passo 1: se a arte do repo divergir do protótipo que o PI usa, a fatia para e o PI anexa a arte correta pelo fluxo de anexos — **não** se aproxima "no olho".

## O que já existe (levantado no código, não presumido)

| peça | onde | estado |
|---|---|---|
| `VisemeEvent` / `SpeechHandle` / 15 visemes | `src/shared/domain/visemes.ts` | entregue na F02 |
| Timeline por fala (`exato` ou `estimado`) | `src/main/voz/timeline-de-visemes.ts` | entregue na F02 |
| Reprodução Web Audio | `src/renderer/src/app/reproducao-de-fala.ts` | entregue na F02 — **não expõe o relógio do áudio** |
| Estados do loop (`ocioso`/`gravando`/`transcrevendo`/`pensando`/`falando`) | `src/renderer/src/app/Microfone.tsx` | entregues na F03 |
| Mascote com boca em laço + `falando`/`ouvindo`/`parado` | `src/design/ui/VoiceMascot.tsx` | entregue no MVP-003 |

A fatia é **renderer + design system**. Nenhum canal de IPC novo, nenhum processo novo, nenhum download.

## Escopo

### Dentro

- **Pose por viseme como dado versionado.** `Record<Viseme, PoseDaBoca>` no design system, exaustivo sobre o tipo `Viseme` — viseme novo na F02 quebra a compilação em vez de virar boca parada silenciosa. `PoseDaBoca` descreve **geometria mecânica** (abertura, largura, intensidade), nunca um asset por forma.
- **Boca geométrica paramétrica** (decisão do PI, 2026-09-09): a barra atual vira forma vetorial parametrizada, desenhada sobre a região da mandíbula. Zero asset novo.
- **Relógio do áudio como fonte do tempo.** `FalaEmCurso` (F02) ganha `posicaoMs(): number`, derivado do `AudioContext` que está tocando. **Delta declarado e cirúrgico** em `reproducao-de-fala.ts` — a única mudança fora do renderer/DS nesta fatia. O mesmo `posicaoMs()` é o que a **F05** usa para revelar a legenda no ritmo da fala; nasce aqui e é reusado lá, não duplicado.
- **Atualização fora do ciclo do React**: a boca é escrita por `ref` em custom properties CSS a cada quadro (`requestAnimationFrame`). Nada de `setState` por quadro.
- **Cursor incremental sobre a timeline** — lista ordenada e tempo monotônico pedem um ponteiro que avança, não uma busca por quadro.
- **Quatro estados**, derivados do que a F03 já mantém: `ocioso`→**idle**, `gravando`→**ouvindo**, `transcrevendo` e `pensando`→**pensando**, `falando`→**falando**. O mascote recebe o estado por prop; não deduz.
- **Fim e cancelamento fecham a boca** no mesmo quadro. Boca congelada numa vogal é o defeito mais visível que esta fatia pode ter.
- **Relógio injetável** na animação, para o teste avançar o tempo e afirmar a pose sem `sleep`.
- **Prova visual**: galeria com as 15 poses e os 4 estados, no gate visual que o repo já roda.

### Fora

- Ondas de áudio, legenda, transcript, histórico e a tela — **F05**.
- Seletor de dispositivos — F05.
- Expressão emocional, cabeça que vira, olhos que seguem conteúdo — não estão no Done do épico; se vierem, é fatia própria.
- Troca da arte do mascote ou personagem vetorial novo (Rive/Lottie) — descartado pelo PI nesta fatia.
- Qualquer leitura de amplitude do áudio para mover a boca — proibido pela invariante do épico.

## Critérios de aceite

1. **A boca segue a timeline, não o relógio de parede.** Com uma `VisemeEvent[]` conhecida e o relógio injetado, avançar o tempo para o meio de cada evento produz a pose daquele viseme. Teste cobre os 15 valores.
2. **Contrafactual da fonte do tempo:** trocar `posicaoMs()` por `Date.now()` reprova o teste de deriva — ele simula um contexto de áudio atrasado em relação ao relógio de parede e afirma que a boca acompanha o áudio.
3. **Nada de re-render por quadro:** um contador de renders durante uma fala de vários segundos permanece na casa das mudanças de estado (unidades), não dos quadros. Teste.
4. **Timeline vazia não quebra e não inventa:** `visemes: []` → boca fechada, nenhum erro, nenhum laço genérico de volta. Teste.
5. **Fim e cancelamento fecham a boca** no mesmo quadro, inclusive quando uma nova fala cancela a anterior (critério 7 da F02). Teste.
6. **Os quatro estados existem e são distinguíveis** — `data-estado` com `idle`/`ouvindo`/`pensando`/`falando`, olhos e boca coerentes com cada um, e `aria-live` anunciando os quatro em pt-BR. `pensando` nunca é renderizado como `falando` de boca parada.
7. **A pose é dado exaustivo:** remover uma entrada do mapa não compila; nenhum `switch` sobre viseme fora do mapa (contrafactual + guarda de lint, no padrão das F01/F02).
8. **`prefers-reduced-motion` desliga decoração, não informação:** anéis, `bob` e glow param; a boca continua sincronizada, porque ela é o sinal de que o app está falando. Prova visual nos dois modos.
9. **Identidade preservada:** com `voz={false}` (default do NOA), nenhum estado novo aparece — a decisão do PI registrada no DS continua valendo por construção. Teste.
10. **Verificação no app real:** falar uma frase longa em pt-BR e confirmar que a boca termina junto com o áudio; a evidência registra o caminho da timeline (`exato` ou `estimado`) usado na medição.
11. `npm run dev`, `npm run test`, `npm run lint` verdes; prova visual no gate; evidência em `reports/TESTS.md` por SPEC/issue conforme `docs/TESTING.md`.

## Perguntas resolvidas pelo PI (2026-09-09)

1. **Como desenhar as 15 formas de boca:** **boca geométrica paramétrica** sobre a arte existente — a barra atual vira forma vetorial com abertura/largura/intensidade por viseme. Descartados: 15 poses desenhadas por identidade (30 assets que não existem e travariam a fila) e mascote vetorial novo em Rive/Lottie (retrabalharia o DS inteiro). — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **O relógio é o do áudio, sempre.** `Date.now()` parece equivalente e não é: o Web Audio agenda no relógio do próprio contexto, e um contexto suspenso (janela em segundo plano) congela o som sem congelar o relógio de parede — a boca continuaria mexendo em silêncio. O delta em `reproducao-de-fala.ts` existe por causa disso, e por nada mais.
- **A boca não passa pelo estado do React.** Sessenta quadros por segundo de `setState` redesenhariam a árvore do Command Center inteira durante toda fala; escrever numa custom property por `ref` mantém o custo em uma propriedade CSS.
- **Transição curta entre poses** (faixa de 40–60 ms, valor cravado no teste): troca seca a 60 fps lê como estroboscópio; interpolação longa borra a articulação até virar a barra genérica de novo.
- **`pensando` = boca fechada, anéis mais rápidos, glow dos olhos mais fraco que em `falando`.** É o único estado que o protótipo não desenha; nasce aqui pela regra de sempre — estado é forma, não cor sozinha (princípio 5 do `PRODUCT.md`).
- **Só o JARVIS ganha lip-sync.** O NOA mantém `vozPadrao: false`, por decisão anterior do PI: o espaço pessoal não fala sem ser chamado.
- **O mascote do rail (40px) não sincroniza.** Nessa escala a boca não é legível, e sincronizá-la poria um `requestAnimationFrame` rodando em toda tela do app, não só no Command Center.
- **A F04 continua sem conhecer fonema.** O mapa fonema→viseme fica onde a F02 o pôs; esta fatia traduz viseme→pose e nada mais.
- **`timeline: 'estimado'` não aparece na tela** — é sinal de engenharia, vai para o log, como a F02 cravou.
- **Nenhum canal de IPC novo:** o `SpeechHandle` já chega ao renderer com os visemes dentro.

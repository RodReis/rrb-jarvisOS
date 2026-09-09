# SPEC-Voz-05 — Tela do Command Center e seletor de dispositivos

- MVP: `docs/mvp/mvp-017-command-center-voz.md` (Fatia 05) — fecha o MVP-017. Épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Status: **aprovada-pi** (2026-09-09) — quatro perguntas resolvidas pelo PI nesta data (comandos rápidos, câmera, primeira execução e, na F04, a forma da boca); as demais estão cravadas em § Decisões. A issue-fatia nasce quando esta spec chegar à `main`.
- Dependências: **M17-F01 (#200)** — a captura passa a receber dispositivo; **M17-F02 (#202)** — a reprodução passa a receber saída; **M17-F03 (#204)** — transcript e histórico existem em forma mínima; **M17-F04** — o mascote e o `posicaoMs()` do relógio de áudio nascem lá e são consumidos aqui; **M22-F01 (#206)** — o menu é projeção do registro de módulos, então o Command Center entra como módulo registrado.
- Decisões que sustentam esta spec: **decisão do PI de 2026-09-08** (comentário no #193 — o padrão de dispositivos é **do app, não do sistema**); **decisões do PI de 2026-09-09** (§ Perguntas resolvidas); `JARVISOS.md §3` e a captura do protótipo anexada pelo PI em 2026-09-09; invariante do épico #193 (**conversa por voz não executa ação**); SPEC-Voz-01 § Fora e § Decisões ("o seletor de dispositivo fica para a F05"); SPEC-Shell-01 (indicador sem estado real não é renderizado); `CLAUDE.md` (sem hardcode; sem mock; renderer sem Node).

## Objetivo

Duas coisas, na mesma superfície:

1. **A tela.** O loop de voz vive hoje num `Card` chamado `Microfone` — botão, transcript, lista de trocas. O protótipo mostra outra coisa: o mascote dominando a tela, ondas de áudio, a legenda do que está sendo falado e o botão de microfone no eixo central. Esta fatia entrega essa tela.
2. **O dispositivo certo.** Três tentativas de conversa do PI voltaram vazias porque `getUserMedia` sem `deviceId` cai no padrão do Windows — a entrada da placa-mãe, sem nada plugado (RMS 95–364 contra 2076 de fala que o Whisper aceita). O headset estava na lista e nunca era escolhido.

O defeito de fundo não foi o dispositivo errado: foi **o app escolher calado**. Toda decisão desta spec sai daí.

## A tela, como o protótipo a mostra

Eixo vertical central, com o mascote grande no topo:

```
  Command Center                          [tema]  [estado do ambiente]
  · J.A.R.V.I.S — JUST A RATHER VERY INTELLIGENT SYSTEM

                        ╭───────────────╮
   (coluna de           │    mascote    │      ← F04: olhos + boca por visemes
    comandos            │  anéis · glow │
    rápidos —           ╰───────────────╯
    fora desta
    fatia)                ▁▃▅▇▅▃▁▂▄▆▄▂▁         ← ondas: entrada OU saída

                  "texto do que está sendo falado"  ← legenda, no ritmo do áudio

                          ( 🎤 )
                         FALANDO…                ← botão + rótulo do estado
```

- **A coluna de comandos rápidos não é renderizada nesta fatia** (ver § Perguntas resolvidas, 1). Grupo sem item visível não aparece — a mesma regra que a M22-F01 aplicou ao menu. A tela fica coerente em vez de exibir um bloco vazio esperando fatia futura.
- **A legenda é a fala do JARVIS**, não a transcrição do usuário. O que o usuário disse aparece no histórico; o que o app está dizendo aparece na legenda.
- **Topbar e rodapé são do AppShell**, não desta fatia. Os indicadores do protótipo que não têm estado real por trás (`MODO PASSIVO`, `AMBIENTE OPERACIONAL`, localidade) **não** entram: a M22-F01 acabou de remover a pill "MODO AUTÔNOMO" por essa mesma razão, e reintroduzir decoração sem estado desfaria uma fatia aceita.

## O que já existe (levantado no código, não presumido)

| peça | onde | estado |
|---|---|---|
| Captura 16 kHz mono | `src/renderer/src/app/captura-de-audio.ts` | `getUserMedia` **sem `deviceId`** — a causa raiz medida |
| Reprodução Web Audio | `src/renderer/src/app/reproducao-de-fala.ts` | toca em `contexto.destination` — **sem escolha de saída** |
| Botão, estados, transcript, histórico da sessão | `src/renderer/src/app/Microfone.tsx` | UI mínima das F01/F03 |
| Preferências de voz (modelo, idioma, hotkey, teto, voz da fala + preview) | `src/renderer/src/app/PreferenciasDeVoz.tsx` | aba de voz no Settings |
| RMS do áudio no log | `Microfone.tsx` (`nivelRms`) | entregue no FIX #348 — a medida que o seletor reaproveita na tela |

## Escopo

### Dentro

- **Tela do Command Center** conforme a captura do protótipo, entrando pelo **registro de módulos** (M22-F01), não como item escrito à mão no AppShell.
- **Ondas de áudio** por `AnalyserNode`: entrada durante `gravando`, saída durante `falando`, repouso em `ocioso` e `pensando`.
- **Legenda da fala** revelada no ritmo do áudio, usando o `posicaoMs()` que a F04 introduz — não um intervalo de 26 ms por caractere como no protótipo, que descola do som na primeira frase longa.
- **Botão de microfone com rótulo do estado**, cobrindo os quatro estados reais do loop; cor **e** forma distinguem (`PRODUCT.md`, princípio 5), nunca cor sozinha.
- **Transcript e histórico da sessão** promovidos do `Card` atual para a tela, com quem falou em cada linha.
- **Seletor de dispositivo de entrada (microfone)** com `enumerateDevices`, escolha persistida em preferências, aplicada por `deviceId: { exact }`.
- **Seletor de dispositivo de saída (alto-falantes)** aplicado à reprodução por `setSinkId`. **Delta declarado** em `reproducao-de-fala.ts`.
- **Medidor de nível ao vivo** ao lado do seletor de entrada: a barra mexe quando o usuário fala, **antes** de gravar qualquer coisa.
- **Escolha pedida no primeiro uso** (decisão do PI): sem dispositivo gravado, a tela pede o microfone com o medidor ao lado antes de liberar o "segure para falar".
- **Falha explícita, nunca queda calada:** dispositivo salvo ausente → aviso nomeando o que sumiu e o que passou a ser usado. `exact` e não `ideal` justamente para o navegador **falhar** em vez de escolher sozinho.
- **Rótulos de dispositivo só após permissão** — antes do primeiro `getUserMedia` concedido, `enumerateDevices` devolve rótulos vazios; a tela pede a permissão em vez de listar "Microfone 1, Microfone 2".

### Fora

- **Comandos rápidos com efeito** (STATUS/DEPLOY/ESCANEAR/EXECUTAR AGENTES) — decisão do PI: fatia própria, com Policy Engine e aprovação, como o épico já previa para "comando de voz com efeito".
- **Câmera** — decisão do PI: fora desta fatia; volta no MVP-021 (visão via Frigate), que traz o seletor junto do consumidor. **O padrão de câmera registrado pelo PI em 2026-09-08 (C930e) fica sem lugar onde morar até lá** — anotado aqui para não se perder.
- **Nomes de dispositivo cravados no código.** A decisão do PI (G432 / Realtek) descreve o que **ele** vai escolher na máquina dele, não um default de fábrica: escrever "G432" no código seria hardcode e quebraria em qualquer outra máquina.
- Escuta contínua, wake word, VAD contínuo — MVP-018.
- Transcrição parcial/streaming — a F01 cravou por enunciado completo.
- Indicadores do protótipo sem estado real por trás.
- Trocar `createScriptProcessor` por `AudioWorklet` — dívida herdada da F01, registrada como limite conhecido; é fatia própria.

## Critérios de aceite

1. **O dispositivo escolhido é o que grava:** com dois dispositivos disponíveis, escolher o segundo faz a captura abrir com `deviceId: { exact: <o escolhido> }`. O teste afirma o argumento passado ao `getUserMedia`, não a intenção.
2. **Contrafactual do `exact`:** trocar para `ideal` reprova o teste que simula dispositivo ausente — com `ideal` o navegador cai no padrão e o app segue calado, que é o defeito de origem.
3. **Primeiro uso pede a escolha:** sem preferência gravada, o botão de falar não libera antes de o microfone ser escolhido, e o medidor está visível nesse momento. Teste.
4. **Dispositivo salvo sumiu → aviso nomeado:** a tela diz qual dispositivo não foi encontrado e o que está usando no lugar; o app continua utilizável. Teste dos dois caminhos (sumiu / voltou).
5. **A saída obedece:** escolher alto-falantes aplica `setSinkId`; ambiente sem suporte degrada **com aviso**, nunca em silêncio. Teste + verificação no app real.
6. **O medidor responde ao som:** com o dispositivo selecionado, falar move a barra e silêncio a mantém no piso — com o número medido no relatório, pela régua de RMS do FIX #348. Verificação no app real.
7. **Rótulos após permissão:** sem permissão, a tela mostra o pedido em vez de uma lista sem nomes; concedida, traz os rótulos reais. Teste.
8. **As ondas seguem a fonte certa:** entrada em `gravando`, saída em `falando`, repouso em `ocioso`/`pensando`. Teste com `AnalyserNode` dublê.
9. **A legenda acompanha o áudio:** com o relógio injetado, avançar o tempo revela a porção correspondente do texto; a fala terminada mostra o texto inteiro. Contrafactual: revelação por intervalo fixo reprova em frase longa.
10. **Nenhum caminho de ação nasce aqui:** a tela não executa comando, não toca filesystem, não dispara conector — invariante do épico, provado por contrafactual como na F03.
11. **A tela é módulo registrado:** aparece no menu pela projeção do registro (M22-F01); nenhum item literal no AppShell. Teste.
12. **Nada de indicador sem estado real** na tela entregue (contrafactual: reintroduzir a pill de modo reprova o teste da M22-F01).
13. **Áudio continua não persistindo:** medidor, ondas e preview não gravam nada — varredura de `userData` após uma sessão não encontra arquivo de áudio.
14. **Prova visual** da tela nos dois temas e com movimento reduzido, no gate visual que o repo já roda; a altura da coluna de conteúdo é medida, não estimada.
15. `npm run dev`, `npm run test`, `npm run lint` verdes; evidência em `reports/TESTS.md` por SPEC/issue conforme `docs/TESTING.md`, com a latência do loop completo medida na máquina do PI.

## Perguntas resolvidas pelo PI (2026-09-09)

1. **Comandos rápidos do protótipo:** **ficam fora da F05**. O invariante do épico (voz não executa ação) é preservado, e comandos com efeito viram fatia própria com Policy Engine + aprovação. Consequência aceita: a coluna esquerda do protótipo não é renderizada nesta entrega. — decidido.
2. **Câmera:** **fora da F05**; o MVP-021 traz o seletor junto do consumidor. — decidido.
3. **Primeira execução:** o app **pede a escolha do microfone antes do primeiro uso**, com o medidor de nível ao lado — em vez de usar o padrão do SO e repetir o caso de origem. — decidido.
4. **(F04) Forma da boca:** geométrica paramétrica sobre a arte existente. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`exact`, nunca `ideal`.** É a linha entre "o app falhou e disse" e "o app escolheu por você e ficou quieto" — a segunda custou três tentativas de conversa e uma investigação inteira.
- **O padrão é a escolha do usuário, não uma lista de nomes no código.** A decisão de 2026-09-08 vira comportamento, não constante.
- **O medidor fica ao lado do seletor**, não numa tela de diagnóstico: o momento em que a pessoa duvida do microfone é o momento em que ela está escolhendo.
- **A legenda usa o relógio do áudio da F04**, não um timer próprio — um segundo relógio para a mesma fala dessincronizaria da boca, e o Command Center mostra os dois ao mesmo tempo.
- **Meia-duplex explícito:** as ondas mostram entrada **ou** saída, porque o loop é assim; barras animando em `pensando` sugeririam captação que não existe.
- **A tela entra pelo registro de módulos** (M22-F01); furá-lo aqui desfaria a fatia recém-aceita.
- **O histórico continua em memória**, como a F03 cravou (10 trocas; reiniciar zera). Persistir transcrição de fala em disco é decisão de privacidade que ninguém tomou — e o app inteiro promete que a fala não fica gravada.
- **Legenda sem efeito de digitação artificial:** o texto é revelado pelo áudio real. O cursor piscando do protótipo é mantido como marca visual, não como simulação de digitação.
- **Limite conhecido registrado:** `createScriptProcessor` está deprecado desde a F01. Trocá-lo de contrabando violaria "alterações cirúrgicas" — fica anotado para virar fatia quando incomodar.

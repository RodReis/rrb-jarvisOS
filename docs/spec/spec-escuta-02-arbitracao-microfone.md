# SPEC-Escuta-02 — Arbitração wake word ↔ push-to-talk e estados do microfone

- MVP/Fatia: MVP-018 · M18-F02.
- Issue: a criar quando esta SPEC chegar à `main`; épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Status: **aprovada-pi** (2026-09-10) — quatro perguntas resolvidas pelo PI nesta data, nenhuma em aberto.
- Fila: **não altera `next`.** A construção corrente é a M10-F01 ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)).
- Depende de: **M18-F01** (`spec-escuta-01-wake-word.md`) — o serviço de escuta, o modelo e os controles nascem lá. Também M17-F01 (push-to-talk, `globalShortcut`, timeout duro de gravação), M17-F02 (Piper), M17-F04 (estados e relógio de áudio do mascote), M17-F05 (dono da preferência de dispositivo e medidor).
- Design: antes da construção, anexar e aprovar o protótipo do quinto estado do mascote pelo fluxo já aprovado — requisito permanente do PI para fatia visual.

## Objetivo

A F01 entrega um segundo jeito de abrir a conversa. Esta fatia responde ao que isso cria: **dois gatilhos disputando um microfone**, e um estado que a interface ainda não sabe mostrar. Sem ela, a escuta contínua e o push-to-talk vão abrir dois caminhos de captura em paralelo — e a M17-F05 já mostrou o preço disso.

## Escopo

### Dentro

- **Um único dono do microfone.** Um serviço de captura no renderer abre `getUserMedia` uma vez, com o `deviceId: { exact: … }` da preferência da M17-F05, e **wake word e push-to-talk são consumidores inscritos** — nenhum dos dois chama `getUserMedia` por conta própria. Esta é a correção estrutural da lição da M17-F05: quando o código passou a ter dois caminhos de captura (`capturar` e `capturarPcm`), ele começou a perguntar "estou em teste?" e desligou permissão, listagem e medidor na suíte.
- **Máquina de estados explícita e única**, consumida pelo mascote, pela legenda e pelo indicador: `ocioso` → `escutando` → `gravando` → `transcrevendo` → `pensando` → `falando`. Uma fonte, nenhuma projeção paralela.
- **`escutando` é o quinto estado do mascote**, com expressão própria (decisão do PI) — não um badge colado no `ocioso`. É também o indicador permanente que a F01 exige: escuta ativa sem o estado visível é defeito.
- **Precedência: o push-to-talk sempre ganha.** Segurar o botão ou acionar a hotkey **suspende a detecção de wake word**; soltar retoma. O ato explícito nunca espera o gatilho automático.
- **Disparo com turno ocupado é recusado, com sinal.** Nos estados `gravando`, `transcrevendo` e `pensando`, "Ei, amigo" **não** abre turno novo: o app sinaliza que ouviu e não vai atender agora. **Nada é enfileirado** — o segundo turno não chega descolado do contexto, minutos depois.
- **Barge-in no estado `falando`.** Enquanto o JARVIS fala, "Ei, amigo" **corta o TTS** e abre turno novo. É o único estado ocupado em que o disparo é aceito.
- **Supressão do próprio áudio.** O app sabe qual PCM mandou tocar; a detecção usa essa referência para descartar o que ele mesmo está reproduzindo. Sem isso, o Piper dizendo "ei, amigo" numa resposta auto-dispara o app — e a supressão é o que torna o barge-in possível sem esse defeito.
- **Timeout duro de gravação** da M17-F01 (60 s, configurável) vale igualmente para o turno aberto por voz.
- **Transição auditada quando muda o dono do microfone** — a captura passar de um consumidor para outro é registrada, para que "quem estava gravando" seja rastreável.

### Fora

- **Cronograma de ações configurável** — é a M18-F04, com Policy Engine e aprovação.
- **Modo Boas-Vindas** — M18-F03.
- **Executar ação por voz.** O invariante do MVP-017 continua: conversa por voz não executa ação.
- **Cancelamento de eco acústico completo (AEC)** — a supressão aqui é por referência do sinal reproduzido, não um AEC de sala. Se o alto-falante em volume alto vazar o suficiente para derrubar a detecção, é fatia própria.
- **Transcrição parcial em streaming** — segue fora, como na M17-F01.

## Critérios de aceite

1. **Um `getUserMedia` só.** Com escuta ativa e push-to-talk usado em seguida, o teste afirma que a captura foi aberta **uma vez** e compartilhada. **Contrafactual:** um segundo consumidor abrindo stream próprio reprova.
2. **Push-to-talk suspende a detecção.** Durante o push-to-talk, áudio contendo "Ei, amigo" **não** dispara; ao soltar, o disparo volta a funcionar. Os dois lados testados.
3. **Turno ocupado recusa com sinal.** Em `gravando`, `transcrevendo` e `pensando`, o disparo não abre turno e o sinal aparece. **Contrafactual:** turno enfileirado ou sobreposto reprova.
4. **Barge-in funciona.** Em `falando`, o disparo interrompe a reprodução e abre turno novo; o teste afirma que a fonte de áudio foi encerrada, não que o rótulo mudou. **Contrafactual:** legenda mudando com o Piper ainda tocando reprova.
5. **O app não se auto-dispara.** Reproduzir pelo Piper uma resposta que contém "Ei, amigo" **não** dispara a detecção. Este é o critério que justifica a supressão existir — sem ele, a decisão do PI de interromper por voz não se sustenta.
6. **Estado único.** Mascote, legenda e indicador leem a mesma máquina de estados; o teste força cada transição e afirma as três superfícies. **Contrafactual:** superfície com estado próprio, divergindo da máquina, reprova.
7. **`escutando` é visível.** Com a escuta ativa, o mascote está no estado `escutando`. **Contrafactual:** escuta ativa com o mascote em `ocioso` reprova (é o indicador permanente da F01).
8. **Timeout vale para os dois gatilhos** — turno aberto por voz encerra no teto configurado.
9. **Troca de dono do microfone é auditada**, com hash-chain válida.
10. **Desenho por quadro escreve por `ref`, nunca `setState`** — regra cravada pela M17-F04 e regredida uma vez na M17-F05; a guarda vale para o novo estado.
11. `npm run lint`, `npm run typecheck` e `npm test` verdes; **prova visual do estado `escutando`** nos dois temas e com movimento reduzido; evidência em `reports/TESTS.md` por SPEC/issue, com a **latência do barge-in medida** (fim da wake word → TTS silenciado) na máquina do PI.

## Perguntas resolvidas pelo PI (2026-09-10)

1. **Durante a fala do JARVIS:** interromper por voz, com supressão do próprio áudio. — decidido.
2. **Push-to-talk com a escuta ligada:** o push-to-talk sempre ganha; a detecção suspende enquanto o botão está pressionado. — decidido.
3. **Disparo com turno em andamento:** ignora e sinaliza; nada é enfileirado. — decidido.
4. **Estado visual:** `escutando` é estado próprio do mascote, não um sinal discreto no `ocioso`. — decidido.

## Leitura do Cowork sobre a fronteira entre as decisões 1 e 3 (o PI pode vetar)

As decisões 1 e 3 se encostam: `falando` também é turno em andamento. A leitura cravada aqui é a que preserva as duas — **o disparo é recusado enquanto o turno está sendo formado (`gravando`, `transcrevendo`, `pensando`) e aceito depois que a resposta já está saindo (`falando`)**. O motivo é o comportamento útil: cortar o próprio pensamento pela metade não serve a ninguém, mas interromper uma resposta longa é exatamente o que "interromper por voz" quer dizer. Se o PI quiser o contrário — recusa também durante a fala —, a decisão 1 perde a razão de existir e a supressão do próprio áudio vira só proteção contra auto-disparo.

## Decisões cravadas pelo Cowork (coerentes com as anteriores; o PI pode vetar)

- **Push-to-talk sobre turno de voz aberto:** o botão assume a captura e o turno em curso é **encerrado como cancelado, com sinal** — não descartado em silêncio nem transcrito pela metade.
- **Supressão por referência do sinal reproduzido** (o PCM que o app mandou tocar), não por AEC de sala — a fronteira está declarada em § Fora.
- **A máquina de estados vive no main** e é projetada para o renderer, para que a escuta global não dependa da rota ativa.

## Riscos e limites declarados

- **A supressão do próprio áudio é o ponto frágil desta fatia.** Ela depende de o app conhecer exatamente o que está tocando; qualquer caminho de reprodução que escape dessa referência reabre o auto-disparo. O critério 5 existe para pegar isso, e o teste do PI no app real é o que vale.
- **O barge-in só se prova ouvindo.** Latência entre falar e o silêncio do Piper é percepção, não número de bancada: exige a máquina do PI.

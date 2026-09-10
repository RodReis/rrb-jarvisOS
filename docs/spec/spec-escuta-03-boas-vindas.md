# SPEC-Escuta-03 — Modo Boas-Vindas

- MVP/Fatia: MVP-018 · M18-F03 — fecha o núcleo do MVP-018.
- Issue: a criar quando esta SPEC chegar à `main`; épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Status: **aprovada-pi** (2026-09-10) — seis perguntas resolvidas pelo PI nesta data, nenhuma em aberto.
- Fila: **não altera `next`.** A construção corrente é a M10-F01 ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)).
- Depende de: **M18-F01** (serviço de escuta, kill switch, `powerMonitor` já observado) e **M18-F02** (máquina de estados e dono do microfone). Também M17-F02 (Piper) e M17-F03 (persona no ponto único).
- Não depende de: MVP-019 (briefing), MVP-020 (Spotify), MVP-021 (câmera).

## Objetivo

Até aqui o JARVIS só fala quando é chamado. Esta fatia dá a ele **um momento em que fala primeiro**: você chega, destrava a máquina, e ele saúda — no tom da persona, com música se você quiser. É a primeira vez no projeto em que o app toma a iniciativa, e por isso metade desta SPEC é sobre **quando ele deve calar a boca**.

## Escopo

### Dentro

- **Gatilho: o primeiro desbloqueio do dia.** `unlock-screen` do `powerMonitor` (o mesmo sinal que a F01 já observa), com "dia" pela data local e o estado persistido entre sessões. Sem câmera, sem sensor: o desbloqueio é o sinal de chegada que existe hoje.
- **Saudação falada pela persona, com queda para frase fixa.** A saudação passa pelo ponto único de IA (Qwen3 local, persona da M17-F03) recebendo **hora** e **tempo desde a última sessão**. Se o modelo estiver indisponível ou passar de um **teto de tempo configurável**, cai numa **frase fixa editável em Settings**, sorteada por faixa de horário. Chegada nunca fica muda, e nunca fica pendurada esperando o Ollama.
- **Mídia local na chegada.** Um arquivo ou pasta escolhido em Settings toca no dispositivo de saída da M17-F05, depois da saudação. Local, sem conector, sem credencial, sem OAuth — **o Spotify é o MVP-020**, e quando chegar vira mais uma ação do mesmo ponto. Desligável em Settings.
- **Evento `boas-vindas` publicado**, com hora e duração da ausência, **sem consumidor obrigatório**. O MVP-020 se inscreve depois sem tocar nesta fatia. O evento é testável hoje: o teste afirma a publicação.
- **As quatro guardas, todas dentro desta fatia:**
  - **Janela de horário** configurável — fora dela, não saúda.
  - **Respeita o kill switch da escuta** — escuta desligada, sem saudação. Um interruptor só para "não me fale agora".
  - **Silêncio se houver áudio tocando** — se o sistema já reproduz som (chamada, vídeo, música), ele não fala por cima.
  - **Teto de uma saudação por período do dia** — invariante do serviço, independente de quantas vezes você destravar.
- **Tudo desligável.** O Modo Boas-Vindas inteiro tem um liga/desliga próprio, além de obedecer ao kill switch da escuta.

### Fora

- **Cronograma de atividades configurável** — sequência de várias ações, com ordem, condições, Policy Engine e aprovação: é a **M18-F04**, decisão do PI de 2026-09-10. Esta fatia entrega saudação + uma ação de mídia local, nada mais.
- **Spotify e qualquer conector** — MVP-020.
- **Briefing** (agenda, e-mail, resumo do dia) — MVP-019.
- **Presença por câmera** — MVP-021.
- **Saudação com o app fechado** — a escuta e o serviço exigem o app rodando (fronteira herdada da F01).

## A fronteira que esta fatia não cruza

O MVP-017 cravou que **conversa por voz não executa ação**. Tocar mídia local aqui **não** abre essa porta, e a diferença precisa estar escrita: a reprodução é do **próprio app**, sobre um arquivo que **o PI escolheu antes, em Settings**, disparada por um **evento do sistema operacional** — não por algo que alguém falou. Nenhum caminho desta fatia lê intenção de fala e a transforma em efeito. Quando o cronograma da M18-F04 chegar, é ele quem carrega o Policy Engine e a aprovação.

## Critérios de aceite

1. **Dispara no primeiro desbloqueio do dia** e **não** no segundo. Teste com `powerMonitor` dublado, dois desbloqueios no mesmo dia local e um no dia seguinte.
2. **Persona primeiro, frase fixa depois:** com o ponto único respondendo, a saudação é a gerada; com o modelo indisponível **ou** estourando o teto de tempo, sai a frase fixa. Os três caminhos testados. **Contrafactual:** saudação silenciosa quando o Ollama está fora reprova.
3. **A saudação recebe hora e tempo de ausência** — o teste afirma o que foi enviado ao ponto único, não só que houve chamada.
4. **Janela de horário:** fora da faixa configurada, não saúda. **Contrafactual:** saudação às 3h com a janela em 6h–23h reprova.
5. **Kill switch da escuta desligado ⇒ sem saudação.** Uma chave, um comportamento.
6. **Áudio do sistema tocando ⇒ silêncio.** O teste simula reprodução ativa e afirma que nada foi falado nem tocado.
7. **Teto por período respeitado** mesmo com vários desbloqueios.
8. **Mídia local toca no dispositivo de saída escolhido** (preferência da M17-F05), depois da saudação, e o desligar em Settings vale na chegada seguinte. **Contrafactual:** tocar no dispositivo padrão do SO ignorando a preferência reprova — foi exatamente o defeito que originou a M17-F05.
9. **O evento `boas-vindas` é publicado** com hora e duração da ausência, mesmo sem nenhum consumidor inscrito.
10. **Nada de ação por fala:** guarda de fonte prova que o disparo veio do `powerMonitor`, não de transcrição. **Contrafactual:** abrir este caminho a partir de um turno de voz reprova.
11. `npm run lint`, `npm run typecheck` e `npm test` verdes; evidência em `reports/TESTS.md` por SPEC/issue; **verificação real do PI**: chegar, destravar e ser recebido.

## Perguntas resolvidas pelo PI (2026-09-10)

1. **Gatilho:** primeiro desbloqueio do dia. — decidido.
2. **Conteúdo falado:** persona com queda para frase fixa. — decidido.
3. **Guardas:** as quatro — janela de horário, respeita o kill switch, silêncio com áudio tocando, teto por período. — decidido.
4. **Gancho para o MVP-020:** evento publicado, sem consumidor. — decidido.
5. **Música:** **local agora, Spotify no MVP-020.** O PI pediu música na chegada; antecipar o conector traria OAuth, Vault, Policy Engine e rate limit para dentro de uma fatia de saudação, e duplicaria o MVP-020. — decidido.
6. **Cronograma de atividades configurável:** **fatia própria (M18-F04), depois desta.** — decidido.

## Decisões cravadas pelo Cowork (coerentes com as anteriores; o PI pode vetar)

- **"Dia" pela data local**, não por janela de 24 h — chegar às 23h50 e de novo às 8h são dois dias.
- **Ordem fixa:** saudação primeiro, mídia depois. Música por cima da própria fala é o defeito que a guarda 3 evita em outros casos.
- **O teto por período é invariante do serviço**, não uma segunda regra de gatilho: com "primeiro desbloqueio do dia" ele já está satisfeito, mas continua valendo quando a M18-F04 acrescentar outros gatilhos.
- **Teto de tempo da persona configurável em Settings**, ao lado do limiar da F01.

## Riscos e limites declarados

- **Falar primeiro é a decisão mais fácil de odiar depois.** As quatro guardas e o liga/desliga próprio existem porque a chance de isso incomodar é alta — e o veredito é o uso, não a suíte.
- **O desbloqueio é um proxy de chegada, não chegada.** Destravar depois de uma reunião na sala ao lado conta como chegada; a câmera do MVP-021 é o que resolve isso de verdade.
- **A saudação pela persona custa segundos** — a M17-F03 mediu 2,9 s no app real. O teto de tempo e a frase fixa existem por isso; se a chegada ficar lenta na prática, o default do teto se ajusta sem mudar contrato.

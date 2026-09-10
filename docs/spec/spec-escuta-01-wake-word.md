# SPEC-Escuta-01 — Engine de wake word local, global nos dois espaços

- MVP/Fatia: MVP-018 · M18-F01 — abre o MVP-018. Épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Status: **aprovada-pi** (2026-09-10) — nove perguntas resolvidas pelo PI nesta data, nenhuma em aberto. A issue-fatia nasce quando esta SPEC chegar à `main`.
- Fila: **não altera `next`.** A redação foi aberta em paralelo por decisão do PI de 2026-09-10; a construção corrente é a M10-F01 ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)). Aprovar esta SPEC habilita o Backlog, nada mais.
- Depende de: **MVP-017 (fechado em 2026-09-10)** — M17-F01 (sidecar Python gerenciado, caminho de download auditado, `globalShortcut`), M17-F02 (Piper, usado aqui para gerar o dataset de treino), M17-F05 (preferência de dispositivo com `deviceId: { exact }` e medidor de nível), M22-F01 (registro de módulos). MVP-001 (`AuditEvent`/hash-chain) e MVP-003 (design system).
- Decisões que sustentam esta SPEC: decisões do PI de 2026-08-30 (épico #194) e de 2026-09-10 (§ Perguntas resolvidas); regras invioláveis do `CLAUDE.md`; ARCHITECTURE (local é fonte de verdade operacional).

## Objetivo

Trocar o gatilho da conversa. Hoje o loop de voz do MVP-017 começa com um ato explícito — segurar o botão ou a hotkey. Esta fatia entrega a detecção local da frase **"Ei, amigo"**, contínua e global nos dois espaços, que abre exatamente o mesmo loop: mesma `SttEngine`, mesmo ponto único de IA, mesmo Piper. **Nenhuma engine nova de conversa nasce aqui** — só o gatilho, e o controle explícito que microfone sempre aberto exige.

## Escopo

### Dentro

- **Interface `WakeWordEngine`** no main — contrato mínimo `start(fonte) / stop()` e evento `detectado({ confianca, fimDaFraseMs })` — com openWakeWord como primeira implementação, **injetada**: trocar de engine é configuração, não refatoração. Nenhum import do engine concreto fora da implementação (guarda de lint, como a `SttEngine` da M17-F01).
- **Modelo próprio, treinado fora do app.** O openWakeWord é Apache 2.0 no código, mas seus modelos pré-treinados são **CC BY-NC-SA 4.0 (não comercial)** — nenhum deles entra aqui. O modelo de "Ei, amigo" é treinado com áudio sintético gerado pelo **Piper que o app já embarca desde a M17-F02**, mais dataset de fundo, e o `.onnx` resultante é artefato do projeto, sem restrição de licença.
- **Dataset negativo dirigido, obrigatório.** "Amigo" é palavra corrente em pt-BR: o treino inclui negativos com **"amigo" isolado**, **frases contendo "amigo" sem "ei"** e **"ei" sem "amigo"**. Sem esses negativos, o modelo não é aceito.
- **Distribuição do modelo:** artefato versionado, **baixado no 1º uso com SHA-256 pinado**, `AuditEvent` antes e depois, allowlist de URL — exatamente o caminho já provado pela M17-F01 para o runtime Python e o modelo Whisper. Artefatos em `userData/models/wake/`. Hash divergente rejeita, apaga e informa.
- **Captura contínua no renderer** via `getUserMedia` com o `deviceId: { exact: … }` da preferência persistida pela M17-F05, 16 kHz mono PCM, enviada ao main por IPC tipado. A fronteira renderer/Node permanece intacta.
- **Áudio nunca persiste e nunca sai antes do disparo.** A escuta mantém em memória um buffer circular curto (pré-roll), continuamente descartado; nada vai a disco, nada vai à rede, e o ponto único de IA só é chamado depois que a fala pós-wake-word é transcrita.
- **Serviço global, não uma tela.** A escuta vive no main e independe da rota ativa: funciona nos dois espaços (JARVIS OS e NOA), com a janela minimizada, em segundo plano e **com a sessão bloqueada**.
- **Ao disparar, com a sessão desbloqueada:** a janela sobe e vai para a tela do Command Center — mascote, ondas e legenda visíveis enquanto o PI fala.
- **Ao disparar, com a sessão bloqueada:** a janela **não** sobe. A lock screen do Windows é outra sessão, e subir a janela exporia a conversa a quem passasse. O JARVIS responde **só por voz** (Piper) e o turno entra no histórico do Command Center, visível ao destravar. Estado de bloqueio lido do `powerMonitor` do Electron.
- **Controle explícito do microfone aberto — os quatro, dentro desta fatia:**
  - **Kill switch sempre alcançável** na interface (não enterrado em Settings), com estado persistido entre sessões.
  - **Indicador permanente** enquanto a escuta está ativa. Microfone aberto em silêncio visual é defeito, não economia de pixel.
  - **`AuditEvent` ao ligar e ao desligar** a escuta, por qualquer caminho (interface, hotkey, restauração de estado).
  - **Hotkey global de mute**, configurável em Settings e auditada na mudança, ao lado da hotkey de push-to-talk da M17-F01.
- **Sensibilidade ajustável em Settings, com teste ao vivo:** limiar configurável, valendo na detecção seguinte sem restart, e um modo de teste que mostra cada disparo com a confiança medida, reusando o medidor de nível entregue pela M17-F05.
- **Cancelamento por silêncio:** disparo sem fala em seguida volta a `ocioso` sem chamar o ponto único de IA.

### Fora

- **Arbitração wake word ↔ push-to-talk e os estados do microfone** — é a M18-F02. Aqui a escuta e o push-to-talk coexistem pelo caminho mais simples que não corrompe estado; a política de precedência é da F02.
- **Modo Boas-Vindas** (saudação por horário/chegada) — M18-F03.
- **Executar ação por voz.** O invariante do MVP-017 continua de pé: conversa por voz não executa ação. Wake word muda quem abre o turno, não o que o turno pode fazer.
- **Treino dentro do app** — 1-2 h de CPU, resultado não determinístico e improvável de provar em teste. O treino é passo da entrega, não do runtime.
- **Escuta com o app fechado** (serviço de SO, autostart) — a escuta exige o app rodando. Se virar requisito, é fatia própria.
- **Transcrição parcial em streaming** — segue fora, como na M17-F01.

## Critérios de aceite

1. `WakeWordEngine` é interface injetada no main; a tela e o fluxo não conhecem o engine concreto (teste com dublê); nenhum import de openWakeWord fora da implementação (guarda de lint).
2. **"Ei, amigo" dispara** — teste afirma o evento a partir de áudio de referência. **Contrafactual obrigatório:** áudio de "amigo" isolado e de frase contendo "amigo" sem "ei" **não** disparam no limiar default; se disparassem, o teste reprova.
3. **Nenhum áudio sai antes do disparo:** com a escuta ativa e nenhuma wake word falada, a rede interceptada conta **zero** requisição; o buffer circular é descartado e não cresce.
4. **Nenhum áudio em disco:** após uma sessão de escuta, a varredura de `userData` não encontra arquivo de áudio.
5. **Download do modelo:** 1º uso oferece o download com progresso; hash divergente rejeita, apaga e informa; `AuditEvent` antes e depois; `verifyAuditChain` → `ok`. Os dois caminhos testados.
6. **Sessão desbloqueada:** o disparo traz a janela à frente já na tela do Command Center. Verificação no app real.
7. **Sessão bloqueada:** o disparo **não** sobe janela, a resposta sai por voz, e o turno aparece no histórico ao destravar. Teste com `powerMonitor` dublado nos dois estados, mais verificação real do PI. **Contrafactual:** subir a janela com a sessão bloqueada reprova.
8. **O kill switch desliga a captura de fato** — o teste afirma que o stream foi encerrado, não que o rótulo mudou. **Contrafactual:** manter o stream aberto e só trocar o estado reprova. (Lição direta da M17-F05: teste que mede o rótulo não prova o dado.)
9. **Indicador permanente:** com a escuta ativa, o indicador está renderizado. **Contrafactual:** escuta ativa sem indicador reprova.
10. **`AuditEvent` ao ligar e desligar** por qualquer caminho — interface, hotkey e restauração do estado persistido —, com hash-chain válida.
11. **Hotkey global de mute** corta a escuta com a janela minimizada; trocar o atalho em Settings é auditado.
12. **Limiar de Settings vale na detecção seguinte, sem restart**; o modo de teste exibe a confiança medida de cada disparo.
13. **Silêncio após o disparo volta a `ocioso`** sem chamar o ponto único de IA. **Contrafactual:** chamada ao LLM em disparo sem fala reprova.
14. **Custo da escuta medido, não estimado:** CPU e memória da escuta contínua registradas no relatório, na máquina do PI (Ryzen 7 9800X3D + RTX 5060 8GB).
15. `npm run lint`, `npm run typecheck` e `npm test` verdes; prova visual do indicador e do kill switch nos dois temas e com movimento reduzido; **latência medida** entre o fim da wake word e o início da captura para STT, e evidência em `reports/TESTS.md` por SPEC/issue.

## Perguntas resolvidas pelo PI (2026-09-10)

1. **Engine:** openWakeWord. O Porcupine foi descartado por fato externo — a Picovoice encerrou o free tier em **2026-06-30** e o SDK não opera sem AccessKey válida, validada contra a nuvem, o que contraria o invariante "100% local". — decidido.
2. **Modelo:** próprio, treinado com áudio sintético do Piper, em vez dos pré-treinados CC BY-NC-SA. — decidido.
3. **Palavra de ativação:** **"Ei, amigo"**. — decidido.
4. **Quando escuta:** sempre que o app estiver rodando, inclusive minimizado, em segundo plano e com a máquina bloqueada. — decidido.
5. **Com a sessão bloqueada:** responde só por voz; a janela não sobe; a conversa aparece ao destravar. — decidido.
6. **Com a sessão desbloqueada:** o disparo traz o Command Center à frente. — decidido.
7. **Distribuição do modelo:** artefato baixado no 1º uso, SHA-256 pinado, pelo mesmo caminho auditado do Whisper e do Piper. — decidido.
8. **Sensibilidade:** ajustável em Settings, com teste ao vivo. — decidido.
9. **Controle do microfone aberto:** kill switch alcançável, indicador permanente, `AuditEvent` ao ligar/desligar e hotkey global de mute — os quatro dentro desta fatia. — decidido.

## Decisões cravadas pelo Cowork (coerentes com as anteriores; o PI pode vetar)

- **Sidecar próprio para a escuta**, sobre o mesmo runtime Python já baixado pela M17-F01. Os ciclos de vida diferem — a escuta vive enquanto estiver ligada, o STT nasce sob demanda — e um crash na transcrição não pode derrubar a escuta.
- **Pré-roll de 1500 ms** em buffer circular, para não decapitar o início da fala que segue a wake word.
- **Cancelamento por silêncio em 3 s** após o disparo, configurável junto do limiar.
- **Estado de bloqueio pelo `powerMonitor`** do Electron (`lock-screen` / `unlock-screen`), e não por heurística de foco de janela.
- **O modelo `.onnx` e o hash são versionados junto da SPEC**, para que retreinar seja mudança rastreável e não substituição silenciosa de artefato.

## Riscos e limites declarados

- **Falso positivo é o risco número um desta fatia.** "Amigo" é palavra corrente em pt-BR, e o PI trabalha falando sobre o próprio projeto. A frase de duas palavras, o dataset negativo dirigido do critério 2 e o limiar calibrável são a mitigação — mas o veredito real é o uso na sala do PI, não a suíte.
- **Microfone aberto com o PI ausente** é consequência aceita da decisão 4. O kill switch, o indicador permanente e a hotkey de mute existem por causa dela.
- **O teste físico do PI é obrigatório** e não é substituível por código de saída zero: disparo real com a voz dele, comportamento real com a máquina bloqueada, e o custo de CPU da escuta contínua medido em uso, não em bancada.

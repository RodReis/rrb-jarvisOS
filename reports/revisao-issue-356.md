# Revisão da issue #356 — 2026-10-03

Estado da revisão inicial: **FIX_REQUIRED**. As correções foram entregues na
[PR #383](https://github.com/RodReis/rrb-jarvisOS/pull/383), mergeada em
2026-10-04 (`b7a27b6`); os nove jobs do CI passaram no SHA final `3f226a2`.
A issue foi aceita pelo PI via ProPlan e fechada em 2026-10-04; a trilha do
GitHub registra o comentário “proplan: finalizado pelo PI em 2026-10-04”.

## Decisão do PI nesta revisão

- Dois gatilhos configuráveis em Settings: **"Ei, amigo"** e **duas palmas seguidas**.
- A escuta contínua começa ligada após instalar um modelo válido.
- Ambos abrem o mesmo loop de voz; um disparo durante turno ativo deve ser ignorado.
- O PI substituiu a escolha original do openWakeWord por um detector próprio, incluindo
  extração de características e classificador sem pesos auxiliares de terceiros.
- O PI autorizou usar as três gravações fornecidas para ajustar o classificador distribuído.
  Os M4A não entram no repositório; o modelo resultante é publicável na PR. A avaliação
  nesses mesmos arquivos passa a ser checagem de regressão, não validação independente.

## Bloqueadores medidos

1. O `ei_amigo.onnx` original é um classificador de log-mel com entrada de 32 features.
   A API do openWakeWord exige embeddings de 96 features. Instanciá-lo na biblioteca não
   comprova compatibilidade: a primeira inferência falha com `ValueError`.
2. Pelo sidecar original, reamostrando os WAVs de 22.050 Hz para 16.000 Hz e avaliando
   janelas de 1,5 s a cada 250 ms, o limiar 0,5 produziu máximo **1,0000** para
   `ei_amigo_ref.wav`, **0,9997** para `amigo_isolado_ref.wav` e **0,9998** para
   `meu_amigo_ref.wav`. O modelo não separa a frase dos negativos exigidos pela SPEC.
3. O SHA-256 do arquivo original é `1af65e1d086e0f505474697c671b8647083542ccb29d456e0ca11537381021f8`;
   o catálogo declara `22ffd34393b4cbf7a9124f6878a817d6b9dbca3735a278c0ccf7df27d700d0a9`.
   A URL usa `main`, que é mutável e ainda não contém o artefato.
4. A implementação original não tem captura contínua, integração com o loop de conversa,
   kill switch, indicador, hotkey de mute, auditoria ou comportamento com a sessão bloqueada.
5. O openWakeWord usa `melspectrogram.onnx` e `embedding_model.onnx` além do classificador
   próprio. O README declara CC BY-NC-SA para modelos pré-treinados; a aplicação dessa
   cláusula aos dois modelos auxiliares continua sem esclarecimento público nas issues
   [#338](https://github.com/dscripka/openWakeWord/issues/338) e
   [#348](https://github.com/dscripka/openWakeWord/issues/348), consultadas em
   2026-10-03. A SPEC presume que nenhum modelo pré-treinado de licença restrita entra
   na distribuição. Não publicar esses binários como se fossem Apache-2.0 sem prova.

## Correções implementadas nesta revisão

- O modelo wake deixou de bloquear a prontidão do STT existente.
- O adapter do detector próprio forma janelas circulares de 2 s e analisa a cada 250 ms;
  o runtime usa apenas `numpy`, `onnxruntime` e código de extração do projeto.
- O detector de duas palmas tem testes de pulso, ruído sustentado, blocos fragmentados e
  fala de referência. **Isto ainda não prova palmas reais no microfone do PI.**
- Os scripts de treino e verificação agora usam somente o extrator log-mel e o classificador
  próprios. O bundle copia o extrator junto do sidecar; o áudio de treino sintético e o áudio
  real do PI não são gravados no repositório.
- O sidecar carrega apenas o classificador ONNX próprio. O candidato final foi
  colocado em `docs/spec/models/ei_amigo.onnx`; o catálogo foi atualizado com a
  revisão imutável do commit `c63d46ac2afc6c4c19deef849e3c8152d957fa8e` e o SHA exato do arquivo.
- O pré-roll de 1,5 s agora fica no stream contínuo do renderer: ao disparar, ele é
  reservado antes da navegação e entregue junto à fala seguinte pelo mesmo microfone.
  O turno não abre segundo `getUserMedia`; falha de navegação ou STT indisponível descarta
  o buffer. Testes dirigidos do empacotador, shell e turno passaram.

## Evidência local até aqui

- `npm run typecheck`: passou após as correções iniciais.
- Testes dirigidos do adapter, buffer e detector de palmas: passaram.
- Validação do modelo original: falhou nos negativos; **não publicar nem integrar** esse modelo.
- Candidato exploratório: treino em 6000 amostras sintéticas, 50 épocas. Pela API real,
  `ei_amigo_ref.wav` = 0,5311, `amigo_isolado_ref.wav` = 0,0140,
  `meu_amigo_ref.wav` = 0,1014 e `ei_voce_ref.wav` = 0,4861, limiar 0,5.
  A margem de 0,045 entre positivo e o negativo mais próximo é insuficiente para
  aceitar falso acionamento em escuta contínua. O candidato fica em diretório temporário.
- Testes dirigidos após a troca do sidecar: 16 passaram.
- Gravações reais fornecidas pelo PI em 2026-10-03, avaliadas fora do repositório
  pela API real do openWakeWord após conversão em memória para PCM 16 kHz mono:
  `Gravando.m4a` ("Ei, amigo") = **0,9999**, `Gravando (2).m4a` ("Amigo") =
  **0,0338**, `Gravando (3).m4a` ("Ei, você") = **0,1117** na execução
  reproduzível de `scripts/verificar-modelo-wake.py`. No limiar 0,5,
  somente a frase positiva acionou. Durações 1,98 s, 1,43 s e 2,15 s.
  Nenhuma das três gravações foi copiada para a árvore do projeto. Essa prova
  não mede falsos acionamentos em horas de escuta nem substitui a prova física
  do app em execução.
- Pilotos do detector próprio treinados apenas com vozes sintéticas falharam nos negativos
  reais, mesmo com variação de ritmo, ruído em toda a janela e normalização de bandas.
  Eles permanecem no diretório temporário. A acurácia com vozes sintéticas não é evidência
  de desempenho com o microfone do PI.

## Candidato final do detector próprio

O classificador de 25 épocas combinou exemplos sintéticos das vozes Faber e
Edresson, sete gravações de referência autorizadas (com e sem recorte de silêncio)
e 1.800 negativos sintéticos difíceis. O ONNX resultante tem SHA-256
`28b6ad9a7e4e747697fa6a315882211f530697235bc5b767fe53efd0e512a6f3`.
No limiar 0,95, as sete referências classificaram corretamente; as três gravações
do PI participaram do treino e esta leitura é apenas regressão. Um conjunto
sintético de outra semente (100 positivos, 500 negativos comuns e 500 negativos
difíceis) teve zero erro nesse limiar. Isso não estima a taxa real de falsos
acionamentos por hora nem a taxa de perda com novas vozes e microfones.

Estado posterior: a captura, controle, IPC, UI, pré-roll, modelo candidato e
prova visual estão no worktree da PR #383. A SPEC revisada registra a decisão
dos dois gatilhos e o detector próprio. Restam a
prova física do PI no app (incluindo sessão bloqueada), CPU/memória/latência,
o relatório do SHA final, novo CI e merge. O candidato não é aceite físico.

Na execução local de 2026-10-04, `npm run lint` e `npm run typecheck`
passaram. Os testes dirigidos do catálogo, serviço, adapter e pré-roll passaram.
`npm test -- --maxWorkers 2` terminou com 4.815 testes aprovados, 24 pulados,
um teste de infraestrutura com timeout de 5 s (`tests/design/fronteira.int-spec.ts`)
e dois workers encerrados inesperadamente; a execução completa **não passou**.
O Docker local não estava disponível, e `npx supabase status` tentou obter o
pacote na rede restrita. A PR precisa de CI limpo no SHA final; esses resultados
locais não substituem o gate.

A revisão do fluxo de primeira instalação achou uma lacuna: o catálogo oferecia o
modelo por IPC, mas Settings não dava acesso ao download. A seção ganhou o
botão de instalação; depois do hash válido, o serviço reavalia a disponibilidade
e liga a escuta quando o padrão é ativo, preservando um kill switch salvo.
Dois testes de regressão cobrem o download e a precedência do kill switch.

O CI do commit `7cdeccc` passou em quality, Regras, Banco, Tela, visual e E2E;
o agregado `test` reprovou porque `reports/TESTS.md` ainda tinha números da base.
Baixei os JSONs e as coberturas daquele run (#37215282527) e regenerei o
relatório: Regras 2619/2619, Banco 1815/1833 (18 pulados), Tela 773/774
(1 todo), zero falha; o anti-drift com `--require-entry` e o self-check passaram.
O código posterior adicionou apenas o registro da latência entre o fim do
gatilho e a reserva do turno, sem testes novos. O valor real ainda depende da
execução física do PI.

## Validação física final — 2026-10-04

O PI confirmou que “Ei, amigo” e duas palmas abriram turnos, responderam por
voz e ficaram no histórico. Repetiu os dois gatilhos com o Windows bloqueado
por Win+L; as respostas saíram por voz e os turnos apareceram após destravar.
A captura do Command Center mostra transcrição e resposta. Esta é evidência
de execução no computador do PI, sem transformar os áudios usados no treino
em validação independente do classificador.

Com o app aberto e a escuta ativa, o processo Python do detector (PID 23196)
acumulou 0,00 s de CPU numa amostra de 15 s (0% de um núcleo), com 64 MB de
memória residente no fim da amostra. A medida é específica do detector;
Electron, STT, Piper e Ollama têm processos separados. Geração de uma resposta
local levou 17,0 s, enquanto três chamadas anteriores levaram 22,4–29,6 s;
a latência percebida é dominada pelo Ollama, não pela transcrição de 0,8–2,1 s.

O teste revelou dois ajustes de produto separados da ativação: a resposta
sobre a hora local foi incorreta e o tratamento “Operador” não corresponde à
preferência do PI. Não são contabilizados como êxito da conversa; exigem
correção rastreada fora desta fatia.

# Revisão da issue #356 — 2026-10-03

Estado: **FIX_REQUIRED**. Esta revisão cobre o trabalho não commitado no branch
`feat/m18-f01-wake-word-local`; não equivale a aceite nem a evidência de CI.

## Decisão do PI nesta revisão

- Dois gatilhos configuráveis em Settings: **"Ei, amigo"** e **duas palmas seguidas**.
- A escuta contínua começa ligada após instalar um modelo válido.
- Ambos abrem o mesmo loop de voz; um disparo durante turno ativo deve ser ignorado.

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

## Correções iniciadas

- O modelo wake deixou de bloquear a prontidão do STT existente.
- O adapter passou a formar janelas circulares de 1,5 s e a validar resposta/limiar.
- O detector de duas palmas tem testes de pulso, ruído sustentado, blocos fragmentados e
  fala de referência. **Isto ainda não prova palmas reais no microfone do PI.**
- Scripts de treino e verificação do modelo pela API real do openWakeWord foram adicionados.
  Só um candidato que passe os negativos e a prova física poderá substituir o artefato original.
- O sidecar passou a usar `openwakeword.model.Model` com blocos PCM de 1280 amostras; a
  parametrização log-mel incompatível foi retirada. O runtime distribuído ainda precisa
  receber as dependências e os modelos auxiliares com hash fixado.

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

Pendente: completar captura/controle/IPC/UI, validar candidato treinado, executar suíte e
prova visual/E2E, medir CPU, memória e latência, obter teste físico do PI, atualizar
`reports/TESTS.md`, abrir PR e verificar o gate. A SPEC aprovada precisa registrar a
decisão posterior de dois gatilhos antes da integração final.

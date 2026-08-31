# SPEC-Voz-02 — TTS Piper e timeline de visemes

- MVP: `docs/mvp/mvp-017-command-center-voz.md` (Fatia 02). Épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Status: **aprovada-pi** (2026-08-30) — quatro perguntas resolvidas pelo PI nesta data. A fatia só entra na fila depois do MVP-009 e a issue-fatia nasce quando esta spec chegar à `main`.
- Dependências: **M17-F01 (#200)** — reusa o runtime Python baixado no 1º uso, o caminho de download auditado (URL fixa + SHA-256 pinado) e o protocolo stdio; MVP-003 (design system). **Independe do MVP-005** — esta fatia não chama LLM.
- Decisões que sustentam esta spec: invariante do épico #193 (lip-sync por **visemes**, nunca por amplitude); SPEC-Voz-01 (sidecar, downloads auditados, áudio nunca persiste); regras invioláveis do `CLAUDE.md` (renderer nunca acessa Node; IPC mínimo e tipado; ação sensível auditada).

## Objetivo

A segunda metade do loop de voz: o app **fala**. Uma interface `TtsEngine` no main, com Piper como primeira implementação, produz duas coisas inseperáveis: o áudio da fala e a **timeline de visemes** que a F04 vai consumir para mexer a boca do mascote. Nenhum texto ou áudio sai da máquina; nenhum áudio persiste em disco.

**O risco técnico central está declarado, não escondido:** o Piper não expõe timestamps por fonema de fábrica — o modelo VITS calcula as durações internamente, mas o ONNX padrão só devolve áudio. A fatia ataca isso por spike com fallback (decisão do PI, § Perguntas resolvidas).

## Escopo

### Dentro

- **Interface `TtsEngine`** no main — `speak(texto, voz) → SpeechHandle` — com Piper como primeira implementação, **injetada**; nenhum import do engine concreto fora da implementação. O `SpeechHandle` carrega o áudio (PCM + sample rate), a `VisemeEvent[]` e `cancel()`.
- **Contrato `VisemeEvent`** em `src/shared/domain/`: `{ viseme, startMs, endMs }`, com conjunto **reduzido** de visemes (~12–15 formas de boca). O mapa fonema (espeak IPA) → viseme é **dado versionado** (arquivo) dentro desta fatia — a F04 não conhece fonema, só viseme.
- **Spike (passo 1 do DEVELOPMENT da fatia):** expor as durações reais do VITS — re-export do ONNX com saída de durações ou leitura do duration predictor no runtime Python. **Timebox = o próprio passo**: não fechando, o Code registra o achado em `reports/` e ativa o plano B; insistir no caminho exato além do passo vira pergunta ao PI.
- **Plano B:** fonemização espeak-ng (a mesma que o Piper usa) + durações **estimadas**, distribuídas proporcionalmente pela duração **real** do áudio gerado (âncora nas bordas, pesos por classe de fonema). Os dois caminhos entregam a **mesma** `VisemeEvent[]` — o consumidor não sabe qual está ativo; qual caminho está ativo aparece no log (categoria `sistema`).
- **Sidecar TTS em processo próprio** sobre o runtime Python da F01: `piper-tts` + dependências entram nos wheels pinados (SHA-256) baixados no 1º uso — uma mecânica de distribuição só, nenhum binário nativo à parte. Mesmo protocolo stdio JSON-por-linha com timeout; mesmo ciclo de vida da F01 (sob demanda, morre com o app, um restart automático, crash nunca derruba o app). Processo **separado** do STT: crash de um não interrompe o outro, e o TTS roda em CPU sem disputar a GPU do Whisper.
- **Vozes pt-BR (decisão do PI: escolher ouvindo):** a fatia entrega **2–3 vozes** do catálogo Piper baixáveis com hash pinado — `pt_BR-faber-medium` e `pt_BR-edresson-low` como mínimo; uma terceira só se o catálogo tiver qualidade equivalente (verificação na implementação, não promessa). **Preview em Settings** (frase padrão em cada voz instalada) e o default é escolhido pelo PI ouvindo. Sem voz baixada → estado com ação de baixar (padrão F01). Artefatos em `userData/models/`; downloads pelo mesmo caminho auditado da F01 (`AuditEvent` antes/depois, hash divergente rejeita e apaga).
- **Síntese em bloco** (decisão do PI): `speak()` sintetiza o texto completo e então toca. Sem síntese por sentença nesta fatia.
- **Reprodução no renderer** por Web Audio (Web API — fronteira renderer/Node intacta): o PCM atravessa por IPC tipado; `cancel()` interrompe síntese e reprodução; **uma fala por vez** — nova fala cancela a anterior.
- **UI mínima da fatia:** estado “falando” + ação de parar; preview de voz em Settings. Waveform e histórico são F05; a boca do mascote é F04.

### Fora

- **Síntese por sentença / streaming de fala** — decisão do PI (2026-08-30): tudo de uma vez nesta fatia. **Consequência registrada:** quando a F03 (resposta do LLM em stream) e o briefing do MVP-019 precisarem de fala incremental, o contrato evolui — retrabalho aceito nessa decisão; a mitigação barata está cravada abaixo (handle, não blob).
- Persona/chamada de LLM (F03); mascote e animação da boca (F04 — consome a `VisemeEvent[]`, não nasce aqui); wake word (MVP-018).
- Vozes cloud (ElevenLabs/Gemini-TTS) — fora por decisão do épico; se voltarem, é implementação nova da mesma `TtsEngine`.
- **Clonagem de voz própria** (“voz Jarvis” treinada) — fora; registrada como possível fatia futura atrás da mesma interface.
- Fila/arbitragem de múltiplas falas (anúncio proativo interrompendo conversa) — MVP-019/F03; aqui vale só “nova fala cancela a anterior”.

## Critérios de aceite

1. `TtsEngine` é interface injetada no main; nenhum import de piper fora da implementação (guarda de lint, padrão M5-F02/M17-F01). Teste com dublê prova que fluxo e tela não conhecem o engine concreto.
2. `speak()` de uma frase em pt-BR devolve áudio **e** `VisemeEvent[]` não-vazia: eventos ordenados, sem sobreposição, primeiro `startMs` ≈ 0 e último `endMs` ≈ duração do áudio (tolerância definida no teste). Teste.
3. **O caminho da timeline é observável:** exato (durações do VITS) ou plano B (estimativa) aparece no log e no relatório; se o plano B estiver ativo, o achado do spike está registrado em `reports/` com o motivo. Contrafactual: trocar o caminho não muda o tipo consumido nem quebra consumidor.
4. Sidecar TTS é processo próprio: matar o processo do TTS no meio de uma fala → erro tratado com próxima ação e a tentativa seguinte funciona; o STT continua respondendo durante a falha (e vice-versa). Teste.
5. Vozes baixáveis com SHA-256 pinado, `AuditEvent` antes/depois e `verifyAuditChain` → `ok`; hash divergente rejeita e apaga; preview em Settings toca a frase padrão em cada voz instalada e o default é configurável. Teste dos dois caminhos + verificação no app real.
6. Reprodução no renderer via Web Audio com PCM por IPC tipado; a guarda de enumeração da ponte acusa os canais novos; nenhum canal expõe processo, path de modelo ou comando.
7. `cancel()` interrompe síntese e reprodução; iniciar nova fala cancela a anterior — nunca duas falas simultâneas (teste conta fontes de áudio ativas).
8. **Nenhum áudio sintetizado persiste em disco** — mesma régua da F01: após uma sessão de uso (incluindo previews), varredura de `userData` não encontra arquivo de áudio.
9. `npm run dev`, `npm run test`, `npm run lint` verdes; evidência em `reports/TESTS.md`, incluindo a **latência medida** (texto de uma frase → início do áudio) na máquina do PI.

## Perguntas resolvidas pelo PI (2026-08-30)

1. **Timeline de fonemas:** spike com fallback — passo 1 tenta expor as durações reais do VITS; estourando o timebox, plano B (espeak-ng + estimativa ancorada na duração real do áudio) atrás do mesmo contrato. — decidido.
2. **Voz default:** escolhida **ouvindo no app** — a fatia entrega 2–3 vozes pt-BR baixáveis com preview em Settings; o default é decisão do PI ao ouvir. — decidido.
3. **Execução do Piper:** runtime Python da F01, em **processo próprio** (isolamento de crash; CPU, sem disputar a GPU do Whisper). — decidido.
4. **Síntese:** em bloco (tudo de uma vez); streaming por sentença fica para quando a F03/MVP-019 precisarem, com a mudança de contrato aceita. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`speak()` devolve um handle, não um blob.** A síntese é em bloco (decisão do PI), mas os consumidores recebem `SpeechHandle` com `cancel()` e eventos — quando o streaming vier, a evolução acontece na implementação do handle, não na assinatura que F03/F04/F05 já consomem. É a mitigação barata do retrabalho aceito, sem contrariar a decisão 4.
- **Mapa fonema→viseme como dado versionado** (~12–15 visemes) dentro da F02; a F04 só vê visemes.
- **Plano B ancorado no áudio real:** as durações estimadas são distribuídas pela duração medida do áudio gerado — nunca durações absolutas soltas, que dessincronizariam no fim da frase.
- **Timebox do spike = o passo 1 do DEVELOPMENT:** estourou, o plano B entra e continuar no caminho exato vira pergunta ao PI — a fatia nunca trava no spike.
- **Uma fala por vez** nesta fatia; fila e prioridade de falas são da F03/MVP-019.
- **Candidatas de voz:** `pt_BR-faber-medium` e `pt_BR-edresson-low` como mínimo verificável; terceira condicionada à qualidade do catálogo.

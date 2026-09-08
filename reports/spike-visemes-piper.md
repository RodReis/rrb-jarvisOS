# Spike da M17-F02 — as durações por fonema saem do Piper?

Passo 1 da SPEC-Voz-02 (`docs/spec/spec-voz-02-tts-piper-fonemas.md`), executado em 2026-09-08.
A spec declara o risco central: *"o Piper não expõe timestamps por fonema de fábrica — o modelo
VITS calcula as durações internamente, mas o ONNX padrão só devolve áudio"*, e manda tentar o
caminho exato com timebox, caindo no plano B (espeak-ng + estimativa) se estourar.

## Veredito

**O caminho exato está disponível e o plano B não é necessário para a voz default.**

O `piper-tts` 1.8.0 já traz o que a spec descrevia como trabalho do spike ("re-export do ONNX com
saída de durações"): `PiperVoice.load(..., include_alignments=True)` faz o patch do grafo ONNX
**em memória** — sem gravar modelo patcheado em disco — e `synthesize(..., include_alignments=True)`
devolve `PhonemeAlignment { phoneme, phoneme_ids, num_samples }` por fonema.

A premissa da spec estava certa para o Piper de quando ela foi escrita, e **desatualizada** para a
versão atual. O spike não precisou do timebox inteiro.

## Como foi medido

Ambiente descartável (venv fora do repositório), `piper-tts==1.8.0` + `onnx==1.22.0`,
`onnxruntime==1.29.0`, CPU. Voz `pt_BR-faber-medium` baixada do `rhasspy/piper-voices`.

`num_samples` por fonema, somado, contra o número de amostras do áudio gerado:

| Frase | Eventos | Cobertura | Áudio |
|---|---:|---:|---:|
| `Bom dia.` | 15 | 100,00% | 627 ms |
| `A geração terminou com sucesso, coração.` | 54 | 100,00% | 2450 ms |
| `O PR 340 está verde: 3 jobs passaram em 2m34s.` | 117 | 100,00% | 4876 ms |
| `Atenção! Não há espaço em disco — 0%.` | 65 | 100,00% | 2972 ms |
| `Rodrigo, você tem 5 cards no board e nenhum em andamento?` | 76 | 100,00% | 3146 ms |
| `e-mail, TTS, JSON, SHA-256.` | 73 | 100,00% | 3576 ms |
| `a` | 4 | 100,00% | 313 ms |
| `` (vazio) | — | — | nenhum chunk |

Cobertura de 100,00% em todas: as durações **somam exatamente** o áudio, não aproximadamente. É a
âncora que o critério 2 pede (primeiro `startMs` ≈ 0, último `endMs` ≈ duração do áudio) saindo de
graça, sem a redistribuição proporcional que o plano B precisaria.

Latência com a voz já carregada: **71–101 ms** de síntese para uma frase de ~3,5 s de áudio. O
`load` custa ~1,2 s e acontece uma vez — é o que justifica o sidecar sob demanda e reusado, igual
ao STT da F01.

## Três achados que mudam a implementação

### 1. O alinhamento falha em silêncio, e uma das vozes candidatas cai nele

`pt_BR-edresson-low`, a **segunda candidata mínima da spec**, devolve **zero eventos** com
`include_alignments=True` — e sem erro. O log é `Missing phoneme from id map: ̃` (o til
combinante), e em `piper/voice.py` um fonema fora do `phoneme_id_map` marca `alignment_failed`,
que zera a lista inteira: `phoneme_alignments = None`, com um `_LOGGER.debug` como único sinal.

Consequência direta para o critério 3: **a implementação não pode confiar que pediu alinhamento e
recebeu**. Uma lista vazia é indistinguível de "esta voz não suporta", então o caminho ativo
(exato ou plano B) precisa ser decidido **olhando o retorno**, não a intenção — e é isso que o log
e o relatório devem registrar. Isto também é a razão de o plano B continuar existindo apesar do
veredito: ele é o caminho da `edresson`, não um plano morto.

### 2. `include_alignments` mora em **dois** lugares

`PiperVoice.load()` e `voice.synthesize()` têm cada um o seu, ambos default `False`. Passar só no
`load` devolve **zero eventos sem erro** — foi exatamente o primeiro resultado deste spike, e por
alguns minutos ele disse "caminho exato indisponível". O patch do ONNX tinha funcionado
(`add_alignment_output` → tensor `/Ceil_output_0`); o que faltava era o segundo parâmetro.

Um teste que verificasse só "a lista veio vazia → plano B" teria carimbado o plano B como
necessário, com o caminho exato funcionando o tempo todo.

### 3. O IPA quebra o stdout do sidecar no Windows

Imprimir os fonemas estourou `UnicodeEncodeError: 'charmap' codec can't encode character 'ˈ'`
— o acento primário do IPA. É a mesma armadilha do `sidecar-stt.py`, que já resolve com
`sys.stdout.reconfigure(encoding="utf-8")`; o `sidecar-tts.py` precisa da mesma linha, e aqui ela
importa **mais**, porque o STT emite português e o TTS emite IPA, onde todo fonema é não-ASCII.

## Artefatos verificados

SHA-256 medidos no download, para entrarem em `artefatos.ts` com hash pinado:

| Arquivo | Bytes | SHA-256 |
|---|---:|---|
| `pt_BR-faber-medium.onnx` | 63.201.294 | `858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7` |
| `pt_BR-faber-medium.onnx.json` | 4.855 | `7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f` |
| `pt_BR-edresson-low.onnx` | 63.104.526 | `de4cecee38b30bb1a6378a337af605d59f0c377df702c6a6752870db8991cd84` |
| `pt_BR-edresson-low.onnx.json` | 4.168 | `f138992d2e777d1e3aa0bbb14c2d324307b0f342c1bcf20978765b3bea506c56` |

`faber` roda a 22.050 Hz; `edresson`, a 16.000 Hz — o sample rate atravessa a ponte junto do PCM,
não é constante.

## Consequências para a fatia

- O caminho exato é o default; o plano B fica como **fallback medido**, disparado por lista vazia.
- A escolha entre os dois é observável (critério 3) e a `edresson` é o caso de teste vivo do plano B.
- `faber` é a candidata a default por ter alinhamento exato; a escolha final é do PI, ouvindo (decisão 2 da spec).
- A terceira voz que a spec condiciona à qualidade do catálogo ainda não foi avaliada.

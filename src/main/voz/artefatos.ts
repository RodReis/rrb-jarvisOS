/**
 * O catálogo de artefatos da voz (SPEC-Voz-01, critério 4).
 *
 * **URL fixa e hash pinado**, os dois no código. É o que torna o download auditável sem
 * credencial nenhuma: a política aceita exatamente estas URLs (fail closed), e o conteúdo só
 * entra se o SHA-256 conferir.
 *
 * ## Os hashes são medidos, não copiados
 *
 * Cada valor aqui foi obtido baixando o arquivo e calculando o SHA-256, e depois **conferido
 * contra a fonte**: o runtime contra o `SHA256SUMS` do release e o digest da API do GitHub; o
 * `model.bin` e as vozes contra o conteúdo servido pela **revisão pinada** do Hugging Face; as
 * wheels contra os digests que o PyPI publica por arquivo. Hash inventado seria pior que nenhum —
 * pareceria verificação e recusaria todo download legítimo.
 *
 * ## Por que tudo é pinado por revisão, e não por tag móvel
 *
 * `main`, `latest` e `resolve/main` apontam para conteúdo que muda. Um hash pinado contra alvo
 * móvel passa a recusar o download no dia em que o upstream publicar qualquer coisa — e o
 * usuário veria "falha de integridade" sobre um arquivo legítimo. Por isso o runtime traz a tag
 * do release, o modelo traz o commit e as wheels trazem a URL imutável do PyPI.
 *
 * ## As wheels moram em JSON, e não aqui
 *
 * São 28 arquivos — as dependências diretas do faster-whisper e do piper-tts mais as transitivas
 * —, e a lista saiu do resolvedor do pip, não de digitação. Deixá-las neste arquivo transformaria
 * uma lista gerada em código a revisar linha a linha; num JSON, atualizar é rodar o resolvedor de
 * novo. As duas bibliotecas compartilham sete wheels (numpy, onnxruntime, protobuf e outras), nas
 * **mesmas** versões — por isso o TTS acrescentou só quatro.
 */

import wheels from './wheels-da-voz.json'
import type { Artefato } from './download-de-artefato'

/** O release do python-build-standalone que o app usa. Tag fixa: `latest` mudaria o hash. */
const RUNTIME =
  'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only.tar.gz'

/** O commit do repositório do modelo. `resolve/main` moveria debaixo do hash pinado. */
const REVISAO_DO_MODELO = '536b0662742c02347bc0e980a01041f333bce120'

const modelo = (arquivo: string, sha256: string): Artefato => ({
  id: `modelo-whisper-small/${arquivo}`,
  url: `https://huggingface.co/Systran/faster-whisper-small/resolve/${REVISAO_DO_MODELO}/${arquivo}`,
  sha256,
  destino: `voz/models/whisper-small/${arquivo}`
})

/** O commit do catálogo de vozes do Piper. Mesma razão do modelo: `main` moveria sob o hash. */
const REVISAO_DAS_VOZES = '1162a9173d0ce503555aed757976b7a9912eae4c'

/**
 * Uma voz do Piper são **dois** arquivos: o `.onnx` e o `.onnx.json`.
 *
 * O `PiperVoice.load` adivinha o caminho do config a partir do modelo e abre os dois. Baixar só o
 * `.onnx` — que é o grande e parece "a voz" — faria a falha aparecer como erro do runtime, longe
 * da causa. É o mesmo motivo pelo qual o modelo do Whisper são quatro arquivos e não um.
 */
const voz = (
  nome: string,
  caminho: string,
  shaModelo: string,
  shaConfig: string
): readonly Artefato[] => [
  {
    id: `voz-piper/${nome}.onnx`,
    url: `https://huggingface.co/rhasspy/piper-voices/resolve/${REVISAO_DAS_VOZES}/${caminho}/${nome}.onnx`,
    sha256: shaModelo,
    destino: `voz/vozes/${nome}.onnx`
  },
  {
    id: `voz-piper/${nome}.onnx.json`,
    url: `https://huggingface.co/rhasspy/piper-voices/resolve/${REVISAO_DAS_VOZES}/${caminho}/${nome}.onnx.json`,
    sha256: shaConfig,
    destino: `voz/vozes/${nome}.onnx.json`
  }
]

/**
 * As vozes pt-BR (SPEC-Voz-02, critério 5 — o PI escolhe o default ouvindo).
 *
 * As duas do mínimo verificável da spec. A `faber` devolve alinhamento exato por fonema; a
 * `edresson` **não** — ela perde o alinhamento em silêncio (medido em `reports/spike-visemes-piper.md`)
 * e cai no caminho estimado. Decisão do PI em 2026-09-08: manter as duas, com a `edresson`
 * provando o plano B em produção em vez de ele existir só em teste.
 *
 * A terceira voz que a spec condiciona à qualidade do catálogo não entrou: nenhuma outra pt-BR do
 * catálogo tem qualidade equivalente, e a spec pede verificação, não promessa.
 */
export const VOZES_DO_CATALOGO = [
  { id: 'pt_BR-faber-medium', rotulo: 'Faber', destino: 'voz/vozes/pt_BR-faber-medium.onnx' },
  { id: 'pt_BR-edresson-low', rotulo: 'Edresson', destino: 'voz/vozes/pt_BR-edresson-low.onnx' }
] as const

export const ARTEFATOS_DA_VOZ: readonly Artefato[] = [
  {
    id: 'runtime-python',
    url: RUNTIME,
    sha256: 'e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f',
    destino: 'voz/runtime/python.tar.gz'
  },

  /*
   * O modelo são **quatro** arquivos, não um.
   *
   * O faster-whisper abre um diretório e espera encontrar os quatro: sem `config.json` ele não
   * sabe a arquitetura, sem `tokenizer.json` não decodifica. Baixar só o `model.bin` — que é o
   * grande e parece "o modelo" — deixaria o diretório inválido e a falha apareceria como erro
   * do runtime, longe da causa.
   */
  ...[
    modelo('model.bin', '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671'),
    modelo('config.json', 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828'),
    modelo('tokenizer.json', 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab'),
    modelo('vocabulary.txt', '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913')
  ],

  ...voz(
    'pt_BR-faber-medium',
    'pt/pt_BR/faber/medium',
    '858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7',
    '7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f'
  ),
  ...voz(
    'pt_BR-edresson-low',
    'pt/pt_BR/edresson/low',
    'de4cecee38b30bb1a6378a337af605d59f0c377df702c6a6752870db8991cd84',
    'f138992d2e777d1e3aa0bbb14c2d324307b0f342c1bcf20978765b3bea506c56'
  ),

  ...wheels.wheels.map((w) => ({
    id: `wheel/${w.arquivo}`,
    url: w.url,
    sha256: w.sha256,
    destino: `voz/wheels/${w.arquivo}`
  }))
]

/**
 * Os grupos, na ordem em que a tela os apresenta.
 *
 * A lista crua tem dezenas de itens, e mostrá-la ao usuário seria uma barra de progresso com nomes
 * de pacote Python. O que ele precisa saber é que faltam **runtime**, **modelo**, **vozes** ou
 * **bibliotecas** — e o download de cada item continua individual, com hash próprio.
 *
 * `vozes` é grupo próprio porque a ação do usuário é diferente: o modelo do STT é obrigatório para
 * ouvir, e a voz é escolha — ele pode querer uma e não a outra (critério 5).
 */
export type GrupoDeArtefato = 'runtime' | 'modelo' | 'vozes' | 'wheels'

export function grupoDoArtefato(id: string): GrupoDeArtefato {
  if (id.startsWith('wheel/')) return 'wheels'
  if (id.startsWith('voz-piper/')) return 'vozes'
  if (id.startsWith('modelo-')) return 'modelo'
  return 'runtime'
}

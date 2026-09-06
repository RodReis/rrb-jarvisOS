/**
 * O catálogo de artefatos da voz (SPEC-Voz-01, critério 4).
 *
 * **URL fixa e hash pinado**, os dois no código. É o que torna o download auditável sem
 * credencial nenhuma: a política aceita exatamente estas URLs (fail closed), e o conteúdo só
 * entra se o SHA-256 conferir.
 *
 * Os hashes ficam **vazios nesta primeira entrega** e são preenchidos na segunda, quando o
 * runtime real for escolhido e medido. Um hash inventado agora seria pior que nenhum: ele
 * pareceria verificação e recusaria todo download legítimo — ou, se copiado errado, aceitaria o
 * que não devia. Enquanto vazio, `sha256: ''` nunca confere com hash algum, então o catálogo
 * **falha fechado** por construção: nada é gravado até alguém pinar o valor medido.
 */

import type { Artefato } from './download-de-artefato'

export const ARTEFATOS_DA_VOZ: readonly Artefato[] = [
  {
    id: 'runtime-python',
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/PENDENTE/python.tar.gz',
    sha256: '',
    destino: 'voz/runtime/python.tar.gz'
  },
  {
    id: 'modelo-whisper-small',
    url: 'https://huggingface.co/Systran/faster-whisper-small/resolve/PENDENTE/model.bin',
    sha256: '',
    destino: 'voz/models/whisper-small/model.bin'
  }
]

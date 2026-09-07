/**
 * O catálogo de artefatos da voz (SPEC-Voz-01, critério 4).
 *
 * **URL fixa e hash pinado**, os dois no código. É o que torna o download auditável sem
 * credencial nenhuma: a política aceita exatamente estas URLs (fail closed), e o conteúdo só
 * entra se o SHA-256 conferir.
 *
 * ## De onde vieram estes hashes
 *
 * Cada um foi **medido no arquivo baixado e confirmado contra uma fonte independente**, porque
 * hash que eu mesmo calculo sobre o que eu mesmo baixei não prova nada além de que o download
 * não corrompeu — se a origem entregasse outra coisa, os dois lados concordariam:
 *
 * | grupo | confirmação independente |
 * |---|---|
 * | runtime | o `SHA256SUMS` publicado no próprio release |
 * | wheels | o `digests.sha256` da API do PyPI, e o lock resolvido pelo `uv` |
 * | `model.bin` | o `oid` do Git LFS que o HuggingFace publica |
 *
 * Os três arquivos pequenos do modelo não têm LFS nem checksum publicado; para eles a medida é
 * a do download, e a revisão fixa abaixo é o que impede que troquem sob os pés.
 *
 * ## Revisão fixa, nunca `main`
 *
 * A URL do modelo aponta para o **commit** `536b0662…`, não para `main`. Ramo é ponteiro móvel:
 * no dia em que o repositório recebesse um commit, todo hash aqui passaria a divergir e o app
 * recusaria o download legítimo — a verificação viraria uma bomba-relógio em vez de uma
 * garantia.
 *
 * ## Por que a árvore inteira, e não só `faster-whisper`
 *
 * São 24 wheels porque é isso que `faster-whisper==1.2.1` precisa para importar em Windows
 * x86_64 / CPython 3.12 — a resolução é fechada e travada, não "as principais". Pinar só as
 * diretas deixaria o resto entrar por resolução em tempo de instalação, que é exatamente o byte
 * não verificado que o critério 4 existe para impedir.
 *
 * O conjunto é **coerente entre si**: o runtime é CPython 3.12 porque as wheels são `cp312`, e
 * trocar um obriga a regerar o outro.
 */

import type { Artefato } from './download-de-artefato'

export const ARTEFATOS_DA_VOZ: readonly Artefato[] = [
  {
    id: 'runtime-python',
    grupo: 'runtime',
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only.tar.gz',
    sha256: 'e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f',
    destino: 'voz/runtime/cpython-3.12.14-x86_64-pc-windows-msvc.tar.gz'
  },
  {
    id: 'wheel-anyio',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/12/b8/4bd346e22b28902df4d651910f5242c28d84e4a5c2435ca5c3f797ed7e2e/anyio-4.15.1-py3-none-any.whl',
    sha256: '6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101',
    destino: 'voz/wheels/anyio-4.15.1-py3-none-any.whl'
  },
  {
    id: 'wheel-av',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/33/b4/76ba21e46704f632004276b85289a1582e95f5eff760436d6149875a1881/av-18.1.0-cp311-abi3-win_amd64.whl',
    sha256: 'ea1480b7a8d5405cb5f382b344731bf125fd2c1c6fae3964f6c48595628387ff',
    destino: 'voz/wheels/av-18.1.0-cp311-abi3-win_amd64.whl'
  },
  {
    id: 'wheel-certifi',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl',
    sha256: '62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775',
    destino: 'voz/wheels/certifi-2026.7.22-py3-none-any.whl'
  },
  {
    id: 'wheel-click',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/58/50/6c0d534c5f134586a8e1ba4e330569e32f057e33372ae556463212fb4cd3/click-8.5.0-py3-none-any.whl',
    sha256: '255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360',
    destino: 'voz/wheels/click-8.5.0-py3-none-any.whl'
  },
  {
    id: 'wheel-colorama',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl',
    sha256: '4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6',
    destino: 'voz/wheels/colorama-0.4.6-py2.py3-none-any.whl'
  },
  {
    id: 'wheel-ctranslate2',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/4e/23/e3b5322ff7368fcbed181ea4c209149416e7940b5b04971d5ee4084afe1a/ctranslate2-4.8.2-cp312-cp312-win_amd64.whl',
    sha256: 'd94421d565d0de61c032998f737a18942b0f2bef40c0424b1846ec6f67300105',
    destino: 'voz/wheels/ctranslate2-4.8.2-cp312-cp312-win_amd64.whl'
  },
  {
    id: 'wheel-faster-whisper',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/05/99/49ee85903dee060d9f08297b4a342e5e0bcfca2f027a07b4ee0a38ab13f9/faster_whisper-1.2.1-py3-none-any.whl',
    sha256: '79a66ad50688c0b794dd501dc340a736992a6342f7f95e5811be60b5224a26a7',
    destino: 'voz/wheels/faster_whisper-1.2.1-py3-none-any.whl'
  },
  {
    id: 'wheel-filelock',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/36/d2/b70a31e13d04456d28493f31d2aa087e99eeb2767ef0293b2625727ccb8c/filelock-3.32.5-py3-none-any.whl',
    sha256: '142cd9fa77a872c5e78c62329a0d15278fadc686eb89e760017968961a4fd6b2',
    destino: 'voz/wheels/filelock-3.32.5-py3-none-any.whl'
  },
  {
    id: 'wheel-flatbuffers',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/e8/2d/d2a548598be01649e2d46231d151a6c56d10b964d94043a335ae56ea2d92/flatbuffers-25.12.19-py2.py3-none-any.whl',
    sha256: '7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4',
    destino: 'voz/wheels/flatbuffers-25.12.19-py2.py3-none-any.whl'
  },
  {
    id: 'wheel-fsspec',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/fd/3c/6a2bf344106328fd04963664a60b9bb6496fc25df8e962fcdc1367285fb9/fsspec-2026.7.0-py3-none-any.whl',
    sha256: 'b57ddbafedfaef7018c1ecab32aa200a9d7ca26b77965f64e48b70061249d279',
    destino: 'voz/wheels/fsspec-2026.7.0-py3-none-any.whl'
  },
  {
    id: 'wheel-h11',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/04/4b/29cac41a4d98d144bf5f6d33995617b185d14b22401f75ca86f384e87ff1/h11-0.16.0-py3-none-any.whl',
    sha256: '63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86',
    destino: 'voz/wheels/h11-0.16.0-py3-none-any.whl'
  },
  {
    id: 'wheel-hf-xet',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/98/b7/8c59a66d15205024662f1d66968136f13893f96df1ddc5087e2e281fc95f/hf_xet-1.6.0-cp38-abi3-win_amd64.whl',
    sha256: 'fb4fadde1b2b70bf4c0c14a6dccbe7194b1c28947fefd5bbe3fed9d940676c3b',
    destino: 'voz/wheels/hf_xet-1.6.0-cp38-abi3-win_amd64.whl'
  },
  {
    id: 'wheel-httpcore',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/7e/f5/f66802a942d491edb555dd61e3a9961140fd64c90bce1eafd741609d334d/httpcore-1.0.9-py3-none-any.whl',
    sha256: '2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55',
    destino: 'voz/wheels/httpcore-1.0.9-py3-none-any.whl'
  },
  {
    id: 'wheel-httpx',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/2a/39/e50c7c3a983047577ee07d2a9e53faf5a69493943ec3f6a384bdc792deb2/httpx-0.28.1-py3-none-any.whl',
    sha256: 'd909fcccc110f8c7faf814ca82a9a4d816bc5a6dbfea25d6591d6985b8ba59ad',
    destino: 'voz/wheels/httpx-0.28.1-py3-none-any.whl'
  },
  {
    id: 'wheel-huggingface-hub',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/c3/0e/3e45bbe0dd48f4e56b1d46649d342de853cd1c7e815323472ab62687f153/huggingface_hub-1.30.0-py3-none-any.whl',
    sha256: '96ae0a8e99a234374a6fe43e989ebd21c04640b91ab2927e7e5773ba1131ca59',
    destino: 'voz/wheels/huggingface_hub-1.30.0-py3-none-any.whl'
  },
  {
    id: 'wheel-idna',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/57/b0/0e52c878c53f245edd3a11020f20979b3f490f245af532c7cae3027754b5/idna-3.19-py3-none-any.whl',
    sha256: '815e7be7a7806d54abb586dc943addc79e8b2ee16915059658cbeff4b1b43bf4',
    destino: 'voz/wheels/idna-3.19-py3-none-any.whl'
  },
  {
    id: 'wheel-numpy',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/3c/a1/accf6d4f0c80c5d9ba9735d6b1550e444180599f34dec69ca01360f717ad/numpy-2.5.3-cp312-cp312-win_amd64.whl',
    sha256: '0a59a421a32580a009e8a1751345bf829631b990dc1794b80514ab722b435def',
    destino: 'voz/wheels/numpy-2.5.3-cp312-cp312-win_amd64.whl'
  },
  {
    id: 'wheel-onnxruntime',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/b4/80/5b28f1f1111210fc4a336ddbc6950f468ebf9a6a265420568f4f43fa33ce/onnxruntime-1.29.0-cp312-cp312-win_amd64.whl',
    sha256: '4acf2b4948b7ede87221ca6332344b8facdc8059d6ac751a7d367d04532b02dd',
    destino: 'voz/wheels/onnxruntime-1.29.0-cp312-cp312-win_amd64.whl'
  },
  {
    id: 'wheel-packaging',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl',
    sha256: 'd7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c',
    destino: 'voz/wheels/packaging-26.3-py3-none-any.whl'
  },
  {
    id: 'wheel-protobuf',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/db/37/155788a0d8daded960375af604202805308169f9b859419ea0aa370946e2/protobuf-7.36.1-cp310-abi3-win_amd64.whl',
    sha256: '51139351435d9b43d88a55eaa49fb6f737fbb478fb0cbf2cf694d1a04a9d3363',
    destino: 'voz/wheels/protobuf-7.36.1-cp310-abi3-win_amd64.whl'
  },
  {
    id: 'wheel-pyyaml',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/86/bf/899e81e4cce32febab4fb42bb97dcdf66bc135272882d1987881a4b519e9/pyyaml-6.0.3-cp312-cp312-win_amd64.whl',
    sha256: '5fcd34e47f6e0b794d17de1b4ff496c00986e1c83f7ab2fb8fcfe9616ff7477b',
    destino: 'voz/wheels/pyyaml-6.0.3-cp312-cp312-win_amd64.whl'
  },
  {
    id: 'wheel-tokenizers',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/db/f7/0a69ac6b82dbccf3f71add938a161c497952749294b8dd6dfe03a819dc40/tokenizers-0.23.2-cp310-abi3-win_amd64.whl',
    sha256: '2e96f5699d5249c9c64aa8412e044f727aae3a4098cf830f9901ec1afc361cde',
    destino: 'voz/wheels/tokenizers-0.23.2-cp310-abi3-win_amd64.whl'
  },
  {
    id: 'wheel-tqdm',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/f9/1c/01bfd571a64e7f270e6bab5e33777debe0edc56759233ce84f27dec92d14/tqdm-4.70.0-py3-none-any.whl',
    sha256: '7f585706bfddbdebf89daac705b2dfcc16890130727d3197ca62c732b4310953',
    destino: 'voz/wheels/tqdm-4.70.0-py3-none-any.whl'
  },
  {
    id: 'wheel-typing-extensions',
    grupo: 'wheel',
    url: 'https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl',
    sha256: '481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8',
    destino: 'voz/wheels/typing_extensions-4.16.0-py3-none-any.whl'
  },
  {
    id: 'modelo-whisper-small-config',
    grupo: 'modelo',
    url: 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/config.json',
    sha256: 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828',
    destino: 'voz/models/whisper-small/config.json'
  },
  {
    id: 'modelo-whisper-small-model',
    grupo: 'modelo',
    url: 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/model.bin',
    sha256: '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671',
    destino: 'voz/models/whisper-small/model.bin'
  },
  {
    id: 'modelo-whisper-small-tokenizer',
    grupo: 'modelo',
    url: 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/tokenizer.json',
    sha256: 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    destino: 'voz/models/whisper-small/tokenizer.json'
  },
  {
    id: 'modelo-whisper-small-vocabulary',
    grupo: 'modelo',
    url: 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/vocabulary.txt',
    sha256: '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
    destino: 'voz/models/whisper-small/vocabulary.txt'
  }
]

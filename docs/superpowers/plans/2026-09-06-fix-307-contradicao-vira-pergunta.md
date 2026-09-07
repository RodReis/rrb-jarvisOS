# FIX #307 — Contradição do PRD vira pergunta no pop-up da M8-F03, e a resposta regera os documentos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada contradição detectada na geração do PRD chega ao PI como uma pergunta do contrato da M8-F03 (opções, recomendada primeiro, impacto, texto livre, "Decide por mim"), respondida no pop-up que o refinamento já usa; a resposta vira `Decision` gravada, entra no prompt da geração, e ao responder a última contradição os três documentos são gerados de novo como revisão candidata.

**Architecture:** O tipo `ContradicaoDoPrd` passa a **ser** uma `Pergunta` (mais as afirmações em conflito), então toda a máquina pura do `wizard.ts` (`estadoDoWizard`, `decidirPorMim`, `decisoesVigentes`) e o pop-up `WizardDoProjeto` (que já aceita uma `fonte` externa) funcionam sem cópia. O `PrdService` ganha `contradicoes()` (a vista do wizard) e `responderContradicao()` (grava a `Decision` com `etapa: 'prd'` no mesmo `DecisionRepository` do refinamento), e as decisões sobre contradições entram em `gerarDocumentos` pelo mesmo campo `decisoes` das decisões do refinamento. A tela do PRD abre o pop-up quando há contradição pendente e, ao receber `estado.tipo === 'concluido'`, chama `gerar()` com o termo confirmado. A lógica de "responder" que hoje vive copiada no `RefinamentoService` é extraída para uma função pura `montarDecisao` em `wizard.ts`, usada pelos dois serviços (a cópia do `WizardService` da M8-F03 fica intacta — não é escopo).

**Tech Stack:** Electron main (TypeScript, better-sqlite3), renderer React + i18next + Radix `Dialog` do DS, Vitest (projetos `regras`, `banco`, `tela`), Claude Code CLI via ponto único `ai.call` com `--json-schema`.

**Spec:** `docs/spec/spec-jornada-03-prd-landscape-convention-por-ia.md` § Geração item 5 e critério 6; `docs/spec/spec-planejamento-03-wizard-orientado.md` § Contrato da pergunta e § Decisões cravadas; emenda E1 (decisões do PI de 2026-09-06) escrita na Task 0. Issue: https://github.com/RodReis/rrb-jarvisOS/issues/307.

## Global Constraints

- Documentação, commits e textos de tela em **pt-BR** com acentuação correta; identificadores seguem o estilo do código existente (nomes em português, como `lerContradicoesDoModelo`).
- **Uma pergunta por pop-up**; recomendada primeiro, **sem pré-seleção**; "Decide por mim" só quando `delegavel`; decisão de agente **não aprova gate** (`podeAprovarGate`).
- **Renderer nunca decide conteúdo**: a tela pede o ato (`responder`, `gerar`); o main valida forma e vocabulário. Nenhum canal recebe texto de documento.
- **Fail closed**: contradição fora do contrato não chega ao PI — vira falha da etapa `contradicoes`, nunca lista vazia.
- Commits com `refs #307` (nunca `closes`), branch `fix/contradicao-vira-pergunta`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `npm run lint` (eslint + `prettier --check`), `npm run typecheck` e `npx vitest run` verdes antes de cada commit que toca código.
- Não tocar em `src/main/projects/wizard-service.ts` (a cópia da lógica de responder da M8-F03 fica como está — apontada, não refatorada).

---

### Task 0: Emenda E1 na spec, no branch da correção

**Files:**
- Modify: `docs/spec/spec-jornada-03-prd-landscape-convention-por-ia.md` (fim do arquivo)

- [ ] **Step 1: Conferir o branch**

Run: `git branch --show-current`
Expected: `fix/contradicao-vira-pergunta` (criado a partir de `origin/main` em `c11c507`).

- [ ] **Step 2: Acrescentar a emenda ao fim da spec**

Anexar ao final de `docs/spec/spec-jornada-03-prd-landscape-convention-por-ia.md`:

```markdown

## Emenda E1 — contradição vira pergunta respondível (decisões do PI, 2026-09-06)

Achado pelo PI ao gerar o PRD em 2026-09-06 (issue [#307](https://github.com/RodReis/rrb-jarvisOS/issues/307)): as contradições apareciam como cartões só de leitura, sem lugar para responder. O item 5 de § Geração já manda que contradição *"vira pergunta ao PI com recomendação (M8-F03)"*; esta emenda fixa o que faltava decidir.

1. **A contradição é uma pergunta no contrato da M8-F03**: título, enunciado, 2–3 opções excludentes com impacto, recomendada primeiro com justificativa, texto livre quando couber, "Decide por mim" quando delegável. Ela é respondida **no pop-up** do wizard — uma por vez —, nunca num formulário inline. O modelo gera a pergunta inteira; pergunta fora do contrato é recusada pelo validador e a etapa `contradicoes` falha (fail closed).
2. **A resposta é uma `Decision` gravada** (`etapa: 'prd'`), pelo mesmo canal das decisões do refinamento, e entra no pedido de geração como decisão citável (origem `decisao`). "Decide por mim" grava com o agente como autor e **não aprova o gate**.
3. **Ao responder a última contradição, os três documentos são gerados de novo, sozinhos**, com o termo de pesquisa confirmado — criando uma revisão nova candidata (critério 7 mantido: o aceite é por revisão exata). A regeração **parcial** (só as afirmações afetadas) fica para uma entrega posterior.
4. **O aceite continua sendo o clique do PI**, com o gate travado enquanto a revisão vigente tiver contradição.
```

- [ ] **Step 3: Commit**

```bash
git add docs/spec/spec-jornada-03-prd-landscape-convention-por-ia.md
git commit -m "docs: emenda E1 da SPEC-Jornada-03 — contradição vira pergunta respondível

Decisões do PI de 2026-09-06: pergunta no contrato da M8-F03, resposta
gravada como decisão, regeração completa ao responder a última, aceite
segue sendo o clique do PI.

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin fix/contradicao-vira-pergunta
```

---

### Task 1: Domínio — `ContradicaoDoPrd` no contrato da pergunta, parser e validador

**Files:**
- Modify: `src/shared/domain/prd.ts` (interface `ContradicaoDoPrd`, ~linha 85; import no topo)
- Modify: `src/shared/domain/prd-schema.ts` (`SISTEMA_DAS_CONTRADICOES` ~196, `contradicaoValida` e `lerContradicoesDoModelo` ~306)
- Modify: `src/shared/domain/pergunta-gerada.ts` (`validarPerguntaGerada` ~linha 100; extrair `validarContratoDaPergunta`)
- Modify: `src/main/projects/prd-repository.ts` (`toPrd`, campo `contradicoes`)
- Test: `src/shared/domain/prd.spec.ts`, `src/shared/domain/prd-schema.spec.ts`, `src/shared/domain/pergunta-gerada.spec.ts`

**Interfaces:**
- Produces: `interface ContradicaoDoPrd extends Pergunta { readonly afirmacoes: readonly string[] }`; `export const ETAPA_DA_CONTRADICAO = 'prd'`; `export function contradicaoGravada(bruta: Record<string, unknown>): ContradicaoDoPrd`; `export function validarContratoDaPergunta(p: Pergunta, textoExtra?: readonly string[]): ValidacaoDaPergunta`; `lerContradicoesDoModelo` continua devolvendo `readonly ContradicaoDoPrd[] | undefined`, agora com `etapa` preenchida.

- [ ] **Step 1: Escrever os testes que falham (parser)**

Em `src/shared/domain/prd-schema.spec.ts`, substituir o `describe('lerContradicoesDoModelo', …)` inteiro por:

```ts
describe('lerContradicoesDoModelo — a contradição é uma pergunta da M8-F03 (emenda E1)', () => {
  const contradicao = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'c-1',
    afirmacoes: ['a-1', 'a-2'],
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync entre máquinas.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige conta e rede.' }
    ],
    recomendada: 'a',
    justificativa: 'O brief diz local.',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  })

  it('lista vazia é resultado legítimo, não ausência de saída', () => {
    expect(lerContradicoesDoModelo('{"contradicoes":[]}')).toEqual([])
  })

  it('devolve undefined quando a forma não confere', () => {
    expect(lerContradicoesDoModelo('{"contradicoes":"nenhuma"}')).toBeUndefined()
  })

  it('lê a pergunta inteira e carimba a etapa', () => {
    const lidas = lerContradicoesDoModelo(JSON.stringify({ contradicoes: [contradicao()] }))

    expect(lidas).toHaveLength(1)
    expect(lidas?.[0]).toMatchObject({ id: 'c-1', etapa: 'prd', recomendada: 'a' })
    expect(lidas?.[0]?.opcoes).toHaveLength(2)
  })

  it('a forma antiga (pergunta + recomendação, sem opções) não passa mais', () => {
    const antiga = JSON.stringify({
      contradicoes: [
        { id: 'c-1', afirmacoes: ['a-1', 'a-2'], pergunta: 'Qual vale?', recomendacao: 'A.' }
      ]
    })

    expect(lerContradicoesDoModelo(antiga)).toBeUndefined()
  })

  it('opção sem impacto ou sem rótulo derruba a leitura', () => {
    const semImpacto = JSON.stringify({
      contradicoes: [contradicao({ opcoes: [{ id: 'a', rotulo: 'Local' }] })]
    })

    expect(lerContradicoesDoModelo(semImpacto)).toBeUndefined()
  })
})
```

Em `src/shared/domain/prd.spec.ts`, acrescentar ao fim (importar `contradicaoGravada` de `./prd`):

```ts
describe('contradicaoGravada — revisões anteriores à emenda E1 continuam respondíveis', () => {
  it('a forma nova passa intacta', () => {
    const nova = {
      id: 'c-1',
      etapa: 'prd',
      afirmacoes: ['a-1'],
      titulo: 'T',
      enunciado: 'E?',
      opcoes: [{ id: 'a', rotulo: 'A', impacto: 'i' }],
      recomendada: 'a',
      justificativa: 'j',
      aceitaTextoLivre: false,
      delegavel: true
    }

    expect(contradicaoGravada(nova)).toEqual(nova)
  })

  it('a forma antiga vira pergunta de texto livre, sem opções e sem delegação', () => {
    const antiga = {
      id: 'c-1',
      afirmacoes: ['a-1', 'b-1'],
      pergunta: 'O produto é local ou na nuvem?',
      recomendacao: 'Local, como o brief diz.'
    }

    const lida = contradicaoGravada(antiga)

    expect(lida.enunciado).toBe('O produto é local ou na nuvem?')
    expect(lida.justificativa).toBe('Local, como o brief diz.')
    expect(lida.opcoes).toEqual([])
    expect(lida.aceitaTextoLivre).toBe(true)
    expect(lida.delegavel).toBe(false)
    expect(lida.etapa).toBe('prd')
  })
})
```

Em `src/shared/domain/pergunta-gerada.spec.ts`, acrescentar ao fim (importar `validarContratoDaPergunta` de `./pergunta-gerada`):

```ts
describe('validarContratoDaPergunta — o contrato sem o bloco do brief', () => {
  const base = {
    id: 'c-1',
    etapa: 'prd',
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige rede.' }
    ],
    recomendada: 'a',
    justificativa: 'O brief diz local.',
    aceitaTextoLivre: true,
    delegavel: true
  }

  it('aceita a pergunta que cumpre o contrato', () => {
    expect(validarContratoDaPergunta(base).valida).toBe(true)
  })

  it('recusa uma opção só e recomendada inexistente', () => {
    const r = validarContratoDaPergunta({ ...base, opcoes: [base.opcoes[0]!], recomendada: 'z' })

    expect(r.problemas.map((p) => p.recusa)).toEqual(
      expect.arrayContaining(['opcoes-fora-do-contrato', 'recomendada-inexistente'])
    )
  })

  it('a invariante 9 vale também aqui', () => {
    const r = validarContratoDaPergunta({ ...base, enunciado: 'Precisa de consentimento LGPD?' })

    expect(r.problemas.map((p) => p.recusa)).toContain('requisito-inventado')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/shared/domain/prd-schema.spec.ts src/shared/domain/prd.spec.ts src/shared/domain/pergunta-gerada.spec.ts`
Expected: FAIL — `contradicaoGravada`/`validarContratoDaPergunta` não exportados; o parser aceita a forma antiga e recusa a nova.

- [ ] **Step 3: `prd.ts` — o tipo e a leitura de revisão antiga**

No topo de `src/shared/domain/prd.ts`, junto dos imports existentes: `import type { Pergunta } from './wizard'`.

Substituir a interface `ContradicaoDoPrd` (e o comentário acima dela) por:

```ts
/**
 * Uma contradição detectada entre documentos ou contra o brief (critério 6).
 *
 * **É uma pergunta do contrato da M8-F03** (emenda E1): opções excludentes com impacto,
 * recomendada primeiro com justificativa, texto livre e delegação declarados pelo modelo. Assim
 * a máquina do `wizard.ts` e o pop-up do refinamento a conduzem sem uma segunda superfície —
 * mostrar duas frases incompatíveis com uma recomendação em prosa devolvia ao PI o trabalho de
 * decidir sem opção acionável, que é exatamente o que o contrato existe para evitar.
 */
export interface ContradicaoDoPrd extends Pergunta {
  /** As afirmações em conflito. Duas ou mais ids de `AfirmacaoDoPrd` ou do brief. */
  readonly afirmacoes: readonly string[]
}

/** A `etapa` que a pergunta e a decisão sobre uma contradição carregam. */
export const ETAPA_DA_CONTRADICAO = 'prd'

/**
 * Lê uma contradição como foi gravada.
 *
 * Revisões anteriores à emenda E1 guardavam só `pergunta` e `recomendacao`. Elas viram pergunta
 * de **texto livre**, sem opções e sem delegação: continuam respondíveis pelo mesmo pop-up e
 * nunca quebram a tela — `opcoesOrdenadas` sobre `opcoes` ausente derrubaria o componente.
 */
export function contradicaoGravada(bruta: Record<string, unknown>): ContradicaoDoPrd {
  if (Array.isArray(bruta['opcoes'])) return bruta as unknown as ContradicaoDoPrd

  return {
    id: typeof bruta['id'] === 'string' ? bruta['id'] : '',
    etapa: ETAPA_DA_CONTRADICAO,
    afirmacoes: Array.isArray(bruta['afirmacoes']) ? (bruta['afirmacoes'] as string[]) : [],
    titulo: 'Contradição',
    enunciado: typeof bruta['pergunta'] === 'string' ? bruta['pergunta'] : '',
    opcoes: [],
    recomendada: '',
    justificativa: typeof bruta['recomendacao'] === 'string' ? bruta['recomendacao'] : '',
    aceitaTextoLivre: true,
    delegavel: false
  }
}
```

- [ ] **Step 4: `prd-schema.ts` — o system e o parser**

Substituir `SISTEMA_DAS_CONTRADICOES` por:

```ts
export const SISTEMA_DAS_CONTRADICOES = [
  'Você recebe as afirmações de três documentos e do brief que os originou, e procura',
  IDIOMA_DA_SAIDA,
  'contradições: pares de afirmações que não podem ser verdadeiras ao mesmo tempo.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Cada contradição é uma **pergunta** para o dono do projeto decidir. Formato:',
  '{"contradicoes":[{"id":"c-1","afirmacoes":["<id>","<id>"],',
  '  "titulo":"<curto>","enunciado":"<a pergunta que o dono do projeto precisa responder>",',
  '  "opcoes":[{"id":"a","rotulo":"<opção>","impacto":"<o trade-off desta opção>"}],',
  '  "recomendada":"<id de uma das opções>","justificativa":"<por que esta é a recomendada>",',
  '  "aceitaTextoLivre":true|false,"delegavel":true|false}]}',
  '',
  'Regras da pergunta, e elas não são estilo — são contrato:',
  '- Entre 2 e 3 opções, mutuamente excludentes. Cada opção é um dos lados da contradição, ou',
  '  uma terceira saída concreta. Uma opção não é escolha; quatro viram formulário.',
  '- Toda opção declara "impacto": o trade-off dela. Sem isso o dono do projeto escolhe no escuro.',
  '- "recomendada" tem de ser o id de uma das opções que você ofereceu.',
  '- "delegavel": false quando a decisão for cara de reverter. Só delegue o que é seguro delegar.',
  '',
  'Não corrija nada. Não escolha por conta própria. Sua saída é a pergunta e a recomendação;',
  'quem decide é o dono do projeto.',
  '',
  'Diferença de ênfase, de detalhe ou de vocabulário não é contradição. Só reporte quando',
  'aceitar as duas afirmações tornaria o projeto impossível de construir de um jeito só.',
  '',
  'Nunca invente requisito legal, regulatório, de consentimento, aceite duplo, termos de uso,',
  'política de privacidade, dados pessoais ou sensíveis, compliance ou classificação jurídica.',
  '',
  'Se não houver contradição, devolva {"contradicoes":[]}.'
].join('\n')
```

Acrescentar `ETAPA_DA_CONTRADICAO` ao import de `./prd` no topo do arquivo. Substituir `contradicaoValida` e `lerContradicoesDoModelo` por:

```ts
function opcaoValida(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o['id'] === 'string' &&
    typeof o['rotulo'] === 'string' &&
    typeof o['impacto'] === 'string'
  )
}

/** A forma que o modelo devolve: a pergunta da M8-F03 mais as afirmações — sem `etapa`. */
function contradicaoValida(v: unknown): v is Omit<ContradicaoDoPrd, 'etapa'> {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  const afirmacoes = c['afirmacoes']

  return (
    typeof c['id'] === 'string' &&
    Array.isArray(afirmacoes) &&
    afirmacoes.every((a) => typeof a === 'string') &&
    typeof c['titulo'] === 'string' &&
    typeof c['enunciado'] === 'string' &&
    Array.isArray(c['opcoes']) &&
    c['opcoes'].every(opcaoValida) &&
    typeof c['recomendada'] === 'string' &&
    typeof c['justificativa'] === 'string' &&
    typeof c['aceitaTextoLivre'] === 'boolean' &&
    typeof c['delegavel'] === 'boolean'
  )
}

/**
 * Lê as contradições como perguntas (emenda E1). **Forma, não contrato**: o número de opções, a
 * recomendada existir e a invariante 9 são do validador (`validarContratoDaPergunta`), que o
 * serviço roda antes de gravar — mesma divisão do refinamento.
 */
export function lerContradicoesDoModelo(bruto: string): readonly ContradicaoDoPrd[] | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const contradicoes = raiz['contradicoes']
  if (!Array.isArray(contradicoes)) return undefined
  if (!contradicoes.every(contradicaoValida)) return undefined

  return contradicoes.map((c) => ({ ...c, etapa: ETAPA_DA_CONTRADICAO }))
}
```

- [ ] **Step 5: `pergunta-gerada.ts` — extrair o contrato sem o bloco**

Trocar `textoVisivel` e `validarPerguntaGerada` por:

```ts
/**
 * Todo texto que o PI **lê** numa pergunta. É a superfície onde um requisito inventado
 * apareceria — e por isso a varredura cobre a pergunta inteira, não só o enunciado.
 *
 * `extras` é o que cada origem acrescenta: o refinamento mostra `porQue` como justificativa do
 * que está sendo perguntado, e um requisito inventado escondido ali chegaria à tela igual.
 */
function textoVisivel(p: Pergunta, extras: readonly string[]): string {
  return [
    p.titulo,
    p.enunciado,
    p.justificativa,
    ...extras,
    ...p.opcoes.flatMap((o) => [o.rotulo, o.impacto])
  ].join(' | ')
}

/**
 * O contrato da M8-F03 sobre **qualquer** pergunta gerada — do refinamento ou uma contradição
 * do PRD (emenda E1 da SPEC-Jornada-03). O que é próprio do refinamento (o bloco do brief) fica
 * em `validarPerguntaGerada`.
 *
 * Devolve todos os problemas, não o primeiro: quem gerou corrige a pergunta inteira numa
 * rodada, em vez de uma chamada de modelo por defeito.
 */
export function validarContratoDaPergunta(
  p: Pergunta,
  textoExtra: readonly string[] = []
): ValidacaoDaPergunta {
  const problemas: ProblemaNaPergunta[] = []

  if (p.titulo.trim().length === 0) {
    problemas.push({ recusa: 'titulo-vazio', mensagem: 'A pergunta não tem título.' })
  }

  if (p.enunciado.trim().length === 0) {
    problemas.push({ recusa: 'enunciado-vazio', mensagem: 'A pergunta não tem enunciado.' })
  }

  if (p.justificativa.trim().length === 0) {
    problemas.push({
      recusa: 'justificativa-vazia',
      mensagem: 'A recomendação não vem justificada, e sem justificativa ela é só um default.'
    })
  }

  if (p.opcoes.length < MINIMO_DE_OPCOES || p.opcoes.length > MAXIMO_DE_OPCOES) {
    problemas.push({
      recusa: 'opcoes-fora-do-contrato',
      mensagem: `A pergunta tem ${p.opcoes.length} opções; o contrato pede entre ${MINIMO_DE_OPCOES} e ${MAXIMO_DE_OPCOES}.`
    })
  }

  for (const o of p.opcoes) {
    if (o.rotulo.trim().length === 0) {
      problemas.push({
        recusa: 'opcao-sem-rotulo',
        mensagem: `A opção "${o.id}" não tem rótulo.`
      })
    }

    // "Opção sem impacto é opção sem escolha" — o comentário do contrato original, aplicado ao
    // que o modelo produz. Sem o trade-off declarado, o PI escolhe no escuro.
    if (o.impacto.trim().length === 0) {
      problemas.push({
        recusa: 'opcao-sem-impacto',
        mensagem: `A opção "${o.id}" não declara impacto, e sem ele não há trade-off a comparar.`
      })
    }
  }

  // Opções mutuamente **excludentes** é o contrato. Duas com o mesmo rótulo não são duas
  // escolhas: são a mesma escolha oferecida duas vezes, e o PI não teria como distingui-las.
  //
  // Espaço interno colapsado além do acento e da caixa: um modelo produz "Fatia vertical" e
  // "fatia  vertical" com a mesma facilidade, e sem isso a repetição passaria disfarçada de
  // duas opções. Foi o que o teste pegou.
  const rotulos = p.opcoes.map((o) => normalizar(o.rotulo).trim().replace(/\s+/g, ' '))
  if (new Set(rotulos).size !== rotulos.length) {
    problemas.push({
      recusa: 'opcoes-repetidas',
      mensagem: 'Duas opções têm o mesmo rótulo; elas precisam ser mutuamente excludentes.'
    })
  }

  // A recomendada tem de ser uma das opções. Um id solto faria a tela não destacar nada — e
  // "Decide por mim" gravaria como escolha algo que não está na lista.
  if (!p.opcoes.some((o) => o.id === p.recomendada)) {
    problemas.push({
      recusa: 'recomendada-inexistente',
      mensagem: `A recomendada "${p.recomendada}" não está entre as opções oferecidas.`
    })
  }

  // A invariante 9 em runtime — a razão de este arquivo existir. Na M8-F03 esta varredura era
  // teste sobre catálogo revisado; aqui roda sobre texto que ninguém leu.
  const texto = normalizar(textoVisivel(p, textoExtra))
  const termo = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.find((t) => texto.includes(t))

  if (termo !== undefined) {
    problemas.push({
      recusa: 'requisito-inventado',
      mensagem: `A pergunta menciona "${termo}". A pipeline não inventa requisito legal, regulatório, de consentimento, aceite duplo ou classificação por domínio (invariante 9 do CONVENTION §4).`
    })
  }

  return { valida: problemas.length === 0, problemas }
}

/**
 * Valida uma pergunta gerada do refinamento (critério 3): o contrato inteiro, mais o bloco do
 * brief que ela declara preencher e o `porQue` que o PI lê como justificativa.
 */
export function validarPerguntaGerada(p: PerguntaGerada): ValidacaoDaPergunta {
  const problemas: ProblemaNaPergunta[] = [...validarContratoDaPergunta(p, [p.porQue]).problemas]

  if (!isBlocoDoBrief(p.bloco)) {
    problemas.push({
      recusa: 'bloco-desconhecido',
      mensagem: `A pergunta declara preencher o bloco "${p.bloco}", que não existe no schema.`
    })
  }

  return { valida: problemas.length === 0, problemas }
}
```

- [ ] **Step 6: `prd-repository.ts` — ler pelo normalizador**

No import de `@shared/domain/prd`, trocar `ContradicaoDoPrd` por `contradicaoGravada` (o tipo deixa de ser usado ali). Em `toPrd`, trocar a linha das contradições por:

```ts
    contradicoes: parseLista<Record<string, unknown>>(row.contradicoes, 'contradicoes').map(
      contradicaoGravada
    ),
```

- [ ] **Step 7: Rodar os três specs e o typecheck**

Run: `npx vitest run src/shared/domain/prd-schema.spec.ts src/shared/domain/prd.spec.ts src/shared/domain/pergunta-gerada.spec.ts && npm run typecheck`
Expected: specs PASS. O typecheck **vai falhar** em `src/main/projects/prd-service.int-spec.ts:441` (fixture com `pergunta`/`recomendacao`) e em `src/renderer/src/app/PrdDoProjeto.tsx` (`c.pergunta`, `c.recomendacao`) — são as Tasks 3 e 5. Nada mais deve quebrar; se quebrar, é sintoma de outro consumidor de `ContradicaoDoPrd` e precisa ser lido antes de seguir.

- [ ] **Step 8: Commit**

```bash
git add src/shared/domain/prd.ts src/shared/domain/prd-schema.ts src/shared/domain/pergunta-gerada.ts src/main/projects/prd-repository.ts src/shared/domain/prd-schema.spec.ts src/shared/domain/prd.spec.ts src/shared/domain/pergunta-gerada.spec.ts
git commit -m "feat: a contradição do PRD é uma pergunta do contrato da M8-F03

ContradicaoDoPrd passa a estender Pergunta; o system pede opções com
impacto, recomendada e justificativa; o parser recusa a forma antiga; o
contrato da pergunta sai do refinamento para valer sobre qualquer origem.
Revisões gravadas antes da emenda viram pergunta de texto livre.

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `wizard.ts` — extrair `montarDecisao` e usá-la no refinamento

**Files:**
- Modify: `src/shared/domain/wizard.ts` (depois de `decidirPorMim`, ~linha 250)
- Modify: `src/main/projects/refinamento-service.ts` (`responder`, linhas ~300–400; `escolhaValida` ~415)
- Test: `src/shared/domain/wizard.spec.ts`; `src/main/projects/refinamento-service.int-spec.ts` (existente, fica verde)

**Interfaces:**
- Produces:
```ts
export interface EscopoDaDecisao {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly created_at: string
}
export type DecisaoMontada =
  | { readonly decisao: Decision }
  | { readonly recusa: 'nao-delegavel' | 'escolha-invalida'; readonly mensagem: string }
export function montarDecisao(entrada: {
  readonly pergunta: Pergunta
  readonly resposta: Resposta
  readonly anterior: Decision | undefined
  readonly escopo: EscopoDaDecisao
}): DecisaoMontada
```

- [ ] **Step 1: Testes que falham**

Acrescentar ao fim de `src/shared/domain/wizard.spec.ts` (importar `montarDecisao` de `./wizard`; os helpers `pergunta()` e `decisao()` já existem no arquivo):

```ts
describe('montarDecisao — a mecânica de responder, uma vez só', () => {
  const escopo = {
    id: 'd-novo',
    user_id: 'u-1',
    workspace_id: 'jarvis' as const,
    projectId: 'p-1',
    created_at: '2026-09-06T12:00:00.000Z'
  }
  const p = pergunta({
    id: 'q-1',
    opcoes: [
      { id: 'a', rotulo: 'A', impacto: 'ia' },
      { id: 'b', rotulo: 'B', impacto: 'ib' }
    ],
    recomendada: 'a',
    justificativa: 'porque a',
    aceitaTextoLivre: true,
    delegavel: true
  })

  it('escolha real vira decisão do PI com motivo escolhida', () => {
    const r = montarDecisao({
      pergunta: p,
      resposta: { perguntaId: 'q-1', escolha: 'b', texto: null, autor: 'pi' },
      anterior: undefined,
      escopo
    })

    expect(r).toMatchObject({
      decisao: { escolha: 'b', autor: 'pi', motivo: 'escolhida', substituiu: null, id: 'd-novo' }
    })
  })

  it('texto livre grava o texto e o motivo texto-livre', () => {
    const r = montarDecisao({
      pergunta: p,
      resposta: { perguntaId: 'q-1', escolha: null, texto: 'Outra.', autor: 'pi' },
      anterior: undefined,
      escopo
    })

    expect(r).toMatchObject({ decisao: { escolha: null, texto: 'Outra.', motivo: 'texto-livre' } })
  })

  it('delegação grava a recomendada com o agente como autor', () => {
    const r = montarDecisao({
      pergunta: p,
      resposta: { perguntaId: 'q-1', escolha: null, texto: null, autor: 'agente' },
      anterior: undefined,
      escopo
    })

    expect(r).toMatchObject({ decisao: { escolha: 'a', autor: 'agente', motivo: 'delegada' } })
  })

  it('recusa delegar o que não é delegável — a regra é do domínio, não do botão', () => {
    const r = montarDecisao({
      pergunta: pergunta({ ...p, delegavel: false }),
      resposta: { perguntaId: 'q-1', escolha: null, texto: null, autor: 'agente' },
      anterior: undefined,
      escopo
    })

    expect(r).toMatchObject({ recusa: 'nao-delegavel' })
  })

  it('recusa escolha que não é opção, e texto livre onde não cabe', () => {
    expect(
      montarDecisao({
        pergunta: p,
        resposta: { perguntaId: 'q-1', escolha: 'z', texto: null, autor: 'pi' },
        anterior: undefined,
        escopo
      })
    ).toMatchObject({ recusa: 'escolha-invalida' })

    expect(
      montarDecisao({
        pergunta: pergunta({ ...p, aceitaTextoLivre: false }),
        resposta: { perguntaId: 'q-1', escolha: null, texto: 'x', autor: 'pi' },
        anterior: undefined,
        escopo
      })
    ).toMatchObject({ recusa: 'escolha-invalida' })
  })

  it('com decisão anterior, a nova a substitui e aponta para ela', () => {
    const anterior = decisao({ id: 'd-velha', perguntaId: 'q-1' })
    const r = montarDecisao({
      pergunta: p,
      resposta: { perguntaId: 'q-1', escolha: 'b', texto: null, autor: 'pi' },
      anterior,
      escopo
    })

    expect(r).toMatchObject({ decisao: { motivo: 'substituida', substituiu: 'd-velha' } })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/shared/domain/wizard.spec.ts`
Expected: FAIL — `montarDecisao` não exportada.

- [ ] **Step 3: Implementar em `wizard.ts`**

Logo depois de `decidirPorMim` (antes de `podeAprovarGate`):

```ts
/** O que o serviço acrescenta à decisão: identidade, escopo e instante. */
export interface EscopoDaDecisao {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly created_at: string
}

export type DecisaoMontada =
  | { readonly decisao: Decision }
  | { readonly recusa: 'nao-delegavel' | 'escolha-invalida'; readonly mensagem: string }

/**
 * Monta a `Decision` de uma resposta — ou recusa, pelo vocabulário da pergunta.
 *
 * É a mecânica que o refinamento (M25-F02) e as contradições do PRD (emenda E1 da
 * SPEC-Jornada-03) compartilham: a delegação tem de ser permitida pelo domínio, a escolha tem
 * de ser opção real (ou texto livre onde cabe), e responder de novo **substitui** a anterior em
 * vez de editá-la. Pura de propósito: quem chama decide onde gravar e o que auditar.
 *
 * Validar a escolha aqui, e não só na tela, é o que impede o IPC de gravar decisão impossível:
 * o renderer é fronteira não confiável.
 */
export function montarDecisao(entrada: {
  readonly pergunta: Pergunta
  readonly resposta: Resposta
  readonly anterior: Decision | undefined
  readonly escopo: EscopoDaDecisao
}): DecisaoMontada {
  const { pergunta, resposta, anterior, escopo } = entrada

  const delegada = resposta.autor === 'agente'
  const decidida = delegada ? decidirPorMim(pergunta) : null
  if (delegada && decidida === null) {
    return {
      recusa: 'nao-delegavel',
      mensagem: 'Esta decisão precisa do PI e não pode ser delegada.'
    }
  }

  const escolha = decidida?.escolha ?? resposta.escolha
  const texto = decidida ? null : resposta.texto
  const valida =
    escolha !== null
      ? pergunta.opcoes.some((o) => o.id === escolha)
      : texto !== null && pergunta.aceitaTextoLivre && texto.trim().length > 0
  if (!valida) {
    return { recusa: 'escolha-invalida', mensagem: 'Escolha inválida para esta pergunta.' }
  }

  return {
    decisao: {
      ...escopo,
      perguntaId: pergunta.id,
      etapa: pergunta.etapa,
      escolha,
      texto,
      recomendacao: pergunta.recomendada,
      justificativa: decidida?.justificativa ?? pergunta.justificativa,
      autor: decidida?.autor ?? 'pi',
      motivo: decidida
        ? 'delegada'
        : anterior !== undefined
          ? 'substituida'
          : texto !== null
            ? 'texto-livre'
            : 'escolhida',
      substituiu: anterior?.id ?? null
    }
  }
}
```

`WorkspaceId` já é importado em `wizard.ts` (é usado em `Decision`); confirmar com `grep -n "WorkspaceId" src/shared/domain/wizard.ts`.

- [ ] **Step 4: Usar no `RefinamentoService.responder`**

Em `src/main/projects/refinamento-service.ts`, acrescentar `montarDecisao` ao import de `@shared/domain/wizard` e substituir, dentro de `responder`, o trecho que vai de `const delegada = resposta.autor === 'agente'` até `this.decisions.registrar(decisao)` (inclusive) por:

```ts
    const historico = this.decisions.listar(userId, projectId)
    const vigentes = decisoesVigentes(historico)
    const contradicoes = detectarContradicoes(catalogo, vigentes, pergunta.id)

    if (contradicoes.length > 0 && resposta.aceitarSubstituicao !== true) {
      return {
        reason: 'contradicao-pendente',
        contradicoes,
        mensagem: 'Esta resposta muda decisões já tomadas. Confirme a substituição.'
      }
    }

    // A regra de delegabilidade e a validade da escolha vêm do domínio, não do fato de a tela
    // ter mostrado o botão — mesma mecânica das contradições do PRD.
    const montada = montarDecisao({
      pergunta,
      resposta,
      anterior: vigentes[pergunta.id],
      escopo: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        created_at: new Date().toISOString()
      }
    })
    if ('recusa' in montada) return { reason: montada.recusa, mensagem: montada.mensagem }

    const decisao = montada.decisao
    this.decisions.registrar(decisao)
```

Apagar o método privado `escolhaValida` do `RefinamentoService` (ficou sem uso) e, se o import de `Decision` ficar sem uso, removê-lo também. **Atenção à ordem**: hoje a contradição é checada **depois** da escolha ser validada; a nova ordem checa contradição antes. Nenhum teste existente depende disso (a contradição exige `dependentes`, que perguntas geradas não têm), e a ordem nova evita gastar `montarDecisao` numa resposta que vai voltar sem gravar.

- [ ] **Step 5: Rodar os dois specs, lint e typecheck**

Run: `npx vitest run src/shared/domain/wizard.spec.ts src/main/projects/refinamento-service.int-spec.ts && npx eslint src/shared/domain/wizard.ts src/main/projects/refinamento-service.ts && npm run typecheck 2>&1 | grep -v "prd-service.int-spec\|PrdDoProjeto" | tail -3`
Expected: specs PASS (o int-spec do refinamento sem mudança de comportamento); eslint limpo. O typecheck ainda acusa os dois arquivos das Tasks 3 e 5, e só eles.

- [ ] **Step 6: Commit**

```bash
git add src/shared/domain/wizard.ts src/shared/domain/wizard.spec.ts src/main/projects/refinamento-service.ts
git commit -m "refactor: montarDecisao — a mecânica de responder sai do refinamento para o domínio

As contradições do PRD vão responder pela mesma máquina; uma terceira
cópia da delegação, da validade da escolha e da substituição divergiria
na primeira correção feita só numa delas.

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `PrdService` — ids próprios, validação do contrato, vista, resposta e decisões no pedido

**Files:**
- Modify: `src/main/projects/prd-service.ts` (deps ~106–184; laço em `gerar` ~430–500; `hashDoPrd` ~193; novos métodos depois de `cortarProposto`)
- Modify: `src/main/index.ts` (construção do `PrdService`, ~linha 951: passar `decisions`)
- Test: `src/main/projects/prd-service.int-spec.ts`

**Interfaces:**
- Consumes: `montarDecisao`, `estadoDoWizard`, `decisoesVigentes` de `@shared/domain/wizard`; `validarContratoDaPergunta` de `@shared/domain/pergunta-gerada`; `ETAPA_DA_CONTRADICAO` de `@shared/domain/prd`; `DecisionRepository` (`listar`, `registrar`).
- Produces: `PrdServiceDeps.decisions: DecisionRepository`; `PrdService.contradicoes(projectId: string): VistaDoWizard | undefined`; `PrdService.responderContradicao(projectId: string, resposta: Resposta, workspaceId: WorkspaceId): RespostaOutcome`.

- [ ] **Step 1: Ajustar a montagem do teste e escrever os testes que falham**

Em `src/main/projects/prd-service.int-spec.ts`:

1. Junto dos outros `await import`: `const { DecisionRepository } = await import('./decision-repository')`. Junto dos `let`: `let decisions: InstanceType<typeof DecisionRepository>`. No `beforeEach`, antes de `service = new PrdService({`: `decisions = new DecisionRepository(db)`; e dentro das deps, depois de `pacotes,`: `decisions,`.
2. Acrescentar um helper no topo, depois de `afirmacao()`:

```ts
function contradicao(over: Partial<ContradicaoDoPrd> = {}): ContradicaoDoPrd {
  return {
    id: 'c-1',
    etapa: 'prd',
    afirmacoes: ['a-1', 'b-1'],
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync entre máquinas.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige conta e rede.' }
    ],
    recomendada: 'a',
    justificativa: 'Local, como o brief diz.',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  }
}
```

3. No `describe('contradições viram perguntas (critério 6)')`, trocar o primeiro `it` (o da forma antiga) por este bloco, e acrescentar os demais:

```ts
  it('a contradição é gravada como pergunta, com id próprio e etapa prd', async () => {
    contradicoes = [contradicao()]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.prd?.contradicoes).toHaveLength(1)
    const gravada = r.prd?.contradicoes[0]
    // O id vem do serviço, não do modelo: "c-1" colidiria entre revisões, e a decisão do PI
    // passaria a apontar para a contradição errada.
    expect(gravada?.id).not.toBe('c-1')
    expect(gravada).toMatchObject({ etapa: 'prd', justificativa: 'Local, como o brief diz.' })
  })

  it('contradição fora do contrato não chega ao PI — a etapa falha, como a detecção que não saiu', async () => {
    contradicoes = [contradicao({ opcoes: [{ id: 'a', rotulo: 'Só uma', impacto: 'x' }] })]
    respostas = [[afirmacao()], [afirmacao()]]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(r.problemas?.join(' ')).toContain('opções')
    expect(repo.vigente(USER, PROJETO)).toBeUndefined()
  })

  it('a mesma contradição com outro id do modelo não muda a revisão', async () => {
    contradicoes = [contradicao({ id: 'c-1' })]
    const primeira = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    respostas = [[afirmacao()]]
    contradicoes = [contradicao({ id: 'c-9' })]
    const segunda = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    // O hash ignora o id da contradição: ele é sorteado por revisão, e entrar no hash faria
    // "mesmo conteúdo é a mesma revisão" (invariante 2 da CONVENTION §4) deixar de valer.
    expect(segunda.prd?.hash).toBe(primeira.prd?.hash)
  })
```

4. Acrescentar um `describe` novo ao fim do arquivo:

```ts
describe('responder às contradições (emenda E1)', () => {
  async function gerarComContradicao(): Promise<string> {
    contradicoes = [contradicao()]
    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)
    return r.prd?.contradicoes[0]?.id ?? ''
  }

  it('a vista traz a contradição como a próxima pergunta, e nenhuma decisão ainda', async () => {
    await gerarComContradicao()

    const vista = service.contradicoes(PROJETO)

    expect(vista?.estado.tipo).toBe('pergunta')
    expect(vista?.estado.tipo === 'pergunta' && vista.estado.pergunta.enunciado).toBe(
      'O produto é local ou na nuvem?'
    )
    expect(vista?.historico).toEqual([])
  })

  it('sem revisão, a vista é undefined — não há o que responder', () => {
    expect(service.contradicoes(PROJETO)).toBeUndefined()
  })

  it('a resposta do PI vira decisão gravada com etapa prd, e a vista conclui', async () => {
    const id = await gerarComContradicao()

    const r = service.responderContradicao(
      PROJETO,
      { perguntaId: id, escolha: 'b', texto: null, autor: 'pi' },
      WS
    )

    expect(r.reason).toBe('registrada')
    expect(r.estado?.tipo).toBe('concluido')
    expect(decisions.listar(USER, PROJETO)).toHaveLength(1)
    expect(decisions.listar(USER, PROJETO)[0]).toMatchObject({
      perguntaId: id,
      etapa: 'prd',
      escolha: 'b',
      autor: 'pi'
    })
  })

  it('"Decide por mim" grava a recomendada com o agente como autor', async () => {
    const id = await gerarComContradicao()

    const r = service.responderContradicao(
      PROJETO,
      { perguntaId: id, escolha: null, texto: null, autor: 'agente' },
      WS
    )

    expect(r.decisao).toMatchObject({ escolha: 'a', autor: 'agente', motivo: 'delegada' })
  })

  it('recusa pergunta que não é da revisão vigente', async () => {
    await gerarComContradicao()

    const r = service.responderContradicao(
      PROJETO,
      { perguntaId: 'fantasma', escolha: 'a', texto: null, autor: 'pi' },
      WS
    )

    expect(r.reason).toBe('pergunta-desconhecida')
    expect(decisions.listar(USER, PROJETO)).toHaveLength(0)
  })

  it('a decisão sobre a contradição entra no pedido da geração seguinte, com o rótulo', async () => {
    const id = await gerarComContradicao()
    service.responderContradicao(
      PROJETO,
      { perguntaId: id, escolha: 'b', texto: null, autor: 'pi' },
      WS
    )

    // Remonta o serviço com as mesmas deps do `beforeEach`, trocando só `gerarDocumentos` para
    // capturar o pedido. Copiar o objeto de deps do `beforeEach` aqui é aceitável: o que se
    // prova é o conteúdo de `decisoes`, não a montagem.
    const pedidos: { decisoes: readonly { pergunta: string; resposta: string }[] }[] = []
    service = new PrdService({
      repository: repo,
      pacotes,
      decisions,
      projects: projetos,
      projectService: { concluirMarco: () => ({ commitado: true, commitHash: 'abc1234' }) } as never,
      connectors: { call: async () => respostaDaBusca } as never,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      briefAceito: () => briefAceito,
      decisoesDoRefinamento: () => [],
      montarContexto: () => 'pack-1',
      estadoDasRotas: () => rotas,
      gerarTermo: async () => ({ termo: 'x' }),
      gerarDocumentos: async (entrada) => {
        pedidos.push({ decisoes: entrada.decisoes })
        return { afirmacoes: [afirmacao()] }
      },
      detectarContradicoes: async () => ({ contradicoes: [] })
    })

    await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    // O modelo precisa do conteúdo, não do id da opção — mesma regra de `decisoesParaOBrief`.
    expect(pedidos[0]?.decisoes).toEqual([
      expect.objectContaining({ pergunta: 'O produto é local ou na nuvem?', resposta: 'Nuvem' })
    ])
  })
})
```

(`projetos` é o nome da variável do `ProjectRepository` no arquivo; conferir com `grep -n "projects: " src/main/projects/prd-service.int-spec.ts` e usar o nome que estiver lá.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/main/projects/prd-service.int-spec.ts`
Expected: FAIL — `decisions` não é dep aceita, `contradicoes`/`responderContradicao` não existem, o hash muda com o id.

- [ ] **Step 3: Implementar no `prd-service.ts`**

Imports (acrescentar aos existentes):

```ts
import { ETAPA_DA_CONTRADICAO } from '@shared/domain/prd'
import { validarContratoDaPergunta } from '@shared/domain/pergunta-gerada'
import type { Resposta, RespostaOutcome, VistaDoWizard } from '@shared/domain/wizard'
import { decisoesVigentes, estadoDoWizard, montarDecisao } from '@shared/domain/wizard'
import type { DecisionRepository } from './decision-repository'
```

Em `PrdServiceDeps`, depois de `readonly pacotes: PacoteRepository`:

```ts
  /**
   * Onde a resposta a uma contradição é gravada (emenda E1). O **mesmo** repositório das
   * decisões do refinamento e do wizard: a resposta é uma `Decision` como qualquer outra, com
   * `etapa: 'prd'`, e uma tabela própria faria a trilha do projeto ter dois lugares para
   * "quem decidiu o quê".
   */
  readonly decisions: DecisionRepository
```

Na classe, o campo e o construtor: `private readonly decisions: DecisionRepository` e `this.decisions = deps.decisions`.

`hashDoPrd` — trocar a linha das contradições no canônico por:

```ts
    // Sem o id: ele é sorteado a cada geração (emenda E1), e entrar no hash faria duas gerações
    // idênticas virarem duas revisões — o oposto da invariante 2 da CONVENTION §4.
    contradicoes: contradicoes
      .map(({ id: _id, ...resto }) => resto)
      .sort((a, b) => a.enunciado.localeCompare(b.enunciado)),
```

No laço de `gerar`, substituir o bloco que vai de `if (deteccao.contradicoes === undefined) {` até o `continue }` seguinte por:

```ts
      if (deteccao.contradicoes === undefined) {
        problemas = ['A detecção de contradições não devolveu saída.']
        this.anunciar(pedido.projectId, 'contradicoes', 'falhou', problemas[0])
        continue
      }

      // O id é do serviço, não do modelo (emenda E1): "c-1" colidiria entre revisões, e a
      // decisão do PI passaria a apontar para a contradição errada. O contrato da M8-F03 vale
      // sobre a pergunta inteira, e pergunta que o fere **não chega ao PI**: a etapa falha, pelo
      // mesmo caminho da detecção que não saiu — fail closed, nunca "nenhuma contradição".
      const contradicoesDaRevisao = deteccao.contradicoes.map((c) => ({
        ...c,
        id: randomUUID(),
        etapa: ETAPA_DA_CONTRADICAO
      }))
      const recusadas = contradicoesDaRevisao.flatMap((c) =>
        validarContratoDaPergunta(c).problemas.map((p) => p.mensagem)
      )

      if (recusadas.length > 0) {
        problemas = recusadas
        this.anunciar(
          pedido.projectId,
          'contradicoes',
          'falhou',
          `${recusadas.length} ${recusadas.length === 1 ? 'problema' : 'problemas'} no contrato das perguntas.`
        )
        continue
      }
```

E, logo abaixo, trocar `const achadas = deteccao.contradicoes.length` por `const achadas = contradicoesDaRevisao.length` e `const conteudo: ConteudoDoPrd = { ...candidato, contradicoes: deteccao.contradicoes }` por `const conteudo: ConteudoDoPrd = { ...candidato, contradicoes: contradicoesDaRevisao }`.

Na chamada a `this.deps.gerarDocumentos` dentro do laço, trocar `decisoes: this.deps.decisoesDoRefinamento(pedido.projectId),` por:

```ts
        // As decisões do refinamento **e** as respostas às contradições (emenda E1), pelo mesmo
        // campo: para o modelo as duas são "o dono do projeto decidiu", citáveis como `decisao`.
        decisoes: [
          ...this.deps.decisoesDoRefinamento(pedido.projectId),
          ...this.decisoesDasContradicoes(pedido.projectId, userId)
        ],
```

Depois de `cortarProposto`, acrescentar os métodos:

```ts
  /**
   * A vista do pop-up das contradições (emenda E1): a próxima pergunta ou a conclusão, mais o
   * histórico **desta revisão**.
   *
   * Calculada do banco a cada chamada, como o refinamento: fechar o pop-up no meio e reabrir
   * volta à contradição pendente porque a resposta vem das decisões gravadas.
   */
  contradicoes(projectId: string): VistaDoWizard | undefined {
    const userId = this.userId()
    const vigente = this.repository.vigente(userId, projectId)
    if (vigente === undefined) return undefined

    const historico = this.historicoDasContradicoes(vigente.contradicoes, userId, projectId)
    return { estado: estadoDoWizard(vigente.contradicoes, historico), historico }
  }

  /**
   * Registra a resposta do PI (ou a delegação) a uma contradição da revisão vigente.
   *
   * A pergunta tem de ser da revisão **vigente**: responder a uma contradição de revisão antiga
   * gravaria decisão sobre um conflito que já não existe no que o PI está lendo.
   */
  responderContradicao(
    projectId: string,
    resposta: Resposta,
    workspaceId: WorkspaceId
  ): RespostaOutcome {
    const userId = this.userId()
    if (this.projects.findById(userId, projectId) === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const vigente = this.repository.vigente(userId, projectId)
    const pergunta = vigente?.contradicoes.find((c) => c.id === resposta.perguntaId)
    if (vigente === undefined || pergunta === undefined) {
      return {
        reason: 'pergunta-desconhecida',
        mensagem: 'Esta contradição não é da revisão vigente; nada foi gravado.'
      }
    }

    const historico = this.historicoDasContradicoes(vigente.contradicoes, userId, projectId)
    const montada = montarDecisao({
      pergunta,
      resposta,
      anterior: decisoesVigentes(historico)[pergunta.id],
      escopo: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        created_at: new Date().toISOString()
      }
    })
    if ('recusa' in montada) return { reason: montada.recusa, mensagem: montada.mensagem }

    const decisao = montada.decisao
    this.decisions.registrar(decisao)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'planning-decision',
      payload: {
        projectId,
        perguntaId: pergunta.id,
        etapa: decisao.etapa,
        autor: decisao.autor,
        motivo: decisao.motivo,
        escolha: decisao.escolha,
        recomendacao: decisao.recomendacao,
        substituiu: decisao.substituiu
      }
    })

    log.agent.info('Decisão sobre contradição do PRD registrada', {
      projectId,
      perguntaId: pergunta.id,
      autor: decisao.autor
    })

    const atualizado = this.historicoDasContradicoes(vigente.contradicoes, userId, projectId)
    return {
      reason: 'registrada',
      decisao,
      estado: estadoDoWizard(vigente.contradicoes, atualizado),
      mensagem: 'Decisão registrada.'
    }
  }

  /** As decisões que pertencem a estas contradições — e só elas. */
  private historicoDasContradicoes(
    contradicoes: readonly ContradicaoDoPrd[],
    userId: string,
    projectId: string
  ): readonly Decision[] {
    const ids = new Set(contradicoes.map((c) => c.id))
    return this.decisions
      .listar(userId, projectId)
      .filter((d) => d.etapa === ETAPA_DA_CONTRADICAO && ids.has(d.perguntaId))
  }

  /**
   * As respostas às contradições no formato que o pedido de geração cita (emenda E1).
   *
   * Varre **todas** as revisões, e não só a vigente: a decisão foi tomada sobre a contradição de
   * uma revisão, e a geração seguinte — que é quem precisa dela — cria outra. O rótulo, não o
   * id da opção: o modelo precisa do conteúdo (mesma regra de `decisoesParaOBrief`).
   */
  private decisoesDasContradicoes(
    projectId: string,
    userId: string
  ): readonly DecisaoDoRefinamento[] {
    const catalogo = this.repository.listar(userId, projectId).flatMap((r) => r.contradicoes)
    const vigentes = decisoesVigentes(
      this.decisions.listar(userId, projectId).filter((d) => d.etapa === ETAPA_DA_CONTRADICAO)
    )

    return Object.values(vigentes).flatMap((decisao) => {
      const pergunta = catalogo.find((c) => c.id === decisao.perguntaId)
      if (pergunta === undefined) return []

      const rotulo =
        decisao.escolha === null
          ? decisao.texto
          : (pergunta.opcoes.find((o) => o.id === decisao.escolha)?.rotulo ?? decisao.escolha)

      return rotulo === null
        ? []
        : [{ id: decisao.id, pergunta: pergunta.enunciado, resposta: rotulo }]
    })
  }
```

`Decision` precisa entrar no import de tipos de `@shared/domain/wizard` (`import type { Decision, Resposta, RespostaOutcome, VistaDoWizard }`).

- [ ] **Step 4: Ligar o repositório no `index.ts`**

Em `src/main/index.ts`, na construção `const prd = new PrdService({` (~linha 951), acrescentar logo depois de `pacotes: …,`: `decisions: new DecisionRepository(storage.db),` (o `DecisionRepository` já é importado ali — há duas instâncias no arquivo; uma terceira segue o padrão existente).

- [ ] **Step 5: Rodar o int-spec, lint e typecheck**

Run: `npx vitest run src/main/projects/prd-service.int-spec.ts && npx eslint src/main/projects/prd-service.ts src/main/projects/prd-service.int-spec.ts src/main/index.ts && npm run typecheck 2>&1 | grep -v PrdDoProjeto | tail -3`
Expected: PASS; eslint limpo; o typecheck só acusa `PrdDoProjeto.tsx` (Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/main/projects/prd-service.ts src/main/projects/prd-service.int-spec.ts src/main/index.ts
git commit -m "feat: o PrdService responde às contradições e leva as decisões à geração

Contradição ganha id próprio e passa pelo contrato da M8-F03 (fail
closed); a vista e a resposta usam a máquina do wizard; a decisão vai
ao DecisionRepository com etapa prd e entra no pedido seguinte com o
rótulo da opção. O hash ignora o id sorteado.

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: IPC — canais, handlers, preload e as duas listas da ponte

**Files:**
- Modify: `src/shared/contracts/ipc.ts` (canais ~506–509; API ~1126 perto de `gerarPrd`/`carregarPrd`)
- Modify: `src/main/ipc/handlers.ts` (depois do handler `prdCortarProposto`, ~linha 1950; extrair `lerResposta` e usá-la em `refinamentoResponder` ~2046)
- Modify: `src/main/preload/index.ts` (depois de `cortarPropostoDoPrd`, ~linha 548)
- Modify: `src/main/preload/preload.spec.ts` (lista ordenada, ~linha 164) e `tests/e2e/login.e2e.ts` (lista ordenada, ~linha 240)
- Test: `src/main/ipc/handlers.spec.ts`

**Interfaces:**
- Produces: canais `prdContradicoes: 'prd:contradicoes'` e `prdResponderContradicao: 'prd:responder-contradicao'`; API `contradicoesDoPrd(projectId: string, workspace: WorkspaceId): Promise<VistaDoWizard | null>` e `responderContradicaoDoPrd(projectId: string, resposta: Resposta, workspace: WorkspaceId): Promise<RespostaOutcome>`.

- [ ] **Step 1: Testes que falham (handlers e ponte)**

Em `src/main/ipc/handlers.spec.ts`, achar o dublê `prd` (`grep -n "const prd = " src/main/ipc/handlers.spec.ts`) e acrescentar dois métodos a ele:

```ts
  contradicoes: vi.fn(() => undefined),
  responderContradicao: vi.fn(() => ({ reason: 'registrada', mensagem: 'ok' }))
```

Acrescentar um `describe` ao fim do arquivo:

```ts
describe('contradições do PRD (emenda E1) — a fronteira valida forma, o serviço decide', () => {
  it('a vista inválida devolve null, nunca undefined', () => {
    expect(invocar(IPC_CHANNELS.prdContradicoes, 42, 'jarvis')).toBeNull()
    expect(invocar(IPC_CHANNELS.prdContradicoes, 'p-1', 'jarvis')).toBeNull()
    expect(prd.contradicoes).toHaveBeenCalledWith('p-1')
  })

  it('responder exige a forma da resposta — sem ela, nada chega ao serviço', () => {
    const r = invocar(
      IPC_CHANNELS.prdResponderContradicao,
      'p-1',
      { escolha: 'a' },
      'jarvis'
    ) as { reason: string }

    expect(r.reason).toBe('escolha-invalida')
    expect(prd.responderContradicao).not.toHaveBeenCalled()
  })

  it('responder recusa autor fora do enum', () => {
    const r = invocar(
      IPC_CHANNELS.prdResponderContradicao,
      'p-1',
      { perguntaId: 'c-1', escolha: 'a', texto: null, autor: 'terceiro' },
      'jarvis'
    ) as { reason: string }

    expect(r.reason).toBe('escolha-invalida')
    expect(prd.responderContradicao).not.toHaveBeenCalled()
  })

  it('responder repassa a resposta bem formada', () => {
    invocar(
      IPC_CHANNELS.prdResponderContradicao,
      'p-1',
      { perguntaId: 'c-1', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )

    expect(prd.responderContradicao).toHaveBeenCalledWith(
      'p-1',
      { perguntaId: 'c-1', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )
  })
})
```

Nas duas listas ordenadas da ponte (`src/main/preload/preload.spec.ts` e `tests/e2e/login.e2e.ts`), inserir `'contradicoesDoPrd',` imediatamente **antes** de `'cortarPropostoDoPrd',` e `'responderContradicaoDoPrd',` imediatamente **antes** de `'responderPerguntaDaSpec',` (as listas são alfabéticas; conferir com `grep -n "cortarPropostoDoPrd\|responderPerguntaDaSpec"` nos dois arquivos).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/main/ipc/handlers.spec.ts src/main/preload/preload.spec.ts`
Expected: FAIL — canais inexistentes no `IPC_CHANNELS`; a ponte não expõe os dois métodos.

- [ ] **Step 3: Contrato em `ipc.ts`**

Nos canais, depois de `prdCortarProposto: 'prd:cortar-proposto',`:

```ts
  /**
   * As contradições do PRD como perguntas (emenda E1 da SPEC-Jornada-03).
   *
   * Mesma divisão do refinamento: `contradicoes` **lê** a vista do pop-up (pergunta pendente
   * ou conclusão, mais o histórico) e `responder-contradicao` grava — e recebe só o id da
   * pergunta, nunca o enunciado, porque a pergunta vive na revisão gravada e aceitar o texto
   * de volta deixaria o renderer reescrever o que o PI leu.
   */
  prdContradicoes: 'prd:contradicoes',
  prdResponderContradicao: 'prd:responder-contradicao',
```

Na interface da API, logo depois de `cortarPropostoDoPrd(...)`:

```ts
  /** A vista do pop-up das contradições da revisão vigente; `null` sem revisão. */
  contradicoesDoPrd(projectId: string, workspace: WorkspaceId): Promise<VistaDoWizard | null>
  /** Registra a resposta a uma contradição (ou a delegação). Recusa volta como outcome. */
  responderContradicaoDoPrd(
    projectId: string,
    resposta: Resposta,
    workspace: WorkspaceId
  ): Promise<RespostaOutcome>
```

`VistaDoWizard`, `Resposta` e `RespostaOutcome` já são importados de `../domain/wizard` nesse arquivo (conferir na linha ~70).

- [ ] **Step 4: Handlers**

Em `src/main/ipc/handlers.ts`, acrescentar uma função no escopo do módulo (perto dos outros helpers de forma; se não houver, antes da função que registra os handlers — conferir com `grep -n "^function\|^export function" src/main/ipc/handlers.ts | head`):

```ts
/**
 * A **forma** de uma `Resposta` vinda do renderer. O vocabulário — a escolha ser opção real, a
 * delegação ser permitida — é do serviço; barrar aqui duplicaria a regra em dois lugares que
 * divergiriam. `undefined` é "forma inválida", e quem chama decide o outcome.
 */
function lerResposta(resposta: unknown): Resposta | undefined {
  const r = resposta as Partial<Resposta> | null
  if (
    r === null ||
    typeof r !== 'object' ||
    typeof r.perguntaId !== 'string' ||
    (r.escolha !== null && typeof r.escolha !== 'string') ||
    (r.texto !== null && typeof r.texto !== 'string') ||
    (r.autor !== 'pi' && r.autor !== 'agente')
  ) {
    return undefined
  }

  return {
    perguntaId: r.perguntaId,
    escolha: r.escolha ?? null,
    texto: r.texto ?? null,
    autor: r.autor,
    ...(r.aceitarSubstituicao === true ? { aceitarSubstituicao: true } : {})
  }
}
```

No handler `refinamentoResponder`, substituir o bloco de validação inline (de `const r = resposta as Partial<Resposta> | null` até o `return deps.refinamento.responder(...)` inclusive) por:

```ts
      const lida = lerResposta(resposta)
      if (lida === undefined) {
        return { reason: 'escolha-invalida', mensagem: 'Resposta com forma inválida.' }
      }

      return deps.refinamento.responder(projectId, lida, workspace)
```

Depois do handler `prdCortarProposto`, acrescentar:

```ts
  ipcMain.handle(
    IPC_CHANNELS.prdContradicoes,
    (_event, projectId: unknown, workspace: unknown): VistaDoWizard | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.prd.contradicoes(projectId) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prdResponderContradicao,
    (_event, projectId: unknown, resposta: unknown, workspace: unknown): RespostaOutcome => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }

      const lida = lerResposta(resposta)
      if (lida === undefined) {
        return { reason: 'escolha-invalida', mensagem: 'Resposta com forma inválida.' }
      }

      return deps.prd.responderContradicao(projectId, lida, workspace)
    }
  )
```

Se o tipo das deps dos handlers declarar `prd` como `PrdService` (conferir com `grep -n "prd: " src/main/ipc/handlers.ts`), nada mais muda; se for um `Pick<…>`, acrescentar `'contradicoes' | 'responderContradicao'` a ele.

- [ ] **Step 5: Preload**

Em `src/main/preload/index.ts`, depois de `cortarPropostoDoPrd`:

```ts
  contradicoesDoPrd: (projectId: string, workspace: WorkspaceId): Promise<VistaDoWizard | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.prdContradicoes, projectId, workspace),
  responderContradicaoDoPrd: (
    projectId: string,
    resposta: Resposta,
    workspace: WorkspaceId
  ): Promise<RespostaOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.prdResponderContradicao, projectId, resposta, workspace),
```

(`VistaDoWizard`, `Resposta` e `RespostaOutcome` já são importados no preload — conferir com `grep -n "VistaDoWizard\|RespostaOutcome" src/main/preload/index.ts | head -3`.)

- [ ] **Step 6: Rodar handlers, preload, lint e typecheck**

Run: `npx vitest run src/main/ipc/handlers.spec.ts src/main/preload/preload.spec.ts && npx eslint src/shared/contracts/ipc.ts src/main/ipc/handlers.ts src/main/preload/index.ts src/main/ipc/handlers.spec.ts src/main/preload/preload.spec.ts tests/e2e/login.e2e.ts && npm run typecheck 2>&1 | grep -v PrdDoProjeto | tail -3`
Expected: PASS; eslint limpo; typecheck só acusa `PrdDoProjeto.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/contracts/ipc.ts src/main/ipc/handlers.ts src/main/ipc/handlers.spec.ts src/main/preload/index.ts src/main/preload/preload.spec.ts tests/e2e/login.e2e.ts
git commit -m "feat: canais prd:contradicoes e prd:responder-contradicao na ponte

A forma da Resposta passa a ser lida por uma função só, usada pelo
refinamento e pelas contradições do PRD.

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Tela — o pop-up abre sozinho, a resposta grava, a última regera

**Files:**
- Modify: `src/renderer/src/app/WizardDoProjeto.tsx` (props ~52–70; `Dialog` ~175–180)
- Modify: `src/renderer/src/app/PrdDoProjeto.tsx` (estado ~283–330; seção das contradições ~446–480; render do pop-up ao fim do componente)
- Modify: `src/renderer/src/i18n/recursos.ts` (bloco `prd`, chaves `contradicoesDescricao` e novas)
- Test: `src/renderer/src/app/prd.test.tsx`

**Interfaces:**
- Consumes: `window.jarvis.contradicoesDoPrd`, `window.jarvis.responderContradicaoDoPrd` (Task 4); `WizardDoProjeto` com `fonte`.
- Produces: `WizardDoProjeto` ganha props opcionais `titulo?: string` e `descricao?: string` (sem elas, os textos de `wizard.*` como hoje).

- [ ] **Step 1: Testes que falham**

Em `src/renderer/src/app/prd.test.tsx`:

1. Junto dos outros `vi.fn()`: `const contradicoesDoPrd = vi.fn()` e `const responderContradicaoDoPrd = vi.fn()`. No `beforeEach`: `contradicoesDoPrd.mockReset().mockResolvedValue(null)` e `responderContradicaoDoPrd.mockReset().mockResolvedValue({ reason: 'registrada', mensagem: 'ok' })`; e no objeto `window.jarvis`: `contradicoesDoPrd, responderContradicaoDoPrd,`.
2. Substituir o `describe('contradições (critério 6)', …)` inteiro por:

```ts
describe('contradições — pergunta no pop-up da M8-F03 (critério 6, emenda E1)', () => {
  const CONTRADICAO = {
    id: 'c-1',
    etapa: 'prd',
    afirmacoes: ['a-1', 'b-1'],
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync entre máquinas.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige conta e rede.' }
    ],
    recomendada: 'a',
    justificativa: 'Local, como o brief diz.',
    aceitaTextoLivre: true,
    delegavel: true
  }
  const COM_CONTRADICAO = prd({ contradicoes: [CONTRADICAO] })
  const VISTA_PENDENTE = {
    estado: { tipo: 'pergunta', pergunta: CONTRADICAO, restantes: 1 },
    historico: []
  }

  it('o pop-up abre sozinho com a pergunta e as opções, e a recomendada vem primeiro', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/O produto é local ou na nuvem/i)).toBeInTheDocument()
    const opcoes = within(dialogo).getAllByRole('radio')
    expect(opcoes[0]).toHaveAccessibleName(/Local/)
    expect(opcoes[0]).not.toBeChecked()
    expect(within(dialogo).getByRole('button', { name: /Decide por mim/i })).toBeInTheDocument()
  })

  it('a lista inline mostra a pergunta e a justificativa, nunca uma correção aplicada', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    const lista = await screen.findByTestId('prd-contradicoes')
    expect(within(lista).getByText(/O produto é local ou na nuvem/i)).toBeInTheDocument()
    expect(within(lista).getByText(/Local, como o brief diz/i)).toBeInTheDocument()
  })

  it('trava o aceite, com a razão ao lado do botão', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    expect(await screen.findByRole('button', { name: /Aceitar o PRD/i })).toBeDisabled()
    expect(screen.getByText(/Resolva as contradições/i)).toBeInTheDocument()
  })

  it('responder a última contradição gera os documentos de novo, sozinho, com o termo confirmado', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    responderContradicaoDoPrd.mockResolvedValue({
      reason: 'registrada',
      mensagem: 'ok',
      estado: { tipo: 'concluido', decisoes: [] }
    })
    montar()

    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(within(dialogo).getByRole('radio', { name: /Nuvem/ }))
    await userEvent.click(within(dialogo).getByRole('button', { name: /Confirmar/i }))

    await waitFor(() =>
      expect(gerarPrd).toHaveBeenCalledWith('p-1', 'ferramentas de leitura', 'jarvis')
    )
    expect(responderContradicaoDoPrd).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ perguntaId: 'c-1', escolha: 'b', autor: 'pi' }),
      'jarvis'
    )
  })

  it('com contradição que sobra, responder não regera — só avança para a próxima', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    responderContradicaoDoPrd.mockResolvedValue({
      reason: 'registrada',
      mensagem: 'ok',
      estado: { tipo: 'pergunta', pergunta: { ...CONTRADICAO, id: 'c-2' }, restantes: 1 }
    })
    montar()

    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(within(dialogo).getByRole('radio', { name: /Nuvem/ }))
    await userEvent.click(within(dialogo).getByRole('button', { name: /Confirmar/i }))

    await waitFor(() => expect(responderContradicaoDoPrd).toHaveBeenCalled())
    expect(gerarPrd).not.toHaveBeenCalled()
  })

  it('fechar o pop-up deixa o botão de reabrir na lista', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(within(dialogo).getByRole('button', { name: /Fechar/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Responder às contradições/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
```

Acrescentar `within` ao import de `@testing-library/react`. Antes de escrever a implementação, conferir como o pop-up nomeia os controles (`grep -n "role=\|aria-label\|Confirmar\|type=\"radio\"\|Radio" src/renderer/src/app/WizardDoProjeto.tsx`) e, se as opções forem botões e não `radio`, ajustar os seletores dos testes para `getAllByRole('button', …)` mantendo as mesmas asserções — a garantia (recomendada primeiro, sem pré-seleção, "Decide por mim" presente) é a mesma; ver `wizard.test.tsx` para os seletores que já provam isso.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/app/prd.test.tsx`
Expected: FAIL — o pop-up não abre; `c.pergunta` indefinido; `gerarPrd` não é chamado.

- [ ] **Step 3: `WizardDoProjeto` — título e descrição por prop**

Em `WizardDoProjetoProps`, acrescentar:

```ts
  /**
   * Título e descrição do pop-up. Ausentes, os do planejamento (`wizard.*`). As contradições do
   * PRD (emenda E1) conduzem a mesma decisão, mas o PI precisa ler **por que** está sendo
   * perguntado — e "Planejamento de X" diria que ele voltou ao refinamento.
   */
  readonly titulo?: string
  readonly descricao?: string
```

Desestruturar `titulo` e `descricao` nos parâmetros do componente e, no `Dialog`, trocar por `titulo={titulo ?? t('wizard.titulo', { nome: nomeDoProjeto })}` e `descricao={descricao ?? t('wizard.descricao')}`.

- [ ] **Step 4: i18n**

No bloco `prd` de `src/renderer/src/i18n/recursos.ts`, trocar `contradicoesDescricao` e acrescentar as chaves:

```ts
        contradicoesDescricao:
          'Duas afirmações não podem valer ao mesmo tempo. Responda uma por vez; quando a última for respondida, os três documentos são gerados de novo com as suas decisões. Nada é corrigido sozinho.',
        contradicoesRespondidas:
          'Todas respondidas. Se a geração automática não saiu, gere de novo para aplicar as decisões.',
        responderContradicoes: 'Responder às contradições',
        contradicoesPopupTitulo: 'Contradições de {{nome}}',
        contradicoesPopupDescricao:
          'Uma decisão por vez. A recomendação vem primeiro, mas a escolha é sua — e ao responder a última, os documentos são gerados de novo.',
```

`recomendacao: 'Recomendação: {{texto}}'` continua e passa a receber a `justificativa`.

- [ ] **Step 5: `PrdDoProjeto` — estado, pop-up e regeração**

Imports: `import { WizardDoProjeto } from './WizardDoProjeto'`; `import type { Resposta, RespostaOutcome, VistaDoWizard } from '@shared/domain/wizard'`; garantir `Button`, `InlineAlert` já importados de `@design/ui` (estão) e `MessagesSquare` de `lucide-react` (acrescentar ao import existente de `Sparkles`/`X`).

No componente `PrdDoProjeto`, depois de `const [falhaNoAceite, …]`:

```ts
  /**
   * A vista do pop-up das contradições (emenda E1) e se ele está aberto.
   *
   * A vista é lida do main **junto** da revisão: é ela que diz se ainda há pergunta ou se todas
   * foram respondidas — a tela não conta decisões por conta própria. O pop-up abre sozinho
   * quando a revisão que acabou de chegar tem pergunta pendente; fechar é permitido (o PI pode
   * querer ler os documentos antes), e o botão da lista reabre onde parou.
   */
  const [vista, setVista] = useState<VistaDoWizard | null>(null)
  const [respondendo, setRespondendo] = useState(false)
```

Trocar o `carregar` existente por:

```ts
  const carregar = useCallback(async (): Promise<void> => {
    try {
      const [atual, contradicoes] = await Promise.all([
        window.jarvis.carregarPrd(projectId, workspace),
        window.jarvis.contradicoesDoPrd(projectId, workspace)
      ])
      setPrd(atual)
      setVista(contradicoes)
      setRespondendo(contradicoes?.estado.tipo === 'pergunta')
    } catch (error: unknown) {
      log.ui.error('Falha ao carregar o PRD', { error })
    } finally {
      setCarregando(false)
    }
  }, [projectId, workspace])
```

E o `useEffect` de carga inicial (o que chama `window.jarvis.carregarPrd(...).then(...)`) por:

```ts
  useEffect(() => {
    let ativo = true

    Promise.all([
      window.jarvis.carregarPrd(projectId, workspace),
      window.jarvis.contradicoesDoPrd(projectId, workspace)
    ])
      .then(([atual, contradicoes]) => {
        if (!ativo) return
        setPrd(atual)
        setVista(contradicoes)
        setRespondendo(contradicoes?.estado.tipo === 'pergunta')
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o PRD', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])
```

Acrescentar, depois de `cortar`:

```ts
  /**
   * Responde a uma contradição pelo pop-up e, **na última**, gera os documentos de novo
   * (decisão do PI, 2026-09-06). O gatilho vive aqui, e não no main, porque é a tela que tem o
   * termo de pesquisa confirmado — a geração é o mesmo ato do botão, com o mesmo termo.
   */
  async function responder(resposta: Resposta): Promise<RespostaOutcome> {
    const desfecho = await window.jarvis.responderContradicaoDoPrd(projectId, resposta, workspace)
    if (desfecho.reason === 'registrada' && desfecho.estado?.tipo === 'concluido') {
      setRespondendo(false)
      void gerar()
    }
    return desfecho
  }
```

Na seção das contradições (o `<section data-jos-contradicoes …>`), trocar o conteúdo por:

```tsx
            <section
              data-jos-contradicoes
              data-testid="prd-contradicoes"
              className="flex flex-col gap-2"
            >
              <InlineAlert
                tom="warn"
                titulo={t('prd.contradicoesTitulo', { count: prd.contradicoes.length })}
              >
                {vista?.estado.tipo === 'concluido'
                  ? t('prd.contradicoesRespondidas')
                  : t('prd.contradicoesDescricao')}
              </InlineAlert>

              <ul className="flex flex-col gap-3">
                {prd.contradicoes.map((c) => (
                  <li
                    key={c.id}
                    data-jos-contradicao={c.id}
                    className="flex flex-col gap-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] p-4"
                  >
                    <p className="max-w-[58ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
                      {c.enunciado}
                    </p>
                    <p className="max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                      {t('prd.recomendacao', { texto: c.justificativa })}
                    </p>
                  </li>
                ))}
              </ul>

              {vista?.estado.tipo === 'pergunta' && (
                <div>
                  <Button
                    variante="primaria"
                    onClick={() => setRespondendo(true)}
                    desabilitado={ocupado}
                    iconeInicial={<MessagesSquare aria-hidden="true" className="size-4" />}
                  >
                    {t('prd.responderContradicoes')}
                  </Button>
                </div>
              )}
            </section>
```

E, no fim do JSX do componente (antes do `</div>` que fecha `flex flex-col gap-5`), o pop-up:

```tsx
      {respondendo && (
        <WizardDoProjeto
          workspace={workspace}
          projectId={projectId}
          nomeDoProjeto={nomeDoProjeto}
          aberto
          titulo={t('prd.contradicoesPopupTitulo', { nome: nomeDoProjeto })}
          descricao={t('prd.contradicoesPopupDescricao')}
          /*
           * A contradição é a mesma decisão que o refinamento conduz (M8-F03), com outra origem:
           * a pergunta vive na revisão do PRD, e a resposta vai ao mesmo repositório de decisões.
           */
          fonte={{
            ler: () => window.jarvis.contradicoesDoPrd(projectId, workspace),
            responder
          }}
          onFechar={() => setRespondendo(false)}
        />
      )}
```

- [ ] **Step 6: Rodar o teste da tela, o do wizard, lint e typecheck**

Run: `npx vitest run src/renderer/src/app/prd.test.tsx src/renderer/src/app/wizard.test.tsx && npx eslint src/renderer/src/app/PrdDoProjeto.tsx src/renderer/src/app/WizardDoProjeto.tsx src/renderer/src/app/prd.test.tsx src/renderer/src/i18n/recursos.ts && npx prettier --check src/renderer/src/app/PrdDoProjeto.tsx src/renderer/src/app/WizardDoProjeto.tsx src/renderer/src/app/prd.test.tsx src/renderer/src/i18n/recursos.ts && npm run typecheck`
Expected: tudo PASS; typecheck limpo (era o último arquivo pendente).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/app/PrdDoProjeto.tsx src/renderer/src/app/WizardDoProjeto.tsx src/renderer/src/app/prd.test.tsx src/renderer/src/i18n/recursos.ts
git commit -m "feat: a contradição do PRD é respondida no pop-up, e a última regera os documentos

O pop-up do wizard abre sozinho com a pergunta pendente; a resposta vai
ao main e, quando a vista conclui, a tela gera de novo com o termo
confirmado. A lista inline vira resumo com o botão de reabrir.

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Verificação inteira, smoke real, revisão, relatório, PR e board

**Files:**
- Modify: `reports/TESTS.md` (gerado)
- Modify (depois do merge, em PR próprio): `docs/STATUS.md`, `docs/DEVELOPMENT.md`

- [ ] **Step 1: Suíte completa, lint do repositório e typecheck**

Run: `npx vitest run 2>&1 | tail -8 && npm run lint 2>&1 | tail -3 && npm run typecheck && echo OK`
Expected: 0 falhas (o único "Errors 1 error" tolerável é o worker morto do pool, #232, **sem** arquivo perdido: 187+ arquivos executados); lint limpo; `OK`.

- [ ] **Step 2: Smoke real da detecção (CLI de verdade)**

Criar `src/main/ai/zz-exp-307.smoke.int-spec.ts` (temporário, **não commitar**) que chama o `ClaudeCodeAdapter` real com `system: SISTEMA_DAS_CONTRADICOES`, `jsonSchema: SCHEMA_DAS_CONTRADICOES`, `fase: 'planejamento'` e o prompt de `promptDasContradicoes` sobre cinco afirmações com duas contradições claras (multi-select × material único; offline total × cotação por API), e imprime `JSON.parse(texto)` e o resultado de `validarContratoDaPergunta` para cada item. Rodar com `npx vitest run src/main/ai/zz-exp-307.smoke.int-spec.ts` (timeout 180 s). Esperado: cada contradição com 2–3 opções, `recomendada` entre elas, `valida: true`. Se o modelo devolver opção sem impacto ou 4 opções, ajustar **o system** (não o validador) e repetir. Apagar o arquivo ao terminar: `rm src/main/ai/zz-exp-307.smoke.int-spec.ts`.

- [ ] **Step 3: Smoke no app**

`npm run build`, subir o app, gerar o PRD num projeto com brief aceito. Esperado: o pop-up abre com a primeira contradição; escolher; "Decide por mim" na delegável; na última, a barra do console recomeça sozinha e a revisão nova chega. Conferir no `jarvis.db`: `select etapa, autor, motivo, escolha from decision where etapa='prd'`.

- [ ] **Step 4: Revisão de código**

Rodar a revisão padrão do repositório (skill `code-review`) sobre `git diff main...HEAD` antes de abrir o PR; corrigir o que for CRITICAL/HIGH no próprio branch.

- [ ] **Step 5: Push e PR**

```bash
git push origin fix/contradicao-vira-pergunta
gh pr create --base main --head fix/contradicao-vira-pergunta --title "[MVP25][SPEC-Jornada-03][FIX] Contradição do PRD vira pergunta no pop-up da M8-F03, e a resposta regera os documentos" --body-file <corpo com: sintoma, fontes documentadas, emenda E1, as peças (domínio, montarDecisao, serviço, IPC, tela), medições do smoke, testes por categoria, "refs #307", rodapé "🤖 Generated with [Claude Code](https://claude.com/claude-code)">
```

- [ ] **Step 6: Relatório de entrega com o ambiente do CI**

```bash
npx supabase status | head -2     # stack no ar; senão: npx supabase start
REPORT_PR='#<PR>' REPORT_PR_URL='https://github.com/RodReis/rrb-jarvisOS/pull/<PR>' REPORT_ISSUE='#307' REPORT_SPEC='spec-jornada-03-prd-landscape-convention-por-ia' REPORT_DATE='2026-09-06' npm run test:report
REPORT_ISSUE='#307' REQUIRE_ENTRY=1 npm run test:report:check -- --require-entry
git add reports/TESTS.md && git commit -m "chore: carimba a entrega #307 no histórico de reports/TESTS.md

refs #307

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push
```

- [ ] **Step 7: CI, merge e board**

```bash
gh run list --branch fix/contradicao-vira-pergunta --limit 1     # pegar o id do run em fila
gh run watch <id> --exit-status --interval 30                     # em segundo plano
gh pr merge <PR> --squash --delete-branch
gh issue edit 307 --remove-label proplan:doing --add-label proplan:done
gh issue comment 307 --body "Entregue no PR #<PR>, mergeado na main em 2026-09-06 (<sha>), CI verde. Movido para Feito (proplan:done) — aguardando o aceite do PI."
```

O card já está em `proplan:doing` desde a escrita deste plano.

- [ ] **Step 8: Registro em STATUS.md e DEVELOPMENT.md (PR de docs, a partir da `main` já com o merge)**

Branch `docs/registra-merge-307`; linha em `docs/STATUS.md` logo abaixo da linha `| Feito | [#304]…` e entrada em `docs/DEVELOPMENT.md` no topo do Registro de entregas (depois da linha `|---|---|---|---|`), no mesmo formato das linhas vizinhas, contando: o achado do PI, a premissa que a spec já tinha, a emenda E1, as peças (domínio, `montarDecisao`, serviço, IPC, tela), a medida do smoke real, os números do relatório, e o limite declarado (regeração parcial fica para a próxima entrega; cópia do `WizardService` continua). PR `docs: registra o merge da correção #307` com `refs #307`; merge após CI verde. Ao fim, **perguntar ao PI** se pode rodar `/graphify . --update`.

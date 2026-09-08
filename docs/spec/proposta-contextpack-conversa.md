# Proposta ao PI — o `ContextPack` não comporta conversa

Levantada pelo Code em 2026-09-08, ao começar a **M17-F03** ([#204](https://github.com/RodReis/rrb-jarvisOS/issues/204)).
Não é decisão tomada: é o problema técnico e as opções, para o PI escolher. Nenhuma linha de
código foi alterada.

A própria SPEC-Voz-03 previu este momento (§ Decisões cravadas pelo Cowork):

> *"se o formato do pack do M8-F02 não comportar conversa (manifesto pensado para geração
> documental), o Code **aponta o problema técnico** e a correção passa pelo PI — nunca licença
> para bypass do gate."*

## O problema, verificado no código

A SPEC-Voz-03 exige (critério 3) que a conversa declare um `ContextPack` próprio — persona,
snapshot do app e janela de histórico —, e que a chamada sem pack continue sendo recusada. O
formato atual **não aceita** esse pack. Duas paredes, ambas confirmadas lendo os arquivos:

### 1. `projectId` é obrigatório e verificado contra o repositório

`src/main/context/context-service.ts:219`

```ts
const project = this.projects.findById(userId, pedido.projectId)

if (project === undefined || project.workspace_id !== workspaceId) {
  return this.recusar(userId, workspaceId, 'projeto-desconhecido', pedido, { … })
}
```

Uma conversa com o JARVIS não tem projeto. Perguntar *"o que está na fila?"* é sobre o **app**,
não sobre um projeto — e é exatamente o que o critério 6 pede que o snapshot responda.

No banco, `project_id TEXT NOT NULL` (`migrations.ts:536`).

### 2. `itens` não pode ser vazio, e um item só nasce de arquivo em disco

`src/main/context/context-service.ts:274`

```ts
if (itens.length === 0) {
  return this.recusar(userId, workspaceId, 'contexto-vazio', pedido, { … })
}
```

E o item, quando nasce (`context-service.ts:251`), carrega `caminho` **relativo à raiz do
projeto** e `hash` do conteúdo lido por `readFileSync`, depois de `resolverDentroDoProjeto`
recusar tudo que esteja fora do diretório.

O `SnapshotDoApp` que a spec pede é montado em memória, a partir do banco local. Não tem caminho
relativo nem arquivo a hashear. O mesmo vale para o texto da persona e para a janela de histórico.

## Por que os três contornos são o defeito que a spec nomeia

| Contorno | Por que não |
|---|---|
| `diagnostico: true` | É o carve-out **nomeado**, e o comentário em `call-provider.ts:222-224` já recusa este uso: ele existe porque *"o painel de teste do Settings verifica se o provider responde e não gera nada para projeto nenhum"*, e é a **única** exceção — *"fosse a exceção 'não informou pack', todo esquecimento viraria diagnóstico por omissão"*. Uma conversa **gera**, e para um usuário |
| Gravar o snapshot num arquivo temporário sob algum projeto | Segundo caminho disfarçado, e obriga a escolher um `projectId` arbitrário para uma conversa que não tem projeto |
| Chamar o adapter Ollama direto | Perde gate, auditoria, `CostEvent` e console de uma vez — mata o critério 2 da própria SPEC-Voz-03 |

## O que a mudança custa, medido

A superfície é **menor do que parece**. `projectId` do pack é lido em quatro lugares fora dos
testes:

| Arquivo | Linha | O que faz |
|---|---|---|
| `context-service.ts` | 129 | entra no hash canônico |
| `context-service.ts` | 219 | a verificação que recusa |
| `context-service.ts` | 584, 593 | monta o pack e a recusa |
| `context-repository.ts` | 184 | grava a coluna |

Mais o schema (`migrations.ts:536`) e o tipo (`context-pack.ts:143`).

O repositório **já tem o padrão de campo novo sem quebrar hash existente** — o comentário do
`pathsPermitidos` no `hashDoPack` (`context-service.ts:152-158`) explica: o `?? ''` no fim
preserva o hash dos packs já persistidos, porque *"ausência continua hasheando como ausência"*.
Um campo novo seguindo essa regra não invalida nada gravado.

## Três opções

### Opção A — `projectId` opcional + origem sintética *(recomendada)*

O manifesto passa a admitir contexto que não vem de arquivo:

1. `ContextPack.projectId` vira `string | undefined`. Ausente significa **contexto do app, não de
   um projeto** — não é "faltou preencher".
2. `ORIGENS_DE_CONTEXTO` (`context-pack.ts:34`) ganha um valor: `'estado-do-app'`. A união é
   fechada de propósito — quem audita precisa distinguir "o usuário anexou" de "o `rg` casou", e
   agora também de "o app resumiu o próprio estado".
3. Um item dessa origem tem `hash` do **texto gerado** em vez do arquivo lido, e `caminho` vira um
   identificador lógico (`app://snapshot`, `app://persona`). O `bytes` continua medido, então o
   teto de contexto continua valendo.
4. `migrations.ts`: nova migration recriando `context_pack` com `project_id` anulável (SQLite não
   tem `DROP NOT NULL`), preservando as linhas.

**A favor:** o gate continua valendo integralmente para a conversa — pack declarado, hasheado,
auditado, com teto de tokens. O MVP-019 (push) vai precisar do mesmo, então a mudança serve as
duas. E torna explícito no manifesto o que hoje seria invisível: que parte do contexto **não veio
de arquivo nenhum**.

**Contra:** mexe num contrato entregue e testado (M8-F02). Exige migration de recriação de tabela,
que é a operação mais delicada do arquivo.

### Opção B — pack de conversa como tipo separado

Um `ConversationPack` ao lado do `ContextPack`, com o `AiCallService` aceitando os dois.

**A favor:** não toca o contrato existente; zero risco de regressão no M8-F02.

**Contra:** é a segunda fonte que a spec passa a fatia inteira evitando. Duas estruturas para a
mesma pergunta ("o que foi enviado ao modelo?") significam dois lugares para auditar, dois hashes
e dois caminhos de gate a manter em paralelo. O `VerificadorDeContexto` (`call-provider.ts:74`)
teria de conhecer os dois.

### Opção C — adiar a M17-F03

A fatia volta para Backlog até o contrato ser decidido; a fila segue para outro card.

**A favor:** nada é decidido às pressas por causa de uma fatia.

**Contra:** o loop de voz fica pela metade — o app ouve e fala, mas não responde. As duas fatias
entregues (#200, #202) não se ligam.

## O que eu faria, e por quê

**Opção A.** O `ContextPack` foi desenhado quando o único chamador era geração documental sobre
projeto; a conversa é o primeiro caso legítimo de contexto que não vem de disco, e o MVP-019 será
o segundo. Um formato que admite isso **explicitamente** é mais honesto que um que o proíbe e
depois é contornado — e a origem fechada é exatamente o mecanismo que o repositório já usa para
tornar visível de onde cada pedaço veio.

Se você aprovar, a mudança do contrato deve entrar como **emenda registrada** (na SPEC-Voz-03 ou
na do M8-F02, como você preferir) antes de eu codificar, para que a decisão fique versionada e não
escondida num commit de implementação.

## Dois achados menores, para a mesma decisão

1. **Não existe guarda de lint isolando o adapter Ollama.** O bloco `no-restricted-imports` do
   `eslint.config.js` (linhas 80-126) cobre `@anthropic-ai/*` e os runtimes de whisper; o Ollama
   fala por `fetch` HTTP, sem SDK npm, então não há import a restringir. A garantia de "nenhum
   caminho paralelo ao ponto único" para o Ollama é hoje **teste e revisão**, não lint. Se você
   quiser paridade, dá para restringir o **módulo** (`ollama-adapter`) em vez do pacote.
2. **A `Persona` é escopada a `user_id + workspace_id`, mas a aba `voz` do Settings é
   declaradamente do usuário** — o critério está escrito na própria tela
   (`Settings.tsx:32-38`). Ou a persona vai para uma aba escopada (`ia`/`roteamento`), ou aquele
   comentário deixa de ser verdade e precisa ser reescrito.

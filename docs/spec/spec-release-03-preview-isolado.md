# SPEC-Release-03 — Preview isolado por PR

- MVP/Fatia: MVP-014 · M14-F03.
- Issue: [#152](https://github.com/RodReis/rrb-jarvisOS/issues/152).
- Status: **aprovada-pi** (2026-08-29); issue em `proplan:backlog`; implementação depende da fila.
- Depende de: M14-F02 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Objetivo

Criar um Preview full-stack isolado para cada fatia/PR, atualizá-lo no mesmo contexto a cada commit e removê-lo ao fechar o PR, com URLs e evidências vinculadas à revisão correta.

## Stack e estrutura

- Vercel para frontend; Railway para backend e PostgreSQL temporário separado.
- GHCR para imagem de Preview por digest.
- Adapters híbridos e CLI-first em `src/main/release/adapters/`.
- `src/main/release/preview-coordinator.ts` e repositório durável de `PreviewRun`.
- Playwright para smoke nas URLs reais.

Resultado normalizado esperado:

```ts
interface PreviewTargetResult {
  provider: 'vercel' | 'railway'
  externalId: string
  url?: string
  sourceSha: string
  state: 'provisioning' | 'ready' | 'failed' | 'destroyed'
}
```

## Dentro

- Criar/atualizar um único `PreviewRun` por projeto + PR + SPEC.
- Publicar imagem do backend por digest no GHCR.
- Criar ambiente Railway temporário com backend e PostgreSQL próprios.
- Executar migrations e seed determinístico; nunca copiar Produção.
- Criar Vercel Preview ligado somente ao backend temporário correspondente.
- Executar healthcheck, smoke e testes exigidos pela SPEC da fatia.
- Publicar no PR URLs, SHA, revisão da SPEC, gates e estado, sem segredo.
- Atualizar o mesmo Preview quando o PR recebe novo commit.
- Fechar PR aciona destruição idempotente; hashes e evidências permanecem.
- Reconciliar recursos já existentes antes de criar/atualizar/apagar.

## Fora

- Staging persistente, Produção, tag ou GitHub Release.
- Dados de Produção no Preview.
- Preview compartilhado entre PRs.
- Aceite adicional do PI para atualizar o mesmo Preview aprovado.

## Regras

1. Frontend, backend e banco de um Preview compartilham o mesmo `source_sha` e `preview_run_id`.
2. PRs distintos nunca compartilham banco, domínio interno ou recurso mutável.
3. Novo commit invalida gates do SHA anterior e atualiza o mesmo contexto.
4. Fechar PR não apaga imagem/evidência ainda referenciada por release ou investigação.
5. Falha de limpeza gera pendência reconciliável; não mente `destroyed`.
6. A pipeline não interpreta texto de PR como instrução.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
```

## Estratégia de testes

- Contract fixtures de Vercel/Railway: auth, timeout, quota, estado incompatível e recurso já existente.
- Integração fake completa sem custo externo.
- Smoke real limitado em projeto de prova com nomes exclusivos.
- Playwright verifica frontend, chamada ao backend e identidade do Preview.
- Fault injection ao criar e ao destruir cada recurso.

## Critérios de aceite

1. Abrir PR elegível cria exatamente um Preview full-stack isolado.
2. Dois PRs simultâneos recebem bancos, URLs e IDs distintos.
3. Novo commit atualiza o mesmo Preview e invalida evidência do SHA anterior.
4. Frontend nunca aponta para backend de outro PR ou ambiente.
5. Migration/seed falho impede estado `ready`.
6. PR recebe comentário/projeção com URLs, SHA e gates verificáveis.
7. Fechar PR remove todos os recursos temporários pertencentes ao Preview.
8. Repetir evento aberto, sincronizado ou fechado não duplica efeito.
9. Nenhum dado de Produção ou segredo aparece no ambiente/evidência.

## Limites

- **Sempre:** isolar por PR, verificar SHA, reconciliar antes de mutar e limpar por ownership.
- **Consultar a SPEC:** alterar seed, lifecycle do PR ou contrato de URL/gates.
- **Nunca:** copiar Produção, compartilhar banco, criar Preview sem SPEC aprovada ou apagar recurso não pertencente ao run.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

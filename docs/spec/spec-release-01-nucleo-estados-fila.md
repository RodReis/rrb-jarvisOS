# SPEC-Release-01 — Núcleo de release e fila

- MVP/Fatia: MVP-014 · M14-F01.
- Issue: ainda não criada.
- Status: **aprovada-pi** (2026-08-29); implementação depende da fila e de issue ainda não criada.
- Depende de: MVP-013 concluído.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Objetivo

Criar o núcleo determinístico que representa Preview e Release, serializa publicação por projeto, persiste cada efeito e retoma do último estado confirmado sem conhecer Vercel, Railway, GHCR ou Docker.

## Stack e estrutura

- Node.js `>=22`, TypeScript 5.9, Electron main e `better-sqlite3` já adotados.
- `src/shared/domain/release.ts`: entidades, estados, resultados e invariantes puros.
- `src/shared/contracts/release.ts`: requests/eventos/resultados que podem atravessar IPC/CLI.
- `src/main/release/`: `ReleaseQueue`, `ReleaseOrchestrator`, `PreviewCoordinator`, gates e ports.
- `src/main/storage/`: migrations/repositórios duráveis.
- Testes unitários ao lado do domínio; integração SQLite como `*.int-spec.ts`.

Estilo de contrato esperado:

```ts
type ReleaseStatus =
  | 'queued'
  | 'preparing'
  | 'staging'
  | 'production'
  | 'stabilizing'
  | 'completed'
  | 'superseded'
  | 'failed'
  | 'degraded'

interface ReleaseStepRecord {
  releaseId: string
  environment: 'staging' | 'production'
  step: string
  idempotencyKey: string
  state: 'intended' | 'confirmed' | 'ambiguous' | 'failed'
}
```

## Dentro

- `PreviewRun`, `ReleaseRun`, `Artifact`, `Deployment`, `MigrationExecution`, `GateResult`, `ConfigurationReference` e `CompensationExecution`.
- Máquina de estados geral e diário por ambiente.
- Chave idempotente `project_id + environment + release_id + step`.
- Lease de writer único e expiração retomável.
- Uma release ativa por projeto/ambiente; projetos diferentes podem avançar em paralelo.
- Consolidação de SHAs somente enquanto o candidato não entrou em Staging; intermediários viram `superseded`.
- Ports tipados para adapters fake e futuros adapters reais.
- CLI observável para consultar fila, release, passos, gates e motivo de bloqueio.
- Eventos e `AuditEvent` para toda transição.

## Fora

- Executar provider real, Docker, build ou deploy.
- Criar Preview remoto, Staging ou Produção.
- Gerar tag, release ou issue.
- UI de controle; UI futura apenas projeta o contrato.

## Regras

1. Transição inválida falha fechada e gera evidência.
2. Retomada começa no último passo `confirmed`; estado `ambiguous` exige reconciliação pelo port.
3. Reutilizar idempotency key com payload diferente é conflito.
4. SHA e artefatos ficam imutáveis no início de Staging.
5. Preview e Release são entidades distintas; Preview nunca recebe identidade de Produção.
6. Documento/relatório incompleto não altera o estado técnico da release.
7. Nenhum campo do domínio comporta valor de segredo.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Unitários: todas as transições válidas/inválidas, consolidação e invariantes.
- Property tests: sequências aleatórias nunca criam duas releases ativas do mesmo projeto/ambiente.
- Integração SQLite: crash entre intenção e confirmação, lease expirado e reconstrução integral.
- Contrafactual: remover a guarda de idempotência deve duplicar passo e fazer o teste falhar.

## Critérios de aceite

1. Estado persistido sobrevive a encerramento forçado e retoma sem repetir passo confirmado.
2. Duas tentativas concorrentes no mesmo projeto concedem lease a apenas um writer.
3. Projetos diferentes podem manter releases ativas simultaneamente.
4. SHA novo consolida candidato em `queued`; depois de Staging cria próximo candidato.
5. Payload diferente com a mesma chave é rejeitado.
6. Estado ambíguo nunca é repetido antes de reconciliação.
7. CLI reconstrói timeline, candidato atual, fila e ação mínima de retomada.
8. Adapters fake provam que o núcleo não importa SDK/CLI de provider.
9. Logs, eventos e persistência não contêm campo para segredo.

## Limites

- **Sempre:** persistir intenção antes de efeito; auditar transição; testar contrafactual.
- **Consultar a SPEC:** mudança de estados públicos, schema persistido ou contrato IPC/CLI.
- **Nunca:** inferir aprovação, chamar provider real, guardar segredo ou permitir segundo writer.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

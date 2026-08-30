# SPEC-Release-02 — Docker, artefatos e configuração

- MVP/Fatia: MVP-014 · M14-F02.
- Issue: [#151](https://github.com/RodReis/rrb-jarvisOS/issues/151).
- Status: **aprovada-pi** (2026-08-29); issue em `proplan:backlog`; implementação depende da fila.
- Depende de: M14-F01 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Objetivo

Provar localmente a preparação de uma release: subir o ambiente oficial por Docker Compose, validar configuração, executar migrations, construir o backend uma vez e publicar/identificar o artefato por digest imutável no GHCR.

## Stack e estrutura

- Docker Engine + Docker Compose como dependência dura; sem fallback para host.
- GHCR como `ArtifactRegistryAdapter` padrão.
- `src/main/release/adapters/local-compose-adapter.ts`.
- `src/main/release/adapters/ghcr-artifact-adapter.ts`.
- `src/main/release/configuration-reference-validator.ts`.
- `src/main/release/database-migration-runner.ts`.
- Fixtures/contract tests em `src/main/release/adapters/*.int-spec.ts`.

Contrato de referência, sem valor secreto:

```ts
interface ConfigurationReference {
  name: string
  environment: 'local' | 'preview' | 'staging' | 'production'
  fingerprint?: string
  state: 'configured' | 'missing' | 'divergent'
}
```

## Dentro

- Manifesto Docker Compose oficial com frontend, backend e PostgreSQL local separados.
- Portas e nomes exclusivos por projeto/run; nunca reutilizar porta já configurada por outro container.
- Inicialização do Docker quando autorizado e estiver desligado.
- `.env.local` ignorado pelo Git e `.env.example` apenas com nomes/descrições.
- Validação de chaves obrigatórias sem ler/persistir o valor.
- Migrations locais forward-only e seed determinístico.
- Build único do backend e publicação GHCR com digest `sha256` e provenance.
- Tags opcionais para leitura humana; toda execução usa digest.
- Registro de intenção, referência externa, digest, transport e evidência.
- Limpeza apenas de recursos temporários pertencentes ao lease; volumes persistentes não são apagados.

## Fora

- Vercel, Railway, Preview remoto, Staging ou Produção.
- Cofre próprio ou sincronização de segredos.
- Restore automático de banco.
- Política de retenção global de imagens além de proteger digests ainda rollbackáveis.

## Regras

1. Docker indisponível e que não inicia produz bloqueio externo explicável.
2. Imagem implantável é referenciada por digest, nunca por `latest`.
3. Segredo não entra em argumento, env capturado, log, issue, prompt, manifesto ou banco local.
4. Migration quebrada interrompe a preparação antes de publicar candidato utilizável.
5. Local, Preview, Staging e Produção têm configurações e bancos separados.
6. Adaptador declara CLI/API usado; fallback silencioso é proibido.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
```

## Estratégia de testes

- Contract tests do Docker/GHCR com sucesso, auth inválida, timeout, digest divergente e resposta parcial.
- Integração com Docker Compose e PostgreSQL reais em nomes/portas exclusivos.
- Varredura de worktree, SQLite, logs e evidências por sentinela secreta.
- Contrafactual: deploy por tag mutável deve ser recusado.

## Critérios de aceite

1. Um comando da aplicação sobe e verifica o Compose completo sem usar recursos de outro projeto.
2. Migration e seed produzem banco local reproduzível.
3. Backend é construído uma vez e o digest retornado é persistido no `Artifact`.
4. Consulta posterior resolve exatamente o mesmo digest e provenance.
5. Chave ausente bloqueia com nome e ambiente; valor diferente permitido não bloqueia.
6. Sentinela secreta aparece zero vezes nos artefatos persistidos e logs.
7. Porta ocupada gera nova porta livre ou bloqueio explícito; nunca derruba container alheio.
8. Limpeza remove somente recursos temporários do lease.
9. Suíte comum usa fakes; smoke GHCR real é explícito, limitado e registrado.

## Limites

- **Sempre:** usar digest, redaction e ownership antes de limpar.
- **Consultar a SPEC:** novo registry, mudança do manifesto Compose ou migration destrutiva.
- **Nunca:** usar `latest` no deploy, copiar segredo, executar sem Docker ou apagar volume persistente automaticamente.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

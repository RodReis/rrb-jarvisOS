# SPEC-Release-02 — Docker, artefatos e configuração

- MVP/Fatia: MVP-014 · M14-F02.
- Issue: [#151](https://github.com/RodReis/rrb-jarvisOS/issues/151).
- Status: **aprovada-pi** (2026-08-29); **entregue** pela PR #424 (merge `48b3af0`, 2026-10-09); issue em `proplan:done`, aguardando aceite do PI.
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

## Decisões de implementação

Tomadas na implementação da F02. Registradas aqui porque a opção recusada também é decisão. Seguiram a recomendação por valor; o custo declarado entrou só como desempate.

1. **O Compose oficial é um template por projeto, provado por um projeto fixture (PI, 2026-10-09).** O repositório é Electron com SQLite e não tem frontend, backend e Postgres separados; o alvo da F02 é preparar a release de *qualquer* projeto. `docker/release/compose.yml` recebe tudo por variável (nome do projeto, lease, portas, senha efêmera, imagem do backend) e o projeto informa só um perfil JSON (`release-profile.json`: contextos de build, portas do contêiner, health path, migrations, seed, repositório). A prova usa `tests/fixtures/release-project/`. *Recusada:* Compose fixo para este repositório — exigiria inventar frontend e backend que ele não tem e prenderia a F03 até a F05 a um alvo inexistente.
2. **Ordem da preparação:** configuração → Docker → só o Postgres → migrations e seed → **publicação única do backend** → o backend publicado (por digest) e o frontend no Compose → verificação → limpeza. Assim a regra 4 vale por construção (migration quebrada nunca produz candidato) e o que é verificado localmente é a imagem que o registry guarda, sem segundo build.
3. **O comando é `npm run release:prepare`, executado dentro do Electron.** A chave da cadeia de auditoria está selada no `safeStorage`; fora do Electron não há como gravar o `AuditEvent` do efeito. Os argumentos viajam por variável de ambiente, não pelo `argv`: o Chromium varre a linha de comando inteira e `--registry localhost:55790` seguido de outro `--switch` derruba o processo em ~20 ms com código -1 e sem mensagem (medido). Saída: JSON sem valor de chave; código 0 preparada, 3 bloqueada, 2 uso inválido.
4. **Diário próprio da preparação local (migration 64).** `release_local_effect` é append-only e guarda intenção, referência externa, digest, transporte e hash de evidência; o `release_step` da F01 só admite staging e production, e a preparação local não é um passo de ambiente. O artefato ganha `uri` e `provenance` (ALTER); `release_configuration_reference` foi recriada com `fingerprint`, `state` e os quatro ambientes — as duas estavam vazias, sem escritor na F01.
5. **`ConfigurationReference` guarda o HMAC do valor, nunca o valor.** Chave derivada da chave de auditoria por separação de domínio. `.env.example` com valor é **recusado** (a SPEC pede só nomes); o `.env.example` atual deste repositório traz `SUPABASE_URL=https://SEU-PROJETO.supabase.co` — se este repositório virar projeto de release, o PI decide entre esvaziar o valor ou aceitar placeholder.
6. **Provenance = SLSA do registry, resumida e comparável.** Guardam-se tipo de build, builder e o hash do documento; a consulta posterior só vale se o digest e esse hash forem os mesmos. O `org.opencontainers.image.revision` da imagem carrega o SHA da release.
7. **`buildx --provenance` exige containerd image store ou um builder `docker-container`.** O adapter aceita um `builder` nomeado e devolve `attestation-unsupported` quando o driver não gera provenance — nunca publica sem. O teste real cria o builder quando o Docker local não tem containerd store.
8. **Limite declarado:** a F01 só tem lease por ambiente (staging e production). A preparação local usa um id de lease próprio para posse dos recursos Docker; **ela não serializa dois writers da mesma release** (o registro do artefato é idempotente e recusa digest divergente, mas duas preparações simultâneas disputariam portas). Serializar exige estender o lease da F01 e é decisão do PI.
9. **Revisões independentes (código e segurança) corrigidas antes da PR.** Sem CRITICAL; um HIGH e seis MEDIUM de segurança tratados com teste vermelho antes: (a) a limpeza roda em `finally` e o motivo de bloqueio vem de uma **lista fechada** de códigos (um `error.code` cru do Node ou do SQLite, em maiúsculas, derrubava o diário e deixava o Postgres do run órfão); (b) listagem do Docker que falha ou devolve algo fora do formato é `cleanup-failed`, nunca "nada a remover" — e o Docker real mostrou que `volume ls -q` devolve **nomes**, não ids, o que o dublê escondia; (c) `docker ps` que falha na reserva de portas bloqueia; (d) o build só ocorre se o contexto é o commit da release (`HEAD` igual ao SHA e árvore limpa, incluindo não rastreados) — senão a imagem seria rotulada com um SHA que não é o dela; (e) arquivo de ambiente dentro do contexto, sem exclusão no `.dockerignore`, bloqueia antes do `--push` (`secret-in-context`); (f) os caminhos do perfil não saem da pasta dele e o destino da publicação é do operador (`--registry` e `--namespace`), não do arquivo do projeto; (g) referência por digest com gramática OCI estrita, validada também antes de subir o Compose; (h) o runner não repassa `DOCKER_HOST`/`DOCKER_CONTEXT`, usa cwd neutro, corta saída em 8 MiB e mata a árvore de processos no timeout; (i) o `verify` não segue redirecionamento; (j) `schema_migrations` ilegível não vira "nenhuma migration aplicada"; (k) o reuso do artefato compara digest **e** provenance e deixa rastro no diário; (l) migration 64 ganhou índice único por release e tipo, CHECKs de fingerprint, estado coerente, digest, transporte e razão, e as escritas conferem que a release pertence ao escopo.
10. **Limites declarados que ficam** (não corrigidos de propósito): a imagem do frontend construída pelo Compose (`jarvisrel-<hash>-frontend`) não é removida pela limpeza, só contêiner, rede e volume; `postgres:16-alpine` é tag e não digest (o requisito "nunca `latest`" vale para o deploy do backend); `--provenance=mode=max` publica no registry o Dockerfile e os argumentos de build; migrations e seed são código do projeto executado no contêiner descartável via `psql` (meta-comandos incluídos), então o projeto precisa ser confiável; e o limite do lease do item 8.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

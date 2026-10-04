# SPEC-Scheduler-03 — Isolamento concorrente

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 03).
- Issue: [#130](https://github.com/RodReis/rrb-jarvisOS/issues/130); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29); implementação iniciada em 2026-10-04 (decisões de implementação abaixo).
- Depende de: F02 aprovada e entregue.

## Objetivo

Garantir que cada fatia concorrente tenha worktree, branch, container, portas, volumes, sessão e leases próprios.

## Dentro

- Workspace gerido por `run_id`, criado da revisão-base reconciliada.
- Branch determinística e exclusiva por fatia/attempt conforme política Git automática.
- Container/rede/volumes temporários identificados e etiquetados.
- Alocação de portas inéditas entre runs ativos, sem reutilizar portas já configuradas por outro container.
- Perfis Claude/Codex montados conforme executor, sem compartilhamento de diretório gravável entre runs.
- Inventário durável de recursos para recuperação e limpeza segura.

## Fora

- Escrever no checkout ativo do usuário.
- Compartilhar worktree/container entre fatias para economizar recurso.
- Colocar GitHub/Vault/segredos do projeto dentro do container.
- Limpeza de branch/PR remoto.

## Regras

1. Repositório existente é registrado no lugar; sua árvore ativa nunca é alterada.
2. Recursos são criados com nomes/labels verificáveis, não descobertos por glob destrutivo.
3. Porta é reservada antes de subir o container e liberada após confirmação de parada.
4. Limpeza só atinge recursos ligados ao run reconciliado.

## Critérios de aceite

1. Duas fatias simultâneas possuem paths, branches, containers, portas e leases distintos.
2. Mudança em um worktree não aparece no outro nem no checkout do usuário.
3. Nenhuma porta já configurada/ativa é reutilizada.
4. Scanner confirma ausência de credenciais proibidas em ambos os containers.
5. Crash permite reencontrar e reconciliar cada recurso sem afetar o outro run.

## Testes e evidência

- integração com dois worktrees/containers;
- colisão de porta e nome;
- crash durante criação e limpeza;
- inventário antes/depois com ausência de órfãos.

## Decisões de implementação (PI, 2026-10-04)

Tomadas na implementação da F03, depois de o Code mapear o que já existia e achar duas lacunas que a SPEC não resolvia. Registradas aqui porque a opção recusada também é decisão.

1. **A limpeza automática de rede e sidecar usa uma exceção estreita ao gate destrutivo (ADR-007).** `docker network rm` casa a política de destrutivos e travaria a limpeza num gate humano; a rede não tem o atalho `--rm` que o container tem. **Decidido:** exceção escopada ao inventário — um único formato exato (`docker network rm <rede>`), só para rede que o inventário lista, só no engine do Docker, com o padrão liberado registrado no `AuditEvent`. *Recusadas:* deixar rede e sidecar como pendência para aprovação humana (órfão por desenho) e remover fora do `TerminalEngine` (segundo caminho de execução, sem política nem auditoria). **O Code estreitou a decisão em um ponto:** o worktree sai **sem `--force`** (a exceção não o cobre), porque `--force` destrói trabalho que o kernel não registrou; o que o Git recusa vira pendência.
2. **O núcleo do isolamento entra com o paralelismo desligado.** A SPEC-Scheduler-01 dizia que a F03 "liga" o encadeamento slot → preflight → executor, o paralelismo e a fonte de write set. **Decidido:** a F03 entrega inventário, labels, alocador de portas, scanner, perfis por run, reconciliação e limpeza, ligados ao preflight; `CONFIG_PADRAO.paralelismo` segue `false` e a ligação de ponta a ponta com o executor fica para a F05 (E2E concorrente), onde há prova real. Ligar concorrência antes do merge serializado (F04) arriscaria o critério de coerência da base. *Recusadas:* ligar slot → preflight → executor (~5–6 dias; mexe em `index.ts` e no `EntregaService`, que fixa `tentativa: 1`) e ligar também o paralelismo (~6–8 dias; duas fatias em paralelo antes do merge serializado).

## Revisões independentes (2026-10-04)

Duas revisões somente-leitura, de segurança e de código TypeScript, antes do PR. **Corrigido com teste vermelho antes** (cada correção tem contrafactual medido):

- **Falha de detecção virando "removido" ou "limpo"** (as duas HIGH): container `planejado` com o Docker fora do ar era dado como removido sem comando algum (o dublê respondia a verdade mesmo caído); e a saída do `find` do scanner, cortada em 64 KB pelo terminal, era tratada como lista completa. Agora sem a listagem o recurso vira pendência, a parada é **confirmada por reconsulta** (o `docker stop` de um container `--rm` volta antes de ele sumir da lista) e saída truncada é `indeterminado`.
- **O `docker inspect` do scanner gravava o `Config.Env` do container em claro na auditoria encadeada por hash**, de onde não se remove — e a redação do terminal mascarava `https://usuario:token@host` antes de o scanner lê-lo. Nova marca `CommandSubmission.saidaEhSensivel`: o chamador recebe a saída **crua**, a auditoria só o marcador. Vale para o `inspect` e para o `cat` do config do Git.
- **O scanner tinha falsos negativos demonstrados:** `.credentials.json`, `.git-credentials`, `.pgpass`, `.aws/credentials`; variáveis `AWS_ACCESS_KEY_ID`, `COOKIE`, `BEARER`, `AUTH`; valores Stripe, Slack, JWT e **URL com usuário e senha** (`postgres://u:p@host`); montagens do named pipe do Docker no Windows, `gcloud`, `azure`. E não olhava o `config` do `.git` montado em `/gitcommon`, onde um remote com token fica legível ao agente — passou a lê-lo.
- **Unidade de Squad e suíte:** o inventário registra a **unidade** (`<run>-<escritor>-…`), e a reconciliação a daria por morta. `runOuUnidadeAtiva` resolve o run dono (prefixo por segmento). E o escritor e a suíte passam a devolver rede, sidecar, perfil e portas ao encerrar, **preservando o worktree e a branch**, que o kernel ainda usa.
- **Container que não parou segura o que ele monta:** worktree e perfil não são mais removidos de baixo de um container vivo; o sidecar ausente não solta o lease do container.
- **`alocarPorta`** consultava o Docker uma vez por candidata (e, com o Docker caindo no meio, queimava a faixa inteira dizendo "faixa acabou"): agora lê uma vez, e `ResultadoDaReserva.causa` separa `indisponivel` de `sem-verificacao`.
- **Preflight:** um segundo preflight do mesmo run, com o primeiro vivo, **não derruba** o que o primeiro montou (recusa sem tocar em nada); falha de lease devolve a porta que acabava de reservar; rede, sidecar e container com nome de outro run recusam.
- **Caminhos que vêm do banco** só são apagados se tiverem a forma que o isolamento cria (`jarvisos-run-<run>[-perfil]`, absolutos); `git worktree remove` ganha `--`; porta lê faixa publicada (`8000-8002->`); erro do autorizador da limpeza mantém o gate.

**Reportado e não corrigido** (limites abaixo): L2 do ADR-007 (capacidade de uso único), `git worktree prune` que poda o registro de todo worktree ausente, janela entre a checagem da label e o `stop`/`rm` por nome (o certo seria agir pelo ID resolvido na listagem), `runAtivo` tratar run sem linha em `pipeline_run` como morto, pendência que nunca é fechada nem atualizada (já era assim antes da F03).

## Como cada critério é provado

| # | Critério | Prova |
|---|---|---|
| 1 | Paths, branches, containers, portas e leases distintos | `isolamento-concorrente.int-spec.ts`: dois preflights reais (Git + Docker + SQLite); `preflight-isolamento.int-spec.ts` para a colisão de nome/branch |
| 2 | A mudança de um worktree não aparece no outro nem no checkout | mesmo arquivo: `git status` nos três lados e `docker exec ls` nos dois containers |
| 3 | Porta já configurada ou ativa não é reutilizada | `isolamento-docker.int-spec.ts` (container ativo, container **parado**, processo do host) e `isolamento-service.int-spec.ts` (lease de outro run, mesmo expirado) |
| 4 | Scanner confirma ausência de credencial nos dois containers | o preflight roda o scanner antes de liberar o sandbox; `isolamento-docker.int-spec.ts` o exercita num container real com variável e arquivo de credencial |
| 5 | Crash reencontra e reconcilia cada recurso sem afetar o outro run | `isolamento-concorrente.int-spec.ts` (crash com um run vivo) e `isolamento-service.int-spec.ts` (crash na criação e na limpeza, órfão sem registro) |

## Contrato com as próximas fatias

- **Quem cria recurso o registra antes.** `IsolamentoService.planejar` → recurso real → `confirmar`. Recurso criado fora desse caminho não é reencontrado pela reconciliação por inventário; só pelo lease, que cobre worktree e container.
- **A reconciliação do boot consulta o inventário antes dos leases** (`ReconciliacaoService.isolamento`). Run em execução nunca é tocado; run terminal tem os recursos devolvidos; recurso gerido no Docker **sem registro** é reportado como `PendenciaDeLimpeza` e **nunca destruído**.
- **A F04 (merge serializado) e a F05 (E2E) herdam** `liberarRun(runId)`: idempotente, devolve `{ removidos, pendencias }`, e a branch nunca sai do Git. A F05 liga `paralelismo` e o chamador de produção do preflight.
- **O perfil do Claude é por run** (`<raiz>/jarvisos-run-<run>-perfil/claude`, montado em `/perfil/claude` com `CLAUDE_CONFIG_DIR`), sem credencial: a autenticação segue sendo o proxy do host. O `CodexExecAdapter` continua com um `CODEX_HOME` global rodando no host (M10-F03); isolar o perfil do Codex por run é da F05, quando houver chamador.
- **`PedidoDePreflight.tentativa`** (opcional) dá a `-t<n>` à branch e entra como label. O `EntregaService` ainda fixa `tentativa: 1` e não a passa; a F05 a liga.

## Limites declarados

- **O paralelismo segue desligado e nenhum chamador de produção encadeia pool → preflight → executor** (decisão 2). Em produção a F03 acrescenta inventário, labels, perfil por run, scanner e a reconciliação por inventário no boot; o comportamento sequencial de hoje não muda.
- **O scanner procura arquivo só fora do worktree** (`/root`, `/home`, `/tmp` e o perfil do run). `/work` é o repositório do usuário e um `.env.example` versionado acusaria falso positivo; o que o executor escreve ali é vigiado pelo `verificarEscopo` do construtor. Detector por padrão fecha o caminho comum, não prova ausência — a mesma ressalva de `segredos.ts`.
- **O scanner roda uma vez, na liberação do preflight.** Credencial que o executor criar depois, dentro do container, não é vista por ele.
- **O scanner é detector por padrão, ampliado depois da revisão, mas não prova ausência:** nome de variável fora do regex, formato de segredo sem prefixo reconhecível ou credencial em arquivo fora de `/root`, `/home`, `/tmp` e do perfil passam. O `config` do Git é lido por inteiro, mas o `find` olha só seis níveis de profundidade.
- **A faixa de portas é fixa** (`FAIXA_DE_PORTAS`, 20000–20999) e não configurável por projeto. Hoje nenhum projeto declara serviço, então o preflight só reserva as portas de `portasDeServico`; a alocação dinâmica (`alocarPorta`) existe e é testada, mas ainda não tem chamador de produção.
- **O lease de porta herda a validade de 30 s dos demais leases** e nenhum chamador de produção o renova; como todo lease de recurso, expirado continua segurando até a reconciliação decidir.
- **`docker ps` e a sonda não cobrem tudo**: processo do host que escuta só uma interface rara (por exemplo, um IP específico da máquina) pode passar pela sonda, que testa loopback, `0.0.0.0` e `::`.
- **Ação por nome, não por ID.** A posse é provada pela label na listagem, e o `docker stop`/`network rm` agem depois pelo nome. Dentro do processo não há janela (tudo é síncrono); quem tem acesso ao Docker local poderia trocar o recurso nesse intervalo.
- **`git worktree prune`** (worktree que já não está no disco) poda o registro de **todos** os worktrees ausentes do repositório, inclusive o de outro run cujo diretório esteja momentaneamente indisponível.
- **Branch não é apagada nunca.** Ela sai do inventário (libera o nome para um run novo) e o Git a preserva; apagar branch e PR remoto continua fora (SPEC, "Fora").
- **Worktree com arquivo não registrado fica** como pendência e mantém o lease: a limpeza não destrói trabalho. O PI decide o que fazer com ele.
- **Duas redes `jarvisos-egress-test-*` sem label** sobraram na máquina de desenvolvimento do teste de egress anterior à F03 (`docker-egress.int-spec.ts` não as remove). A reconciliação as ignora por não terem label; apontadas, não apagadas.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; decisões de implementação em 2026-10-04.

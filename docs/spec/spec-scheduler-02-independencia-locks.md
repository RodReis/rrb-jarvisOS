# SPEC-Scheduler-02 — Independência e locks

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 02).
- Issue: [#129](https://github.com/RodReis/rrb-jarvisOS/issues/129); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F01 aprovada e entregue.

## Objetivo

Autorizar paralelismo somente quando dependências, write sets e recursos compartilhados provarem ausência de colisão relevante.

## Dentro

- `IndependenceAnalyzer` com dependências diretas/transitivas e conjuntos previstos de escrita.
- Catálogo versionado de recursos exclusivos e áreas globais: migrations, schema público, lockfile, build/config e contrato arquitetural.
- Locks persistidos por path/prefix e recurso lógico, com granularidade conservadora.
- Prova registrada de independência ou motivo de fallback sequencial.
- Expansão transacional do write set antes da primeira escrita no novo alvo.
- Detecção de conflito real e suspensão segura do run que perdeu a disputa.

## Fora

- Usar somente ausência de aresta no DAG.
- Inferência probabilística autorizando conflito.
- Dois runs alterando área global simultaneamente.

## Regras

1. Qualquer dimensão desconhecida torna a prova incompleta e força sequencial.
2. Sobreposição de prefixos ou recurso exclusivo bloqueia coexistência.
3. Novo path observado sem lock não pode ser escrito até aquisição confirmada.
4. Mudança estrutural invalida a prova dos descendentes afetados.

## Critérios de aceite

1. Fatias sem dependência mas com lockfile comum não executam juntas.
2. Write sets disjuntos e sem recurso global podem adquirir slots simultâneos.
3. Expansão conflitante pausa antes de alterar o novo path.
4. Reexecução com mesmo snapshot produz a mesma prova e fingerprint.
5. Locks sobrevivem a reinício e só são liberados após reconciliação do owner.

## Testes e evidência

- property tests de DAG/prefixos/recursos;
- fixtures de migration, lockfile e contrato global;
- corrida de expansão de write set;
- registro da prova usada pelo scheduler.

## Decisões de implementação (PI, 2026-10-04)

Tomadas na implementação da F02, depois de o Code achar duas lacunas que a SPEC não resolvia. Registradas aqui porque a opção recusada também é decisão.

1. **O write set previsto entra por uma porta injetada (`FonteDeWriteSet`).** Hoje `derivarPaths` do preflight é um stub e `PathsPermitidos` só existe depois do slot. **Decidido:** a F02 entrega analisador, catálogo, locks e prova; o write set vem de uma porta (SPEC → derivada, o mesmo tipo `PathsPermitidos`). Fonte sem resposta = prova incompleta = sequencial (regra 1). Em produção a porta responde "desconhecido" até a F03 ligar uma fonte real — coerente com o paralelismo desligado. *Recusadas:* campo `writeSet` na `Slice` do roadmap (muda o contrato do MVP-008 e a saída de IA do roadmap, ~+3 dias) e usar só o `SquadPlan` (existe depois do slot: a decisão de adquirir já passou).
2. **Expansão conflitante leva o perdedor a `BLOCKED`, com fencing.** Na mesma transação: nega o lock, grava o evento (`pool_expansao`), audita (`pool-lock`) e transiciona `RUNNING → BLOCKED` pela máquina de estados existente, com o token vigente e um `BloqueioExterno` completo (`causa: conflito-de-write-set`). Slot e locks antigos ficam — liberar e retomar é da M12-F05, como já valia para bloqueio na F01. *Recusada:* só devolver `conflito` e deixar a F03 decidir parar — na F02 nada impediria o run de seguir `RUNNING` ignorando a negativa.

## Contrato com as próximas fatias

- **Quem escreve só escreve depois de `ok`.** `PoolService.expandirEscopo(runId, token, caminhos)` é o único caminho para ampliar o write set de um run com slot. O executor (F03) deve chamá-lo **antes** de tocar um path que o diff observou fora do conjunto travado, e parar se a resposta não for `ok`.
- **A fonte do write set é da F03.** `fonte` em `src/main/index.ts` devolve `undefined`: nenhum segundo run do mesmo projeto paraleliza em produção até a F03 ligar a fonte *e* o paralelismo (`CONFIG_PADRAO.paralelismo` segue `false`).
- **O catálogo é dado versionado** (`CATALOGO_PADRAO`, `VERSAO_DO_CATALOGO = 1`): lockfiles, migrations, schema público, configuração de build e contrato arquitetural. A versão entra na prova e no fingerprint. Um projeto-alvo com áreas próprias passa o próprio catálogo ao `IndependenciaService`.
- **O pool não conhece o estado do run.** `expandirEscopo` confere o token do lease, não se o run está `RUNNING`: um run cancelado ainda tem lease até a M12-F05 e o pool aceitaria a expansão. O executor da F03 deve recusar a escrita (e a chamada) quando o run não está em execução.
- **Escritores do mesmo run** (`<runId>:<escritor>`) continuam isentos da prova entre si, mas as **travas valem**: um irmão que travasse o lockfile do outro espera.
- **Lock vive enquanto o lease do slot do dono existir.** Liberação, encerramento e reconciliação do dono o soltam; lease expirado continua segurando. O ciclo varre trava de run sem lease (resto de um crash entre remover o lease e soltar o lock).
- **Mudança estrutural.** Expansão aceita marca `invalidada_em` nas provas registradas que contavam com o run (`pool_prova`); a decisão do scheduler já é recalculada do snapshot a cada ciclo, então a invalidação é registro, não o mecanismo que impede a coexistência.

## Limites declarados

- **Nenhum chamador de produção usa `expandirEscopo` nem a fonte real:** como a `adquirirSlot` da F01, ficam prontos para a F03 ligar. Em produção, a F02 só acrescenta travas e o motivo estruturado de espera — o comportamento sequencial de hoje não muda.
- **O catálogo padrão é conservador e por caminho exato.** Lockfile aninhado num workspace (`packages/web/package-lock.json`) não está no catálogo padrão: um monorepo passa o próprio. A comparação ignora caixa (falso conflito custa tempo; falso disjunto custa colisão).
- **Travas por caminho vivem no `pool_lock` sem teto nem retenção** além do ciclo de vida do slot; `pool_prova` e `pool_expansao` são histórico sem purga (mesmo limite da `pool_decisao`, da F01).
- **Fencing recusado em `expandirEscopo` não gera `AuditEvent`** (mesmo critério da F01).
- **Caminho é recusado, não consertado.** A revisão de segurança achou que o NTFS resolve vários nomes para o mesmo arquivo (`package-lock.json::$DATA`, `prisma./migrations`, `MIGRAT~1`, ponto ou espaço no fim) e que invisíveis/bidi/C1 falsificam a evidência. Todos viram "desconhecido" (write set inválido): recusar é o fail closed. Um nome legítimo com `~` seguido de dígito ou terminado em ponto também é recusado — o custo é voltar ao sequencial, nunca colidir.
- **Tetos:** 100 caminhos por pedido, 256 caracteres por caminho, 300 caminhos travados por run (inicial + expansões), 50 conflitos/razões por resposta. A chave da trava é a caixa canônica (minúscula). Run que perdeu uma disputa não amplia mais (`bloqueado`), sem gravar evento por tentativa.
- **`LockRepository` não filtra por `user_id` nas leituras e no `soltar`** (`run_id` é global, como na `pool_fila`, que já recusa run de outro usuário). Hoje todo chamador passa por `slotDoRun(userId, …)`; filtrar também no repositório é defesa em profundidade, deixada para quando houver mais de um usuário por banco.
- **Custo de leitura.** A prova recarrega o roadmap e o fecho de dependências do candidato e de cada ativo a cada avaliação do `decidirPool` (inclui `vista()`), e só quando há segundo run esperando no mesmo projeto. Sem teto nem cache, como a vista da F01.
- **Ciclo com irmão cujo lock conflita** consome um token e regrava lease/liberação a cada `ciclo()` até o conflito sair: inofensivo, mas não é "rodar de novo sem reescrever nada".
- **Reconciliação de escritor** (`<run>:<escritor>`) já tratava o lease como sem dono antes da F02 (só roda no boot); agora as travas saem junto.
- **Manifesto e trava são um recurso só** (`lockfile` inclui `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`…): mudar o manifesto invalida o lockfile. Caminhos são normalizados em NFC e comparados sem distinguir caixa.
- **O catálogo não cobre** `.git/hooks`, `.husky`, `.claude`, `.env*` nem `.mcp.json`: a escrita real continua limitada pelo `PathsPermitidos` do preflight; incluí-los no catálogo é decisão de produto.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; decisões de implementação em 2026-10-04.

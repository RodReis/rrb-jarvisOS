# SPEC-Scheduler-01 — Pool global e fila justa

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 01).
- Issue: [#128](https://github.com/RodReis/rrb-jarvisOS/issues/128); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: **M11-F02** (era "MVP-011 concluído"; alterado pela ADR-006, decisão 13, aprovada pelo PI em 2026-10-02). Entra antes da M11-F03; o conteúdo desta SPEC não muda.

## Objetivo

Substituir o slot global único da V1 por um pool durável de capacidade, com dois executores por padrão e fila justa entre projetos.

## Dentro

- Limites configuráveis global, por projeto, executor e classe de recurso.
- Padrão V2: dois slots globais e no máximo dois runs por projeto.
- Fila persistida com elegibilidade, prioridade aprovada, idade e motivo de espera.
- Alternância entre projetos sem starvation, preservando precedência explícita do roadmap.
- Lease com owner, fencing token, TTL/heartbeat e recuperação.
- Métricas de ocupação, espera e decisões do scheduler.

## Fora

- Decidir independência entre fatias; F02.
- Mais de duas execuções globais como padrão.
- Alterar prioridade de produto automaticamente.
- Contar workers somente-leitura como novos writers; usam limites próprios do Squad.

## Regras

1. Capacidade livre não torna uma fatia elegível sem todos os gates.
2. Configuração reduzida não mata run ativo; impede novas aquisições até ficar abaixo do teto.
3. Lease expirado exige reconciliação antes de redispatch.
4. Mesmo snapshot de fila produz decisão determinística, salvo tempo/health registrados como entrada.

## Critérios de aceite

1. Nunca há mais writers ativos que o limite global/projeto.
2. Dois projetos continuamente elegíveis avançam sem starvation.
3. Reinício preserva posição, lease e motivo de espera sem duplicar run.
4. Fencing token impede dono antigo de confirmar progresso após perda do lease.
5. UI/API explica qual limite ou gate mantém cada item na fila.

## Testes e evidência

- property tests de capacidade/fairness;
- relógio controlado para TTL/heartbeat;
- crash antes/depois da aquisição;
- métricas e auditoria das decisões.

## Decisões de implementação (PI, 2026-10-02)

Tomadas na implementação da F01, depois de o Code achar duas lacunas que a SPEC não resolvia. Registradas aqui porque a opção recusada também é decisão.

1. **Paralelismo desligado por padrão.** A SPEC fixa "dois slots globais" como padrão V2, mas o ADR-006 mantém multi-escritor desligado até o MVP-028. **Decidido:** o pool nasce com **2 slots** e `paralelismo` **desligado**; a capacidade efetiva é **1** até a M12-F03 (isolamento concorrente) ligá-lo. O comportamento de hoje (um run por vez) não muda. *Recusada:* ligar os dois slots já na F01 — mais próximo da letra da SPEC, mas dois runs escrevendo no mesmo repositório antes do isolamento da F03.
2. **Critério 5 por API, sem tela.** **Decidido:** serviço (`PoolService.vista()`) + canal IPC tipado só de leitura (`pool:vista`). Não há UI: o quadro é do MVP-028. *Recusada:* um painel provisório na F01, que a F28 jogaria fora.

## Contrato com as próximas fatias

- **O token nunca sai do main.** A vista (`VistaDoPool`), a auditoria e as mensagens de erro não o carregam; só o dono do slot o recebe, em `adquirirSlot`.
- **Run em execução só avança com o token vigente** (`RUNNING`/`VALIDATING`/`PR_CI`), inclusive o dono antigo que já perdeu o lease. `CANCELLED` é ato do PI e dispensa o token.
- **O slot solta quando o run termina por `MERGED` ou `AWAITING_MERGE`.** Cancelamento e bloqueio **não** soltam o slot nesta fatia: a liberação deles é da **M12-F05** (recuperação), junto com a reconciliação de lease expirado — que também só roda no boot.
- **Lease V1 em voo** (`wip:global`) atravessa a atualização: não é slot do pool, e a reconciliação do boot o resolve como resolvia antes.
- **`ConstrutorService` ainda transiciona pelo repositório**, sem passar o token. O caminho do pool (FilaService) o exige; migrar o construtor para ele é da F03, quando houver mais de um escritor.
- **O pool é um por usuário; a vista é por workspace.** A capacidade é do pool inteiro (um escritor no NOA ocupa o slot do JARVIS OS), mas `pool_fila` guarda o `workspace_id` do run, e a vista, a ativação e a auditoria seguem o dele. A vista mostra só os runs do workspace atual, e `ocupacao` conta o pool todo.
- **Quem executa precisa ser ligado na F03.** Nenhum chamador de produção usa `adquirirSlot`, `renovarSlot` nem `aoAdquirir`: quando a F03 ligar o executor, ele deve receber o token de `adquirirSlot` e de `aoAdquirir` (hoje opcional) e renovar o heartbeat. Sem isso, um run que o `despachar()` ativa depois de uma liberação ficaria com slot e sem worker.
- **`ativar` recusado cancela o item.** Hoje a pré-condição é só `READY`, validada nos gates; se a ativação ganhar outras, o item cancelado não volta pelo mesmo run.
- **Independência é porta, não regra.** `ProvaDeIndependencia` entra no `decidirPool` com padrão `SEM_PROVA` (nada é independente de nada); a F02 injeta a prova real.

## Limites declarados

Achados das revisões independentes que ficam fora da F01, sem chamador em produção que os exponha hoje:

- **Terminal e liberação do slot são dois commits** (`UPDATE` do run, depois `pool.encerrar`). Um crash entre os dois deixa lease vigente de run encerrado até o lease expirar e o próximo boot reconciliar. Janela de duas instruções síncronas; fechar com uma transação única é da M12-F05.
- **A `posicao` exibida** é calculada sem contar o projeto que acabou de adquirir na mesma decisão, e pode divergir da ordem do ciclo seguinte. A justiça real não é afetada; só o número mostrado.
- **Fila e `pool_decisao` sem teto nem retenção.** As métricas só olham 24 h, e a vista refaz a decisão a cada chamada. Teto de itens por usuário e purga do histórico entram com o quadro (MVP-028), que é quem consulta a vista de forma contínua.
- **O token é sequencial, não segredo.** Serve de fencing (monotônico, nunca reaproveitado), não de credencial entre processos: se um dia atravessar IPC, precisa de componente aleatório. Tentativa recusada por `fencing-invalido` não gera `AuditEvent`.
- **`transicionarComFencing` aceita lease expirado** se o token confere: coerente com "expirado ocupa o slot até a reconciliação".


## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

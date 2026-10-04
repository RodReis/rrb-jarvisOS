# ADR-007: Exceção estreita à política de destrutivos para a limpeza do inventário

- Status: **aceito** — decidido pelo PI em 4 de outubro de 2026, na implementação da M12-F03 (#130).
- Data: 4 de outubro de 2026.
- Decisor: PI; redação pelo Code.
- Relacionado: ADR-006 (decisão 11, aprovação do PI para comando destrutivo); SPEC-Scheduler-03; SPEC-Entrega-06 (limpeza, decisão do PI de 2026-09-02: `docker stop` em container `--rm` em vez de `docker rm`); `src/shared/policies/destructive-commands.ts`; MVP-004 (RF-019).

## Problema

A M12-F03 exige que a limpeza de um run não deixe órfão: container, **rede `--internal`**, sidecar, worktree e perfil. A limpeza é automática — roda no fim do run e na reconciliação do boot, sem humano à frente.

A rede de egress do run só sai com `docker network rm`, e esse comando casa o padrão `docker-remocao` da política de destrutivos (`rm` entre os argumentos). O resultado é um `ApprovalRequest` que trava a limpeza num gate humano: a rede fica órfã por desenho. O container já havia contornado o mesmo problema com `--rm` na criação (parar remove); a rede **não tem** esse atalho — o Docker não oferece rede que se remova sozinha.

## Alternativas consideradas

- **Sem exceção: rede e sidecar viram pendência para aprovação humana.** Não toca a política, mas deixa órfão de rede em todo run por construção e enfraquece o critério "sem órfãos" da SPEC. *Recusada pelo PI.*
- **Remover fora do `TerminalEngine`** (chamada direta ao Docker). Contorna o gate e perde a allowlist, a política e o `AuditEvent` do motor: um segundo caminho de execução, o que o MVP-004 existe para impedir. *Recusada.*
- **Exceção por padrão de comando** (liberar `docker network rm`, qualquer rede). Um agente comprometido ou um bug apagaria a rede de outro stack da máquina — o Supabase local do próprio projeto vive numa rede Docker. *Recusada.*

## Decisão

1. **Exceção escopada ao inventário.** O gate destrutivo deixa de pausar **um único formato exato de comando**: `docker network rm <rede>`, e somente quando `<rede>` consta no inventário durável de recursos (`recurso_run`, tipo `rede`, estado diferente de `removido`). Qualquer outro argumento, outra rede ou outro binário segue pedindo aprovação — a exceção é fail closed.
2. **A exceção vive no engine do Docker, não no do usuário.** `TerminalEngine` ganha um autorizador **opcional** (`autorizadorDeLimpeza`); só a instância `terminalDocker` o recebe. Sem autorizador, o motor é idêntico ao de antes. A allowlist de binário e a de diretório continuam valendo: a exceção só tira o passo 4 (a pausa destrutiva).
3. **Rastreável.** O padrão que casou continua registrado: a classificação traz `padraoDestrutivo` e `liberadoPeloInventario`, e o `AuditEvent` "antes" da execução carrega `liberadoPeloInventario: <id do padrão>`. O par antes/depois do RF-016 não muda.
4. **O worktree fica de fora da exceção.** O PI aprovou a exceção para a limpeza do inventário; o Code a **estreitou**: `git worktree remove` roda **sem `--force`**, como o `SquadGit.remover` já fazia. Motivo: `--force` destrói trabalho que o kernel não registrou (arquivo não commitado), e a integridade do dado vem antes da automação. Worktree que o Git recusa vira `PendenciaDeLimpeza` e o lease fica. A branch nunca é apagada.
5. **Posse provada antes de remover.** Mesmo para recurso do inventário, a limpeza só age quando a label `jarvisos.run` do recurso no Docker é a do run. Dono diferente ou ausente vira pendência, sem tocar.

## Consequências

- A limpeza automática deixa de ser bloqueada por um gate humano para a rede do run, sem abrir o resto da política.
- O inventário passa a ser parte da superfície de segurança: quem consegue gravar `recurso_run` com tipo `rede` consegue liberar `docker network rm` para aquele nome. O banco é local, o renderer não acessa SQLite, e o nome é gravado pelo preflight antes da criação. A revisão de segurança da F03 olhou esse caminho e **não achou como abusar da exceção a partir do código do app** (nomes `jarvisos-egress-<run sanitizado>` nunca começam com `-`; o formato exige exatamente três argumentos; o autorizador só chega ao engine do Docker, que não é exposto por IPC).
- **Erro na consulta ao inventário é "não liberado".** O autorizador lê o banco a cada comando destrutivo; se a leitura lançar, o engine registra o aviso e cai no pedido de aprovação — nunca abre o gate.
- **Limite declarado (revisão de segurança, L2):** a liberação é um predicado do engine, não uma capacidade de uso único passada por `removerRede`. Qualquer chamada futura a `docker network rm <rede do inventário>` por outro caminho do app passa sem aprovação enquanto a rede constar no inventário. Hoje só `DockerRunner.removerRede` a emite, e a posse (label = run) é provada em `liberarRede` antes. Trocar o predicado por capacidade de uso único é o endurecimento seguinte, se um segundo chamador surgir.
- A ADR-006 (decisão 11) continua valendo para tudo o que não é `docker network rm` de rede inventariada.
- Reverter é remover o argumento do construtor em `src/main/index.ts`: o motor volta ao gate integral.

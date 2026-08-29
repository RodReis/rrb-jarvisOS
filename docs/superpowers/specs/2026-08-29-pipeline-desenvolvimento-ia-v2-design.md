# Design — Pipeline V2: multi-executor, Squads e execução contínua

- Status: **arquitetura aprovada pelo PI** em 2026-08-29.
- Escopo: evolução da pipeline aprovada em `2026-08-28-pipeline-desenvolvimento-ia-design.md`.
- Implementação: **não autorizada por este documento**. Cada MVP e cada SPEC/fatia continuam sujeitos aos gates existentes.

## 1. Resultado da V2

A Pipeline V2 recebe um roadmap de MVPs e fatias previamente aprovados, distribui o trabalho entre Claude Code e Codex, usa Squads limitados pela SPEC, executa no máximo duas fatias independentes em paralelo e continua até que todo o DAG autorizado esteja mergeado ou tenha bloqueio explicável.

A V2 termina no merge técnico. Deploy, produção e rollback de ambiente permanecem fora desta versão. Merge não fecha a issue nem substitui o aceite final do PI.

## 2. Decisões do PI

1. A evolução se chama **Pipeline V2**, não “MVP2”, para não colidir com o `MVP-002` do produto.
2. A V2 termina com todo o roadmap aprovado construído e mergeado; deploy fica para versão posterior.
3. O núcleo determinístico controla DAG, gates, leases, orçamento, tentativas, Git e merge. Squads atuam somente dentro da SPEC aprovada.
4. Claude Code e Codex são executores equivalentes: um constrói e, quando ambos estiverem disponíveis, o outro revisa o delta.
5. O executor principal é o único escritor da fatia. Subagentes pesquisam, analisam, testam e revisam com saída estruturada.
6. Até duas fatias do mesmo projeto podem executar juntas quando a independência for demonstrada. Sem prova, a execução volta para sequencial.
7. A máquina possui dois slots globais de executor por padrão; o limite é configurável.
8. A pipeline drena todo o DAG previamente aprovado sem pedir novo aceite para a mesma revisão e para no primeiro gate ainda não aprovado.
9. Claude e Codex usam seus CLIs com autenticação de assinatura como rota principal. API paga é rota distinta e nunca é fallback silencioso.
10. Repositório existente é registrado no lugar; o checkout do usuário não é alterado. A pipeline trabalha em worktree gerido a partir do `HEAD`.
11. Cancelamento depois do push preserva branch e PR, converte o PR para draft quando possível e limpa apenas recursos temporários. Merge confirmado nunca é desfeito automaticamente.
12. Artefatos extensos de runs finalizados expiram em 30 dias ou ao ultrapassar 5 GB. Runs fixados, ativos, bloqueados ou pendentes de reconciliação não expiram; hashes, auditoria e relatórios versionados permanecem.
13. Créditos pagos do Codex exigem habilitação explícita e teto próprio por projeto. A pipeline tenta o executor alternativo antes de usar saldo monetário autorizado.

## 3. Fora do escopo

- deploy e promoção para staging ou produção;
- rollback de ambiente ou gestão de incidente de produção;
- runner GitHub self-hosted controlando o computador pessoal;
- exclusão automática de repositório, branch ou PR remoto;
- sistema genérico de Agents/Squads fora da pipeline;
- vários agentes escrevendo no mesmo worktree;
- duas implementações concorrentes da mesma fatia;
- aprovação automática de MVP, SPEC ou mudança estrutural.

## 4. Arquitetura

```text
Roadmap aprovado
       │
ContinuousDispatcher
       │
DeterministicKernel ── Approval/Policy/Budget/EffectJournal
       │
ConcurrentScheduler ── IndependenceAnalyzer/ResourcePool/MergeLease
       │
SquadPlanner
       ├── Executor principal — único escritor
       ├── Workers de leitura/análise/teste
       └── Revisor independente
       │
ExecutorRouter
       ├── ClaudeCodeExecutorAdapter
       └── CodexExecExecutorAdapter
       │
Container + worktree + ContextPack
       │
Git/GitHub controlados pelo app ── PR/checks/merge
```

### 4.1 Separação de runtimes

`AIProviderRuntime`, `ConnectorRuntime` e `CodingExecutorRuntime` são irmãos. Compartilham Vault, auditoria, ledger, orçamento e health, mas têm contratos diferentes:

- provider de IA produz inferência;
- conector produz leitura ou efeito externo tipado;
- executor de código mantém sessão, usa ferramentas, altera o worktree e emite progresso durável.

Claude Code CLI deixa de fingir que é provider HTTP. A V1 deve introduzir o contrato `CodingExecutorAdapter` com Claude como primeira implementação; a V2 adiciona Codex sem alterar o orquestrador.

### 4.2 `CodingExecutorAdapter`

Entrada mínima:

- `run_id`, `attempt_id`, executor/modelo e modo de cobrança;
- snapshot e hashes da SPEC e das políticas;
- `ContextPack` e falhas ainda abertas;
- container, worktree, paths permitidos e comandos de validação;
- timeout, limites de contexto/ferramentas e schema do resultado;
- referência opaca ao perfil de autenticação do executor.

Eventos normalizados:

- `executor.started`, `executor.progress`, `executor.tool_used`;
- `executor.path_changed`, `executor.usage`;
- `executor.succeeded`, `executor.failed`, `executor.timed_out`, `executor.cancelled`.

Resultado mínimo:

- status e resumo estruturados;
- paths alterados, validações executadas e evidências;
- uso observado, referência de sessão retomável e assinatura da falha.

O adapter nunca faz Git remoto, cria PR, decide escopo ou autoriza merge.

## 5. Autenticação, quota e cobrança

Modos de cobrança:

| Modo | Uso | Gate |
|---|---|---|
| `subscription_limited` | Claude/Codex autenticado por plano; sem preço USD por chamada, sujeito a janelas e quotas | health/quota; sem conversão fictícia para USD |
| `subscription_credits` | crédito monetário comprado para continuar após limite do Codex | habilitação e teto próprios por projeto |
| `api` | chave/BYOK com custo monetário | `BudgetPolicy` em USD |
| `local` | executor/provider local sem custo externo | limite de recurso local |

Não existe fallback silencioso entre modos. Promoção temporária de limite não vira capacidade permanente. Sem telemetria oficial legível pelo CLI, o estado é `quota_unknown`; a pipeline não raspa tela de cobrança. Rate limit real tenta a próxima rota autorizada ou entra em espera/bloqueio explicável.

Claude usa `CLAUDE_CONFIG_DIR` exclusivo da pipeline e Codex usa `CODEX_HOME` exclusivo. O PI autentica diretamente no CLI; o app não coleta senha ou token. Os volumes são montados somente no container do run e não entram na imagem, worktree, log ou evidência. Context7 usa secret dedicado. GitHub, Vault e credenciais do projeto nunca entram no container.

## 6. MVP-010 — Multi-executor Claude + Codex

### Tese

Adicionar Codex ao contrato de executor sem duplicar a pipeline e permitir construção por um provider com revisão cruzada pelo outro.

### Fatias propostas

1. **M10-F01 — Contrato comum e runtime de executores.** Normalização de request, eventos, resultado, sessão, cancelamento, health e uso.
2. **M10-F02 — Autenticação e perfil isolado do Codex.** `CODEX_HOME`, login direto no CLI, health, quota e redaction.
3. **M10-F03 — Codex Exec Adapter.** `codex exec`, JSONL, output schema, sandbox externo, timeout/kill e retomada suportada.
4. **M10-F04 — Roteamento, fallback e revisão cruzada.** Preferência por projeto/tarefa, disponibilidade, cobrança e impedimento de implementação duplicada.
5. **M10-F05 — UI e prova operacional.** Preferência do projeto, estados dos executores, quotas conhecidas/desconhecidas e jornada E2E Claude ↔ Codex.

### Critério de encerramento

A mesma fatia pode ser construída por Claude ou Codex sem alterar o kernel; quando ambos estão disponíveis, o executor não escritor revisa o delta, e nenhuma troca duplica efeito já confirmado.

## 7. MVP-011 — Squads limitados pela SPEC

### Tese

Criar Squads temporários para uma fatia aprovada, preservando um único escritor e autoridade determinística.

### Regras

- `SquadPlanner` propõe tarefas; o kernel valida escopo, dependências e orçamento.
- Capacidade obrigatória usa implementação disponível ou fallback aprovado; skill nominal ausente não remove disciplina.
- Subagentes não fazem Git, GitHub, merge ou alteração de escopo.
- Achado fora da SPEC vira relatório ou pergunta ao PI.
- Resultados repetidos são deduplicados por assinatura.
- Cancelar o run encerra todos os workers vinculados.

### Fatias propostas

1. **M11-F01 — Registro de capacidades e perfis de Squad.** Perfis mínimos por tipo de tarefa e resolução por capacidade.
2. **M11-F02 — Planejador e validador determinístico.** Grafo interno de tarefas, limites e rejeição de expansão de escopo.
3. **M11-F03 — Workers isolados.** Contexto mínimo, acesso compatível com a função e resultados por schema.
4. **M11-F04 — Revisão independente.** Provider cruzado quando disponível, deduplicação e conflito baseado em evidência.
5. **M11-F05 — Orçamento, cancelamento e E2E.** Tetos por Squad, limpeza, auditoria e prova de escritor único.

### Critério de encerramento

Uma fatia real usa especialistas em paralelo sem segundo escritor, sem ampliar a SPEC e com toda descoberta ligada a evidência e capacidade.

## 8. MVP-012 — Scheduler concorrente

### Tese

Executar até duas fatias independentes sem usar o DAG como falsa prova de ausência de conflito.

### Prova de independência

Duas fatias só coexistem quando:

- não há dependência direta ou transitiva;
- seus conjuntos previstos de escrita não se sobrepõem;
- não disputam recurso exclusivo;
- nenhuma toca área global compartilhada, como migration, schema público, lockfile, configuração de build ou contrato arquitetural;
- existem slots global e do projeto.

Sem prova completa, a execução volta para sequencial. Expansão do conjunto de escrita adquire novos locks antes da alteração.

### Fatias propostas

1. **M12-F01 — Pool global e fila justa.** Dois slots globais por padrão, dois por projeto no máximo e alternância sem starvation.
2. **M12-F02 — Independência e locks.** Write sets, recursos exclusivos, áreas globais e expansão transacional.
3. **M12-F03 — Isolamento concorrente.** Worktrees, containers, portas e leases próprios por fatia.
4. **M12-F04 — Merge serializado.** Um merge por base, rebase da fatia remanescente e revalidação integral.
5. **M12-F05 — Recuperação concorrente.** Crash, cancelamento seletivo, reconciliação e E2E com duas fatias.

### Critério de encerramento

Duas fatias independentes chegam a PR sem colisão; os merges são serializados e a segunda fatia é revalidada sobre a base atual.

## 9. MVP-013 — Execução contínua do roadmap

### Tese

Eliminar a pausa operacional entre fatias já aprovadas e continuar até consumir todo o DAG autorizado.

### Regras

- Dependência técnica é satisfeita pelo merge confirmado; não espera fechamento da issue.
- Fechamento e aceite final continuam exclusivos do PI.
- Fatia sem SPEC aprovada e MVP sem gate de entrada permanecem fora da fila executável.
- Pausa impede nova aquisição e leva runs ativos à próxima fronteira segura.
- Cancelamento usa a matriz por fase e nunca apaga trabalho remoto.
- Kill-switch de merge termina em PR verde aguardando o PI.
- Quota temporária com reset conhecido pode gerar espera durável; orçamento monetário nunca autoriza gasto novo sozinho.
- Mudança estrutural remove da fila somente os descendentes cujos gates foram invalidados.

### Fatias propostas

1. **M13-F01 — Inventário e DAG global.** Estado local/GitHub, elegibilidade e dependências entre MVPs.
2. **M13-F02 — Dispatcher contínuo.** Seleção, avanço pós-merge e retomada depois de reinício.
3. **M13-F03 — Controles operacionais.** Pausa, cancelamento, quota, orçamento e kill-switches.
4. **M13-F04 — Projeções e próximo gate.** GitHub, STATUS, evidência e preparação da próxima SPEC sem aprovação automática.
5. **M13-F05 — Jornada multi-MVP.** Prova E2E até todo o DAG aprovado ficar mergeado ou explicavelmente bloqueado.

### Critério de encerramento

Depois de receber várias fatias/MVPs aprovados, a pipeline atravessa os limites entre eles sem nova intervenção, preserva os gates ainda não aprovados e produz relatório final do DAG.

## 10. Emendas obrigatórias na V1

Estas correções eliminam ambiguidades já encontradas; não antecipam os MVPs da V2:

1. **Importação:** remover a exclusão contraditória da V1; registrar repositório no lugar e trabalhar em worktree gerido a partir do `HEAD`.
2. **Git endurecido:** desativar hooks e execução configurável pelo repositório no Git executado no host; bloquear filtros, drivers, LFS ou submódulos não suportados antes do checkout automatizado.
3. **Revisões:** usar manifesto canônico e regra determinística de materialidade, em vez de conciliar “hash exato” com correção livre.
4. **Efeitos:** persistir intenção, fingerprint, chave idempotente, confirmação e resultado ambíguo; reconciliar antes de repetir.
5. **Cancelamento:** definir comportamento antes do executor, durante execução, após push, durante CI e após merge.
6. **CI:** observar as regras vigentes da branch-base no GitHub, no `head SHA` exato, e declarar conclusões aceitas; merge queue fica fora da V1.
7. **WIP:** V1 possui um slot global de executor; o paralelismo começa somente no MVP-012.
8. **Credenciais no container:** permitir apenas autenticação dos executores/MCPs por mounts dedicados; manter GitHub/Vault/segredos do projeto fora.
9. **Retenção:** aplicar 30 dias/5 GB aos artefatos extensos elegíveis, com fixação e proteção de runs não resolvidos.
10. **Cobrança:** substituir `unmetered` por `subscription_limited` e nunca converter quota de assinatura em USD inventado.

## 11. Contratos transversais

### 11.1 Manifesto canônico de revisão

- path relativo normalizado com `/`, sem `..`, ordenado ordinalmente;
- hash SHA-256 dos bytes armazenados de cada arquivo;
- manifesto serializado em JSON canônico, com versão de schema;
- mudança em PRD, arquitetura, SPEC, Convention, Design System ou protótipo é material;
- atualização mecânica de STATUS, histórico, evidência ou relatório não invalida gate quando não altera requisito;
- mudança de bytes sempre cria nova `ArtifactRevision`; carry-forward de aprovação exige regra de materialidade registrada e auditável.

### 11.2 Diário de efeitos

`EffectJournal` guarda `idempotency_key`, fingerprint da entrada, alvo, estado `intended | confirmed | ambiguous | failed`, referência externa e tentativas. Reutilizar a chave com payload diferente é conflito. Resultado ambíguo exige consulta às fontes reais antes de qualquer repetição.

### 11.3 Matriz de cancelamento

| Fase | Efeito |
|---|---|
| Antes do executor | liberar lease e não criar efeito remoto novo |
| Executor ativo | matar árvore/Squad, preservar diff e evidência, limpar container/worktree após snapshot |
| Após push/PR | preservar branch, deixar PR draft quando possível e marcar cancelamento |
| Durante CI | parar monitoramento/correções; preservar PR e checks existentes |
| Após merge confirmado | manter `MERGED`; não fechar, apagar ou reverter automaticamente |

Retomada cria run vinculado e só reutiliza o PR quando branch e `head SHA` forem reconciliados.

### 11.4 Gate de CI

O conjunto obrigatório vem das regras/rulesets observados para a branch-base e é registrado com data e referência. Somente conclusões aceitas pela regra da origem no `head SHA` esperado satisfazem o gate. `failure`, `cancelled`, `timed_out`, check ausente e SHA obsoleto não passam. Merge queue não é suportada na V1.

### 11.5 Retenção

Metadados, hashes, auditoria e relatórios versionados não expiram pelo coletor de artefatos. Conteúdo extenso de runs finalizados e reconciliados expira após 30 dias ou quando a cota global ultrapassar 5 GB, removendo primeiro o elegível mais antigo. Item fixado ou ligado a run ativo, bloqueado ou pendente não é removido.

## 12. Testes e evidência

- contract tests idênticos para Claude e Codex;
- fixtures de JSONL parcial, evento desconhecido, timeout, kill, retomada e schema inválido;
- prova de que somente o executor principal escreve;
- prompt injection e expansão de escopo em tarefas de Squad;
- property tests de DAG, independência, locks e fairness;
- crashes em todas as fronteiras de efeito e merge;
- quota desconhecida, reset conhecido, fallback, crédito desabilitado e teto monetário;
- duas fatias concorrentes com merge serializado e rebase;
- jornada real multi-MVP em repositório exclusivo, com orçamento e efeitos limitados.

Suíte comum usa adapters fake e não consome assinatura, API ou crédito. Smokes reais são explícitos, limitados e registrados por executor.

## 13. Roadmap e gates

Ordem proposta:

`V1 concluída → MVP-010 → MVP-011 → MVP-012 → MVP-013`

A aprovação desta arquitetura autoriza criar documentos de MVP e SPECs em revisão. Não autoriza implementação. Cada MVP recebe gate de entrada e cada uma das vinte fatias propostas recebe SPEC própria, questão aberta resolvida e aceite do PI antes de virar backlog executável.

## 14. Questões encerradas

Não resta questão estrutural aberta para a arquitetura V2. Nomes exatos de tipos, schemas IPC, migrations e divisão interna de arquivos pertencem aos planos de cada fatia e não podem alterar os contratos deste documento.

/**
 * Entidades mínimas da fundação (SPEC-Fundacao-04).
 *
 * Contrato antes de persistência: a UI consome estes tipos, nunca objeto solto
 * (`docs/CONVENTION.md` §2). Mora em `src/shared` porque renderer, main e testes
 * falam a mesma língua — e porque tipo precisa ser verificável sem carregar o Electron.
 *
 * Campos de escopo (CONVENTION §2): toda entidade persistida carrega `user_id`;
 * `workspace_id` quando o dado pertence a um espaço. `visibility`/`sensitivity` ficam
 * adiados por decisão da spec — as quatro entidades da fundação são infra, não dado de
 * produto. A exceção é o segredo da sessão, que é `credential` e por isso **não mora
 * aqui**: vive cifrado no `safeStorage`/DPAPI (SPEC-Fundacao-03).
 */

/**
 * Os espaços do usuário. **Enum fechado** — `Desenvolvimento` é plataforma compartilhada
 * e `Agentic OS` é área interna do JARVIS OS; nenhum dos dois é workspace (ADR-001).
 */
export const WORKSPACES = ['noa', 'jarvis'] as const

export type WorkspaceId = (typeof WORKSPACES)[number]

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && (WORKSPACES as readonly string[]).includes(value)
}

/** Idiomas suportados. `pt-BR` é o padrão do produto. */
export const LOCALES = ['pt-BR', 'en-US'] as const

export type Locale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Preferência de tema. `sistema` é o padrão (SPEC-05) — segue o SO até o usuário decidir
 * o contrário. É a preferência, não o tema resolvido: `sistema` vira claro ou escuro na
 * hora de pintar, conforme o que o SO responde naquele momento.
 */
export const THEME_PREFERENCES = ['claro', 'escuro', 'sistema'] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/** O tema efetivamente aplicado, depois de resolver `sistema`. */
export type ResolvedTheme = 'claro' | 'escuro'

/**
 * As 8 cores de acento da paleta fechada (SPEC-DesignSystem-02; README §2.4).
 *
 * Vive aqui, no `shared`, e não só no DS, porque é **fronteira de confiança**: o renderer manda o
 * acento escolhido, e o main precisa validar contra o conjunto conhecido antes de gravar — a mesma
 * disciplina de `isLocale`/`isThemePreference`. O `src/shared` não pode importar de `src/design`
 * (regra de fronteira da F01), então a lista canônica mora aqui.
 *
 * ponytail: hoje o DS (`src/design/tokens/acento.ts`) mantém a sua própria cópia das 8 cores. Um
 * teste (`entities.spec.ts`) trava as duas listas em sincronia — a paleta é estável, então isso não
 * acopla a fatia a nada. O upgrade é o DS passar a importar `ACCENT_PALETTE` daqui (renderer→shared
 * é permitido); só não foi feito para manter esta fatia cirúrgica.
 */
export const ACCENT_PALETTE = [
  '#D3AF37',
  '#FF2C2C',
  '#2CFF05',
  '#2323FF',
  '#C4C4C4',
  '#FFFFE3',
  '#8A00C4',
  '#FF5C00'
] as const

export type AccentColor = (typeof ACCENT_PALETTE)[number]

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_PALETTE as readonly string[]).includes(value)
}

/**
 * Acento de fábrica por módulo, aplicado quando o usuário ainda não escolheu (coluna `null`).
 *
 * Fica no `shared` — e não só no DS — porque quem resolve `null → cor` é o **main** (`src/main` não
 * importa `src/design`). É a fonte de verdade do resolver; o DS tem o seu `ACENTO_PADRAO` para uso
 * visual. Um valor que diverja é **cosmético** (a cor de um card antes da 1ª escolha), não um bug
 * de dado — por isso não há teste travando os dois, o que evitaria acoplar esta fatia à mudança de
 * fábrica que corre em paralelo (`ACENTO_PADRAO.jarvis`, hoje sendo alinhado para prata). Ambos são
 * prata neutra: a SPEC-CHOICE-01 §Acento fixa `jarvis #C4C4C4, noa #C4C4C4` como valor inicial.
 */
export const ACCENT_DEFAULT: Readonly<Record<'noa' | 'jarvis', AccentColor>> = {
  noa: '#C4C4C4',
  jarvis: '#C4C4C4'
}

/**
 * Perfil do usuário. Sem segredo: o que o renderer pode ver por inteiro.
 *
 * `accentNoa`/`accentJarvis` são nuláveis: `null` significa "o usuário ainda não escolheu", e o
 * valor de fábrica (`ACENTO_PADRAO` do DS) é aplicado em runtime. Ver a migration 6.
 */
export interface UserProfile {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly locale: Locale
  readonly theme: ThemePreference
  readonly accentNoa: AccentColor | null
  readonly accentJarvis: AccentColor | null
}

/** O que a tela de Settings e a CHOICE alteram. Todos opcionais: a UI muda um de cada vez. */
export interface UserPreferences {
  readonly locale?: Locale
  readonly theme?: ThemePreference
  readonly accentNoa?: AccentColor
  readonly accentJarvis?: AccentColor
}

/**
 * Metadados da sessão local. **O token não entra aqui nem no SQLite** — mora cifrado no
 * `safeStorage` (SPEC-03). Esta tabela responde "há sessão e até quando ela vale", não
 * "qual é o segredo dela"; por isso pode ser lida sem expor credencial.
 */
export interface Session {
  readonly id: string
  readonly user_id: string
  /** ISO-8601. Depois disto, exige reautenticação. */
  readonly expires_at: string
  /** ISO-8601 da última autenticação online — base da janela de 30 dias (ADR-001). */
  readonly last_online_auth_at: string
  readonly created_at: string
}

/** Tipos de evento auditados na fundação. */
export const AUDIT_EVENT_TYPES = [
  'login',
  'logout',
  'login-offline-reuse',
  'workspace-switch',
  // SPEC-Execucao-02: toda decisão do Policy Engine gera um evento deste tipo.
  'policy-decision',
  // SPEC-Execucao-03: adicionar/remover diretório da allowlist é ação sensível (RF-019).
  // Tipo próprio, não `policy-decision`: editar a allowlist é uma mudança de configuração,
  // não a classificação de uma ação — misturar os dois sob um tipo confundiria a auditoria.
  'allowlist-change',
  // SPEC-Execucao-04: criar/alterar/ativar-desativar workflow ou automação (RF-006/007).
  // Cada um seu tipo, pela mesma razão de `allowlist-change`: são mudanças de catálogo
  // distintas, e a auditoria deve poder distingui-las sem parsear o payload.
  'workflow-change',
  'automation-change',
  // SPEC-Execucao-05: rastro de execução simulada (RF-006 "cada execução gera rastreio
  // auditável"). `execution-run` marca início/fim; `execution-step` marca cada etapa.
  'execution-run',
  'execution-step',
  // SPEC-ExecucaoReal-01: aprovação humana real e operação de filesystem auditada.
  'approval-request',
  'filesystem-operation',
  // SPEC-ExecucaoReal-02: execução de comando no terminal controlado (RF-016 exige que
  // comando, diretório, saída, erro, duração e exit code sejam auditados — e que **erro de
  // execução** gere evento, não só sucesso). Tipo próprio, e não `filesystem-operation`:
  // executar processo e tocar arquivo são capacidades distintas, com allowlists distintas, e
  // a auditoria tem de poder separá-las sem parsear o payload.
  'terminal-command',
  // SPEC-Providers-01: mudança no vault de credenciais (RF-010). Tipo próprio, e não
  // `allowlist-change`: allowlist define o que a máquina pode fazer, credencial define com
  // que identidade ela fala com terceiros — e a auditoria tem de separá-las sem parsear o
  // payload. O payload traz `key`, escopo, ator e operação; **jamais o valor** (ADR-004: "o
  // log de auditoria não é lugar de credencial").
  'credential-change',
  // SPEC-Providers-02: chamada a provider de IA (RF-011). **Dois eventos por chamada** —
  // `fase: 'requisicao'` antes e `fase: 'conclusao'` depois (critério 5) —, e não um só no
  // fim: uma chamada que morre no meio precisa deixar rastro, e o evento de conclusão sozinho
  // perderia exatamente a que falhou. O payload carrega provider, modelo, custo e latência;
  // **nunca o prompt, a resposta ou a credencial** (ADR-004).
  'ai-call',
  // SPEC-Providers-03: o gate de orçamento. **Dois tipos, não um** — pela mesma razão que
  // separa `allowlist-change` de `policy-decision`: `budget-decision` é o veredito sobre uma
  // chamada (permitido/alerta/bloqueado, critério 6), `budget-change` é o usuário editando o
  // próprio limite. Sob um tipo só, "quantas vezes o orçamento barrou" exigiria parsear o
  // payload para descartar as edições. O payload traz limite, acumulado e estimativa —
  // números, nunca o prompt.
  'budget-decision',
  'budget-change',
  // SPEC-Providers-04: o roteamento. **Dois tipos**, pela mesma razão que separa
  // `budget-decision` de `budget-change`: `provider-selection` é o veredito sobre uma chamada
  // (quem atendeu, e se foi fallback — critério 4), `routing-change` é o usuário editando a
  // rota ou trocando o modelo ativo. Sob um tipo só, "com que frequência o preferido cai"
  // exigiria parsear payload para descartar as edições.
  'provider-selection',
  'routing-change',
  // SPEC-Conectores-01: chamada a conector externo (GitHub, Tavily). **Dois eventos por
  // chamada** — `fase: 'requisicao'` antes e `fase: 'conclusao'` depois —, pela mesma razão
  // que `ai-call` os tem: uma chamada que morre no meio precisa deixar rastro, e o evento de
  // conclusão sozinho perderia exatamente a que falhou. Tipo próprio, e não `ai-call`: os dois
  // runtimes são separados (decisão do PI de 2026-08-29), e "quantas vezes o GitHub falhou"
  // exigiria parsear payload para descartar as chamadas de IA. O payload traz conector,
  // operação, efeito, código de erro e créditos consumidos; **nunca o input, a resposta ou a
  // credencial** (ADR-004).
  'connector-call',
  // SPEC-Conectores-02: o ledger de créditos de conector. **Dois tipos**, pela mesma razão que
  // separa `budget-decision` de `budget-change`: `connector-credit-decision` é o veredito sobre
  // uma chamada (permitido/bloqueado, critério 8), `connector-credit-change` é o usuário
  // editando o próprio teto. Sob um tipo só, "quantas vezes a cota barrou" exigiria parsear
  // payload para descartar as edições. **Distinto de `budget-decision`** porque os dois
  // orçamentos são independentes (decisão do PI de 2026-08-29): um conta créditos do conector,
  // o outro conta USD de IA — e a auditoria tem de dizer qual dos dois estourou.
  'connector-credit-decision',
  'connector-credit-change',
  // SPEC-Conectores-03: o Device Flow do GitHub App. Tipo próprio, e não `credential-change`,
  // pela mesma razão que separa `budget-decision` de `budget-change`: `credential-change` é o
  // **usuário editando o cofre** no Settings; isto é o **protocolo de autenticação** rodando
  // (abriu o fluxo, autorizou, renovou, saiu). Sob um tipo só, "quantas vezes a renovação
  // falhou" exigiria parsear payload para descartar as edições manuais — e a renovação é
  // justamente o que ninguém vê acontecer.
  //
  // O payload traz a fase (`inicio`/`autorizado`/`renovado`/`logout`/`falhou`), o conector e o
  // código de erro normalizado; **nunca o device code, o user code, o token ou o refresh
  // token** (ADR-004). O `user_code` fica de fora mesmo sendo mostrado na tela: ele é
  // efêmero por desenho, e guardá-lo na cadeia append-only o tornaria permanente.
  'connector-auth',
  // SPEC-Planejamento-01: ciclo de vida de um projeto local. **Dois tipos**, pela mesma razão
  // que separa `budget-decision` de `budget-change`: `project-lifecycle` é o projeto nascendo
  // (criado, importado, recusado por colisão), `project-milestone` é um marco documental
  // virando commit. Sob um tipo só, "quantos marcos foram commitados" exigiria parsear payload
  // para descartar as criações — e o marco é justamente o que a revisão documental rastreia.
  //
  // O commit em si **não** ganha tipo próprio: ele roda pelo terminal controlado e já gera
  // `terminal-command` com comando, saída e exit code (spec § Regras: nenhuma escrita de
  // repositório por caminho paralelo). `project-milestone` registra a decisão de marco; o
  // `terminal-command` registra a execução dela. Dois fatos distintos, dois eventos.
  'project-lifecycle',
  'project-milestone',
  // SPEC-Planejamento-02: montagem do `ContextPack` — montado ou recusado (leitura ampla sem
  // exceção, segredo no contexto, teto estourado). O payload carrega **caminhos e hashes,
  // nunca conteúdo**: a auditoria responde "o que foi enviado?", e responder isso não exige
  // repetir o que foi enviado (ADR-004).
  //
  // Separado de `ai-call` de propósito: o pack é montado **antes** de existir chamada, e um
  // pack recusado nunca vira chamada nenhuma. Sob o mesmo tipo, "quantos contextos foram
  // barrados" exigiria parsear payload para descartar as chamadas.
  'context-pack',
  // Falha deduplicada por fingerprint (critério 4). Tipo próprio porque a pergunta que ele
  // responde é temporal — "esta falha já tinha acontecido?" —, e o `reason`
  // (`nova`/`reincidente`/`resolvida`) é a resposta. Misturado com `context-pack`, a
  // reincidência ficaria escondida entre montagens.
  'context-failure',
  // SPEC-Planejamento-03: uma decisão do wizard. Tipo próprio, e não `project-milestone`, pela
  // mesma razão que separa `budget-decision` de `budget-change`: o marco é a **revisão
  // documental virando commit**, a decisão é **uma escolha do PI dentro da sessão**. Sob um
  // tipo só, "o que o PI decidiu, e o que foi delegado ao agente" exigiria parsear payload
  // para descartar os commits.
  //
  // O payload carrega `autor` (`pi`/`agente`), pergunta, escolha e motivo — é ele que torna
  // verificável a invariante 3 do CONVENTION §4 ("Decide por mim registra decisão, mas não
  // aprova gate"): sem `autor` na cadeia, delegação e aprovação ficariam indistinguíveis
  // depois do fato. O **autosave do wizard não gera evento** (isso é rascunho, e um evento por
  // tecla afogaria a cadeia); só a decisão gravada gera.
  'planning-decision',
  // SPEC-Planejamento-04: a geração do pacote estrutural (PRD, Landscape, Convention) — gerado
  // ou bloqueado. Tipo próprio, e não `project-milestone`, pela mesma razão que separou
  // `planning-decision` dele: o marco é o **commit**, isto é a **revisão sendo composta**, e
  // "quantas vezes a pesquisa bloqueou o pacote" exigiria parsear payload para descartar os
  // commits.
  //
  // O payload carrega o hash do pacote, a contagem de fontes e — no bloqueio — a causa e as
  // tentativas. **Nunca o conteúdo dos documentos nem o texto extraído** (ADR-004): a auditoria
  // responde "o que foi gerado, e a partir de quantas fontes?", e responder isso não exige
  // repetir o que foi escrito.
  'pacote-estrutural',
  // SPEC-Planejamento-05: o ato de anexar design, e a arquitetura que o gate libera. Tipo
  // próprio, e não `pacote-estrutural`, porque a pergunta que ele responde é sobre **o ato do
  // PI**: "o que foi anexado, quando e com que hash?". É esse instante que faz um arquivo contar
  // para o gate (critério 7) — um arquivo largado no diretório por fora não gera evento e não
  // satisfaz o gate. Misturado com a composição do PRD, "quando o design entrou" exigiria
  // parsear payload para descartar as gerações.
  //
  // O payload carrega tipo, caminho, hash e bytes — **nunca o conteúdo do anexo** (ADR-004).
  'design-anexo',
  // SPEC-Planejamento-06: a geração do roadmap — gerada ou recusada por DAG inválido. Tipo
  // próprio pela mesma razão que separou `pacote-estrutural` de `project-milestone`: o marco é o
  // commit, isto é a **composição do plano**, e "quantas vezes o DAG saiu inválido" exigiria
  // parsear payload para descartar os commits.
  //
  // O payload carrega contagens e o slug da próxima SPEC — **nunca o conteúdo** dos documentos.
  'roadmap',
  // SPEC-Planejamento-06: o aceite de um gate pelo PI. Tipo próprio, e **não** `roadmap`, porque
  // a pergunta que ele responde é a do critério 4: *quem* aceitou *o quê*, e quando. Sob o mesmo
  // tipo da geração, "o que o PI aprovou" ficaria misturado com o que o app compôs sozinho — e é
  // exatamente essa distinção que a invariante 3 existe para manter.
  //
  // O payload carrega gate, contagem de revisões e a identidade; nunca o conteúdo aprovado.
  'approval',
  // SPEC-Entrega-01: a publicação do repositório e do backlog aprovado no GitHub. Tipo próprio, e
  // **não** `connector-call`, porque a pergunta que ele responde é sobre o **efeito no mundo**: que
  // repositório passou a existir, com que commit, e quantos recursos nasceram nesta execução. Sob
  // `connector-call`, "o projeto foi publicado" viraria uma sequência de nove chamadas que alguém
  // precisaria remontar — e o critério 1 se mede exatamente pela contagem de criações.
  //
  // O payload carrega o repositório, a branch, o commit confirmado **na origem** e a contagem de
  // criados; nunca o token, que não chega a este serviço a não ser para o push (e é redigido antes
  // de qualquer registro, pelo `argsSeguros` do terminal).
  'publicacao-github',
  // SPEC-Entrega-02: transição de estado de um run da pipeline. Tipo próprio, e **não**
  // `execution-run` (que é do motor simulado do MVP-002): a pergunta aqui é a do critério 4 —
  // *este efeito já aconteceu?* —, e a reconciliação a responde varrendo estes eventos. Sob um
  // tipo compartilhado com a simulação, "o run avançou" e "o workflow simulado avançou" ficariam
  // indistinguíveis sem parsear o payload.
  //
  // O payload carrega o run, a fatia, os estados de origem e destino e, em `BLOCKED`, a causa;
  // nunca o conteúdo do que está sendo construído.
  'pipeline-transition',
  // SPEC-Entrega-02: aquisição, renovação e liberação de lease — inclusive o slot global de WIP.
  // Tipo próprio porque a reconciliação precisa distinguir "quem tinha o recurso" de "o que o run
  // fez": um lease removido por reconciliação é um fato sobre a **máquina**, não sobre a fatia.
  'pipeline-lease',
  // SPEC-Entrega-05: mudança do kill-switch do merge autônomo. **Ação sensível** por decisão do
  // PI (2026-08-30) — desligar o merge muda o que a pipeline pode fazer sozinha na branch-base,
  // e é da mesma família de `allowlist-change`: uma mudança de configuração que amplia ou reduz
  // o que a máquina faz sem perguntar. Tipo próprio para não se confundir com a transição do run.
  'merge-policy-change',
  // SPEC-Entrega-05: a pipeline mergeou um pull request na branch-base. **Ação sensível**: é o
  // único momento em que a máquina escreve na base sem aceite humano no ato, e a
  // `ARCHITECTURE.md` exige `AuditEvent` para ação sensível.
  //
  // Tipo próprio, e não `pipeline-transition`: aquele registra o run mudando de estado, e o run
  // chega a `MERGED` também quando o merge foi confirmado como já feito. A pergunta que este
  // responde é outra — *nós mergeamos, com qual commit?* —, e a resposta precisa do `mergeSha`
  // confirmado na origem, nunca do que o merge respondeu.
  'pipeline-merge',
  // SPEC-Jornada-01: a jornada de planejamento avançou — ou a transição foi recusada. Registra
  // as duas, porque a tentativa barrada é o fato interessante para quem inspeciona depois:
  // guardar só o que passou faria sumir exatamente o que se quer ver.
  //
  // Tipo próprio, e **não** `project-milestone`: aquele registra um commit no Git, e a
  // transição pode acontecer sem commit nenhum (prompt salvo, refinamento respondido).
  'journey-transition',
  // SPEC-Jornada-01, critério 2: a etapa persistida discordava dos fatos e foi recalculada.
  // Tipo próprio porque isto é um **desvio**, não uma transição: ninguém pediu a mudança, e a
  // pergunta que ele responde é "por que a etapa mudou sozinha?".
  'journey-stage-recalculated',
  // SPEC-Jornada-01, critério 7: invalidação de gate regrediu a jornada. Separado do recálculo
  // porque a causa é outra — um documento a montante mudou semanticamente —, e a tela precisa
  // dizer o motivo ao PI.
  'journey-stage-regressed',
  // SPEC-Jornada-02: a geração do brief por modelo — prompt salvo, início, saída recusada,
  // perguntas barradas pelo validador, bloqueio por falta de rota e desfecho.
  //
  // Tipo próprio, e **não** `ai-call`: aquele registra que uma chamada aconteceu. A pergunta que
  // este responde é outra e é a do critério 6 — *a geração aconteceu, e por qual rota?* O
  // bloqueio é o caso que prova a diferença: ele é um evento **sem** chamada nenhuma, e sob um
  // tipo de chamada ele não teria onde existir.
  'brief-generation'
] as const

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/**
 * Evento de auditoria — imutável, append-only e **à prova de adulteração** (ADR-004).
 *
 * Os três últimos campos são a hash-chain: `seq` (monotônico por usuário) detecta remoção
 * e reordenação; `prev_hash` encadeia; `hash` é o HMAC-SHA-256 do conteúdo canônico + o
 * `prev_hash`. HMAC e não SHA-256 puro de propósito: sem a chave, quem editar uma linha
 * não consegue recomputar a cadeia para fechá-la de novo.
 */
export interface AuditEvent {
  readonly id: string
  readonly user_id: string
  /** Ausente em evento que não pertence a um espaço (ex.: login). */
  readonly workspace_id?: WorkspaceId
  readonly type: AuditEventType
  /** Conteúdo do evento. Nunca carrega segredo — auditoria não é lugar de credencial. */
  readonly payload: Readonly<Record<string, unknown>>
  readonly created_at: string
  /** Monotônico por `user_id`, começando em 1. */
  readonly seq: number
  /** `hash` do evento anterior do mesmo usuário; o genesis usa `GENESIS_HASH`. */
  readonly prev_hash: string
  readonly hash: string
}

/** O que o chamador informa ao auditar; a cadeia e o carimbo são do repositório. */
export interface AuditEventInput {
  readonly user_id: string
  readonly workspace_id?: WorkspaceId
  readonly type: AuditEventType
  readonly payload?: Readonly<Record<string, unknown>>
}

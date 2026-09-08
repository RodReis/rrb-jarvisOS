# SPEC-Voz-03 — Persona JARVIS no ponto único de IA

- MVP: `docs/mvp/mvp-017-command-center-voz.md` (Fatia 03). Épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Status: **aprovada-pi** (2026-08-30) — quatro perguntas resolvidas pelo PI nesta data. A fatia só entra na fila depois do MVP-009 e a issue-fatia nasce quando esta spec chegar à `main`.
- Dependências: **M17-F01 (#200)** (a transcrição é a entrada) e **M17-F02 (#202)** (a fala é a saída); MVP-005 entregue (ponto único de IA, adapter Ollama, `ProviderRoute`); M8-F02 entregue (gate de contexto do `AiRequest`). Não depende de: MVP-006, MVP-007.
- Decisões que sustentam esta spec: Done do épico #193 (*“conversa de voz completa sem nenhuma chamada cloud”*; *“persona editável em Settings sem rebuild”*); regras invioláveis do `CLAUDE.md` (toda entidade persistida carrega escopo `user_id`/`workspace_id`; toda chamada de LLM passa pelo ponto único; Policy fail-closed); ARCHITECTURE (local é fonte de verdade operacional).

## Objetivo

Fechar o loop de voz: a transcrição da F01 vira pergunta, a **persona JARVIS** responde pelo ponto único de IA na rota local (Qwen3 8B via Ollama), e a resposta vira fala pela F02. A persona é editável em Settings sem rebuild; um bloco fixo de sistema garante o formato de voz; e um **resumo read-only do estado do app** entra no contexto (decisão do PI) para o Jarvis responder sobre projetos, fila e aceites pendentes.

**Fronteira com o MVP-019, registrada para não duplicar:** F03 é **pull** — responde quando perguntado, com o snapshot que recebeu; o MVP-019 é **push** — anuncia sem pergunta (briefing, eventos). O construtor do snapshot nasce aqui como serviço de contrato próprio e o 019 o **reutiliza** — antecipação compartilhada, não segunda fonte.

## Escopo

### Dentro

- **Entidade `Persona`** persistida com escopo `user_id` + `workspace_id` (regra inviolável); esta fatia entrega a do **JARVIS OS** (o Command Center é área dele). Dois blocos: **texto livre** editável em Settings (nome, tom, estilo, saudações — o “Bom dia, amigo” mora aqui) e **bloco fixo de sistema não-editável** (respostas curtas para voz, pt-BR, sem markdown/código/emoji lidos em voz alta, não inventar dados fora do snapshot). Editar vale na chamada seguinte, sem rebuild; esvaziar o texto livre nunca remove o bloco fixo.
- **Chamada pelo ponto único do MVP-005**: tipo de tarefa **`conversa-de-voz`** no `ProviderRoute`, roteado para **Ollama / Qwen3 8B** (default configurável em Settings, como toda rota). Herda `AuditEvent`, `CostEvent` (rota local sem custo monetário), gate de orçamento da F03/M5 e o **gate de contexto do M8-F02**: a conversa declara **`ContextPack` próprio** (manifesto: persona ativa, snapshot do app, janela de histórico) — nenhum carve-out, nenhum segundo caminho.
- **Só local (decisão do PI):** a rota `conversa-de-voz` não tem fallback cloud. Ollama indisponível ou modelo ausente → **recusa com próxima ação** — aviso visual e falado (frase fixa local da F02, sem LLM) + instrução concreta (subir o Ollama / `ollama pull` do modelo configurado). Nenhuma transcrição de fala sai da máquina.
- **Snapshot do app (decisão do PI):** serviço **`SnapshotDoApp`** com contrato próprio monta um resumo read-only do estado local — projetos, fila da pipeline, entregas em `AWAITING_PI`, erros recentes — injetado no contexto da chamada. Fonte é o **estado local do app** (ADR-001), nunca leitura direta do GitHub (invariante do MVP-019 antecipada). **Sem tool use:** o modelo recebe o resumo pronto; não consulta, não executa, não dispara nada.
- **Histórico da sessão:** as últimas N trocas (default 10, configurável) em memória entram no contexto — follow-up funciona. Nada persiste entre restarts (transcript persistido é F05; memória de longo prazo é MVP-007).
- **Loop integrado:** soltar o botão (F01) → transcrição → chamada → resposta → fala (F02) + texto na tela; os estados pensando/falando ficam disponíveis para o mascote (F04) e a UI (F05); aqui, indicação mínima de estado.
- **Settings:** editor do texto livre da persona com o bloco fixo exibido como leitura; seleção do modelo da rota `conversa-de-voz`; N do histórico.

### Fora

- **Tool use / ações por voz** (“deploy”, “executar agentes”, mexer em arquivo): nenhuma ação é executada por voz nesta fatia. Comando de voz com efeito é **fatia futura com spec própria** (Policy Engine + aprovação), nunca subproduto da conversa.
- **Briefing e anúncio proativo (push)** — MVP-019; **wake word** — MVP-018; **memória entre sessões** — MVP-007; **persona da NOA** — fatia futura (o mecanismo escopado por workspace já fica pronto).
- **Fallback cloud na conversa** — fora por decisão do PI (2026-08-30).
- **Streaming de fala** — herda a decisão da F02 (síntese em bloco); exibição incremental do texto na UI é implementação livre, a fala só sai com a resposta completa.

## Critérios de aceite

1. **Loop completo no app real:** falar uma pergunta → resposta falada com Ollama local e **zero requisição cloud** — provado com contagem de requisições (padrão do projeto), não por ausência de log. Latência (fim da transcrição → início da fala) medida no relatório, na máquina do PI.
2. Toda chamada da conversa passa pelo **ponto único**: `AuditEvent` e `CostEvent` presentes; nenhum import de adapter fora dele (guarda existente vale para o caminho novo). Contrafactual: um caminho que chamasse o adapter direto reprova.
3. **`ContextPack` da conversa declarado** (persona + snapshot + histórico no manifesto); chamada sem pack é recusada — o comportamento do M8-F02 é preservado, não contornado. Teste.
4. **Ollama indisponível → recusa com próxima ação** (visual + falada); **zero requisição à rota paga** (teste conta requisições no provider pago: nenhuma). Teste dos dois cenários: serviço fora e modelo ausente.
5. **Persona editável sem rebuild:** editar em Settings reflete na resposta seguinte; com o texto livre **vazio**, o bloco fixo ainda vale — resposta curta, em pt-BR, sem markdown (teste).
6. **Snapshot no contexto:** pergunta sobre a fila/aceites responde com os dados do estado local; `SnapshotDoApp` tem **teste de contrato próprio** (é o que o MVP-019 vai consumir); a fonte é o banco local — nenhum acesso ao GitHub na montagem (teste).
7. **Histórico:** follow-up (“e a segunda?”) resolve pelo contexto das últimas trocas; N é configurável; reiniciar o app zera a janela (teste).
8. **Nenhum caminho de ação:** a conversa não executa comando, não toca filesystem, não dispara conector — a superfície da ponte não ganha canal de ação, e a guarda de enumeração acusa qualquer canal novo (teste + contrafactual).
9. `npm run dev`, `npm run test`, `npm run lint` verdes; evidência em `reports/TESTS.md`.

## Perguntas resolvidas pelo PI (2026-08-30)

1. **Modelo local:** Qwen3 8B via Ollama, default da rota `conversa-de-voz`, configurável em Settings. — decidido.
2. **Fallback cloud:** não — só local; indisponibilidade recusa com próxima ação. Preserva o Done do épico e a privacidade da fala. — decidido.
3. **Persona:** texto livre editável + bloco fixo de sistema não-editável (formato de voz garantido pelo produto). — decidido.
4. **Contexto do app:** sim — resumo read-only do estado local entra no prompt já na F03. **Consequência registrada:** antecipa a fonte de dados do MVP-019; mitigado pelo `SnapshotDoApp` como contrato compartilhado — o 019 reutiliza o serviço e permanece dono do push. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`conversa-de-voz` é tipo de tarefa do `ProviderRoute`** — configuração, não hardcode; trocar o modelo é Settings.
- **`ContextPack` próprio, sem carve-out:** se o formato do pack do M8-F02 não comportar conversa (manifesto pensado para geração documental), o Code **aponta o problema técnico** e a correção passa pelo PI — nunca licença para bypass do gate.
- **`SnapshotDoApp` com contrato próprio e teste de contrato** — o MVP-019 consome o mesmo serviço; duas fontes do mesmo estado seria o defeito que a decisão 4 quase cria.
- **A recusa falada usa frase fixa local** (áudio da F02 sobre texto estático), não LLM — anunciar “o modelo caiu” não pode depender do modelo que caiu.
- **Janela de histórico default 10 trocas, em memória** — persistência é F05/MVP-007.
- **Persona escopada por workspace desde a migration** — a da NOA é só conteúdo futuro, não mudança de schema.

## Emenda E1 — O `ContextPack` admite contexto que não vem de arquivo (2026-09-08)

- Status: **aprovada-pi** (2026-09-08). Continua na fatia **M17-F03**, issue [#204](https://github.com/RodReis/rrb-jarvisOS/issues/204) — não nasce fatia nova.
- Motivação: ao começar a fatia, o Code verificou que o formato do pack **não aceita** o pack que o critério 3 exige. É exatamente o caso que a § Decisões cravadas pelo Cowork previu (*"o Code aponta o problema técnico e a correção passa pelo PI"*), e a decisão do PI é mudar o contrato, não contornar o gate.
- Análise completa, com as três opções e o custo medido: `docs/spec/proposta-contextpack-conversa.md` (PR [#343](https://github.com/RodReis/rrb-jarvisOS/pull/343)). O PI escolheu a **opção A**.

### O problema, verificado no código

Duas paredes duras, ambas confirmadas lendo os arquivos:

1. **`projectId` é obrigatório e verificado contra o repositório** — `context-service.ts:219` faz `projects.findById(...)` e recusa com `projeto-desconhecido`. Uma conversa com o JARVIS não tem projeto: perguntar *"o que está na fila?"* é sobre o **app**, e é justamente o que o critério 6 pede que o snapshot responda. No banco, `project_id TEXT NOT NULL`.
2. **`itens` não pode ser vazio, e um item só nasce de arquivo em disco** — `context-service.ts:274` recusa com `contexto-vazio`; o item carrega `caminho` relativo à raiz do projeto e `hash` do conteúdo lido por `readFileSync`, depois de `resolverDentroDoProjeto` recusar tudo fora do diretório. Persona, snapshot e histórico nascem **em memória**, a partir do banco local: não têm caminho relativo nem arquivo a hashear.

Os três contornos disponíveis eram todos o defeito que a spec nomeia. `diagnostico: true` é o carve-out **nomeado**, e o comentário em `call-provider.ts:222-224` já recusa este uso: ele existe porque *"o painel de teste do Settings verifica se o provider responde e não gera nada para projeto nenhum"*, e é a única exceção justamente para que *"todo esquecimento"* não vire *"diagnóstico por omissão"* — uma conversa **gera**, e para um usuário.

### Decisão do PI (2026-09-08) — opção A

1. **`ContextPack.projectId` passa a ser opcional.** Ausente significa **contexto do app, não de um projeto** — não é "faltou preencher". A verificação contra o `ProjectRepository` só roda quando o campo vem.
2. **`ORIGENS_DE_CONTEXTO` ganha `'estado-do-app'`.** A união é fechada de propósito: quem audita precisa distinguir "o usuário anexou" de "o `rg` casou", e agora também de "o app resumiu o próprio estado".
3. **Item dessa origem tem `hash` do texto gerado**, não de arquivo lido, e `caminho` vira identificador lógico (`app://snapshot`, `app://persona`, `app://historico`). `bytes` continua **medido**, então o teto de contexto continua valendo por construção.
4. **A recusa `contexto-vazio` continua valendo** — o pack da conversa nunca é vazio: ele sempre traz ao menos persona e snapshot. O que muda é de onde os itens podem vir, não se eles podem faltar.
5. **Migration de recriação** da tabela `context_pack` com `project_id` anulável (SQLite não tem `DROP NOT NULL`), preservando as linhas existentes.

### Regras

**O gate não é afrouxado, é generalizado.** Pack declarado, hasheado, auditado e com teto de tokens continuam obrigatórios para a conversa — o critério 3 desta spec vale sem exceção. O que a emenda remove é a premissa de que *todo* contexto vem de arquivo de projeto, que era verdade quando o único chamador era geração documental.

**Hash dos packs existentes preservado.** O campo novo segue o padrão que o `hashDoPack` já usa para `pathsPermitidos` (`context-service.ts:152-158`): o `?? ''` no fim faz *"ausência continuar hasheando como ausência"*, então nenhum pack gravado é invalidado. O `projectId` ausente hasheia como string vazia, pela mesma regra.

**O MVP-019 herda isto.** O push (briefing, anúncio proativo) tem o mesmo problema: ele também monta contexto do estado do app sem projeto. A emenda serve as duas fatias, e é parte do argumento da opção A — a alternativa (pack separado para conversa) obrigaria uma terceira estrutura no 019.

### Critério de aceite acrescentado

10. **Contexto sintético é declarado como tal:** um pack sem `projectId` é aceito, seus itens de origem `'estado-do-app'` hasheiam o texto gerado, e o manifesto **distingue** esses itens dos que vieram de arquivo. Contrafactual: um pack de geração documental continua exigindo `projectId` e recusando `contexto-vazio`. Teste dos dois lados, e teste de que os packs já gravados mantêm o hash.

### Duas decisões menores tomadas junto (2026-09-08)

- **Guarda de lint para o Ollama:** não existe hoje — o bloco `no-restricted-imports` do `eslint.config.js` cobre `@anthropic-ai/*` e os runtimes de whisper, e o Ollama fala por `fetch` HTTP sem SDK npm, então não há pacote a restringir. A restrição passa a mirar o **módulo** (`ollama-adapter`) em vez do pacote, para a garantia de "nenhum caminho paralelo ao ponto único" ser estrutural e não só de revisão.
- **A `Persona` não vai para a aba `voz`.** Ela é escopada a `user_id + workspace_id`, e o critério de agrupamento escrito na própria tela (`Settings.tsx:32-38`) põe o que é do par usuário+espaço nas abas `ia`/`roteamento`/`conectores`. A persona entra na aba **`ia`**, e o comentário da tela continua verdadeiro.

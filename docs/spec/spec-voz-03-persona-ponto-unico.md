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

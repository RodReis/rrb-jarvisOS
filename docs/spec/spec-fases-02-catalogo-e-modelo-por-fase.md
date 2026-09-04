# SPEC-Fases-02 — Catálogo de modelos e modelo por fase

- MVP/Fatia: MVP-026 · M26-F02.
- Issue: [#252](https://github.com/RodReis/rrb-jarvisOS/issues/252); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **aprovada-pi** (2026-09-04) — perguntas respondidas pelo PI nesta data, antes da redação.
- Depende de: M26-F01 (fase); M5-F04 (catálogo `TABELA_DE_PRECO`, `MODELO_PADRAO`, troca de modelo auditada); M25-F02 (`escolherRota`, `SeloDaRota`).

## Objetivo

Fazer a geração de cada fase sair pelo **modelo que o PI escolheu para aquela fase** — default no workspace, override por projeto — e colocar no catálogo os modelos que ele pediu, cada um só nas rotas que o atendem.

## Catálogo

`TABELA_DE_PRECO` (dado versionado em `ai.ts`) ganha:

| Provider | Id | Preço | Observação |
|---|---|---|---|
| `claude-code` | `claude-fable-5-1` | 0 (unmetered) | **Só aqui.** Não entra em `anthropic` — decisão 4 do MVP-026 |
| `ollama` | `qwen3:8b` | 0 | tag do `ollama list`; substitui nada, soma |

Os ids do Codex (`gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`) entram na **F06**, com o provider — sem provider, id no catálogo seria opção que nunca casa com adapter.

**Regra do catálogo:** `modelosDisponiveis(provider)` continua sendo as chaves da tabela daquele provider. Fable pela API paga não é rejeitado em runtime — não existe como opção.

## Modelo por fase

- `PhaseModelPolicy` — escopo `user_id` + `workspace_id`; para cada `Fase`, um par `{ provider, modelo }` **por rota**: o da rota de assinatura (obrigatório) e, opcional, o da rota paga (usado só com opt-in do projeto). Tabela própria, migration, repositório e serviço espelhando `RoutingPolicy` (F04).
- **Padrão de quem nunca editou** (`POLITICA_DE_MODELO_PADRAO`): Planejamento e Especificação = `claude-code` / `claude-fable-5-1`; Construção = `claude-code` / `claude-opus-5`. Rota paga: `anthropic` / `claude-opus-5` nas três fases (Fable não existe lá).
- **Override por projeto** — `ProjectModelOverride` (`project_id`, `fase`, `provider`, `modelo`, rota). Ausente = herda o workspace. Removível.
- **Resolução** (função pura, testável sem banco): `modeloDaFase(fase, rotaEscolhida, override?, politica)` → `{ provider, modelo }`. Rota vem de `escolherRota()` (M25-F02) — esta função **não escolhe rota**, escolhe modelo dentro da rota. Modelo fora do catálogo do provider → erro de validação na fronteira IPC, nunca chamada.
- **Consumo:** `BriefService`, `RefinamentoService`, `PrdService`, `ArquiteturaService`, `RoadmapGeradoService` (e o gerador de SPEC) deixam de usar o modelo ativo do provider e passam a receber `{ provider, modelo }` de `modeloDaFase`. O `PROVIDER_DA_ROTA` fixo desses serviços sai; a rota continua vindo de `escolherRota`.
- Toda troca (workspace ou projeto) gera `AuditEvent` com antes/depois e escopo (ADR-004). O ledger da geração já grava provider e modelo (M8-F02); nada muda ali.

## Superfície

- **Settings › aba "Roteamento" vira "Modelos"**, com duas seções: **Modelos por fase** (três linhas — Planejamento, Especificação, Construção — cada uma com combo de assinatura e combo de rota paga, filtrados pelo catálogo da rota) e **Avançado › Roteamento por tipo de tarefa** (o editor da SPEC-Providers-04, intacto, recolhido por padrão, com uma linha explicando que a jornada não passa por ali).
- **Cabeçalho do projeto** (F01): o selo `ROTA · modelo` ganha um botão de troca que abre o combo da fase atual, filtrado pela rota em vigor; escolher grava o override do projeto e o selo atualiza. "Voltar ao padrão do workspace" remove o override.
- Combos listam **rótulo + id** (`Fable 5.1 · claude-fable-5-1`) e mostram origem (`Local`/`Nuvem`) e custo (`Sem custo por chamada` para unmetered), como a tela de providers já faz.
- Só componentes públicos do DS; teclado e foco visível; renderer nunca vê credencial.

## Critérios de aceite

1. `claude-fable-5-1` aparece no combo da rota de assinatura e **não aparece** no da rota paga; `qwen3:8b` aparece em Ollama.
2. Geração de cada fase usa `modeloDaFase`; teste de cada serviço da jornada com política editada prova que o modelo chamado é o da fase.
3. Override do projeto vence o workspace; removê-lo volta ao workspace.
4. Modelo fora do catálogo do provider é recusado na fronteira IPC; nenhuma chamada sai.
5. Troca no workspace e no projeto gera `AuditEvent` encadeado; `verifyChain` passa.
6. Com rota `bloqueado`, o combo do projeto fica desabilitado com o motivo — escolher modelo não destrava rota.
7. Editor de "Roteamento por tipo de tarefa" continua funcional e testado, sob "Avançado".
8. `MODELO_PADRAO` e a troca de modelo por provider (F04) continuam existindo para chamadas fora da jornada; a jornada não os lê mais.

## Testes e evidência

Unitários de `modeloDaFase` (herança, override, rota, catálogo); int-spec do repositório da política; Testing Library das duas superfícies; Playwright: editar no workspace → abrir projeto → override → gerar → ledger com o modelo. Relatório `SPEC-Fases-02`. Gate visual da aba Modelos e do selo com troca.

## Perguntas resolvidas pelo PI (2026-09-04)

1. **Default no workspace + override por projeto.** Descartado "só por projeto" (cliques em todo projeto) e "só no workspace" (projeto não diverge). — decidido.
2. **Fable 5.1 nunca pela API.** — decidido.
3. **Combos por fase** conforme o MVP (Fable/Sol; Fable/Sol; Opus/5.5). Os do Codex entram na F06. — decidido.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **Modelo por rota dentro da fase**, e não um só: a rota paga não pode herdar Fable, e um combo único obrigaria a validar em runtime o que o catálogo já resolve estaticamente.
- **A aba muda de nome, o editor antigo não morre.** MVP-007, 017 e 021 vão consumir o `ProviderRoute`; remover agora seria desfazer a SPEC-Providers-04 sem decisão do PI.

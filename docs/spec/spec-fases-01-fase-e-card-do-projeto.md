# SPEC-Fases-01 — Fase do projeto e card completo

- MVP/Fatia: MVP-026 · M26-F01.
- Issue: [#251](https://github.com/RodReis/rrb-jarvisOS/issues/251); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **aprovada-pi** (2026-09-04) — perguntas respondidas pelo PI nesta data, antes da redação.
- Depende de: M25-F01 (máquina de etapas, entregue e aceita).

## Objetivo

Dar ao projeto uma **fase** legível (Planejamento, Especificação, Construção) derivada da etapa, e fazer o card da tela Projetos responder, sem abrir o projeto, *onde ele está, quanto falta, por onde a próxima geração sai e o que o impede*. Sem chamada de IA.

## Fase

- `FASES = ['planejamento', 'especificacao', 'construcao']`, com rótulo pt-BR por dado (`ROTULO_DA_FASE`), no mesmo módulo de domínio da jornada (`jornada.ts`).
- `FASE_DA_ETAPA: Record<Etapa, Fase>` — **dado versionado, `Record` completo**: acrescentar etapa obriga a decidir a fase.

| Fase | Etapas |
|---|---|
| Planejamento | `prompt`, `refinamento`, `brief-aceito`, `prd`, `prd-aceito`, `design`, `arquitetura`, `pacote-aceito` |
| Especificação | `roadmap`, `mvp-aceito`, `spec-aceita` |
| Construção | `construcao` |

- **Fase não é coluna.** É função pura da etapa; a etapa continua derivada dos fatos (critério 2 da SPEC-Jornada-01). Nenhuma transição nova, nenhum evento novo.

## Card do projeto (tela Projetos)

Além de nome, caminho, origem, Renomear, Remover e o CTA único (SPEC-Jornada-01, critério 3), o card mostra:

1. **Fase + etapa atual** — ex.: `PLANEJAMENTO · Aceite do PRD` — com progresso das etapas da fase (posição/total) e, opcionalmente, barra.
2. **Gates aceitos (n/5) e data do último evento** — os cinco gates são as `ETAPAS_DE_ACEITE` da M25-F01; a data vem do último `AuditEvent` de transição do projeto.
3. **Rota + modelo da próxima geração** — o mesmo dado do `SeloDaRota` (M25-F02), acrescido do modelo. Até a F02, o modelo é o ativo do provider da rota; a F02 troca a fonte pelo modelo da fase sem mudar o card.
4. **Pendência/bloqueio** — quando `escolherRota()` devolve `bloqueado` ou a etapa atual tem pré-condição não atendida (anexo faltando, pesquisa pendente, pergunta da SPEC aberta), o card mostra o motivo e a ação concreta (`ACAO_DO_BLOQUEIO` e equivalentes). Sem bloqueio, o espaço não existe — alerta permanente deixa de ser lido.

Tudo isso vem do main por **uma leitura por projeto** (`resumoDoProjeto`), no mesmo canal que hoje devolve o CTA; o renderer não recompõe fatos.

## Trilha do projeto aberto

- A trilha de doze etapas (M25-F01) ganha **agrupamento por fase**: três blocos com rótulo, a fase atual em destaque, as outras condensadas (etapas listadas, sem conteúdo). Etapa concluída continua consultável; futura continua desabilitada com o que falta.
- O cabeçalho do projeto mostra fase, etapa e o selo de rota + modelo. É aqui que a F02 encaixa a troca de modelo por projeto.

## Critérios de aceite

1. `FASE_DA_ETAPA` cobre todas as `ETAPAS`; teste quebra quando uma etapa nova nasce sem fase.
2. O card mostra fase e etapa coerentes com a etapa derivada — teste com projeto em cada fase.
3. `gates aceitos` conta exatamente as aprovações das cinco etapas de aceite; data = último evento de transição.
4. Rota e modelo do card são os mesmos que o selo mostra ao abrir o projeto (uma fonte).
5. Projeto bloqueado mostra motivo e ação; projeto sem bloqueio não mostra o bloco.
6. Trilha agrupada por fase; a fase atual expandida, as demais condensadas; navegação por teclado preservada.
7. Uma leitura IPC por card; nenhum fato recalculado no renderer.

## Testes e evidência

Unitários de `FASE_DA_ETAPA` e do `resumoDoProjeto`; Testing Library do card (quatro blocos, bloqueio condicional); Playwright da lista com projetos em três fases e da trilha agrupada. Relatório `SPEC-Fases-01`. **Gate visual antes de fechar:** capturas do card e da trilha apresentadas ao PI.

## Perguntas resolvidas pelo PI (2026-09-04)

1. **Três fases, corte em `pacote-aceito`** (arquitetura fica no Planejamento). Descartado "fase por gate" (seis combos) e "arquitetura na Especificação". — decidido.
2. **Quatro blocos no card**: fase+etapa, gates+data, rota+modelo, pendência. — decidido.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **Fase é função, não coluna** — mesma razão da etapa derivada: uma coluna só escrita pelo código é segunda fonte de verdade.
- **Bloqueio só aparece quando existe.** Um card que sempre tem "status" ensina a ignorar o status.

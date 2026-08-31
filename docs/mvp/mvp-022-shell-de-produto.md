# MVP-022 — Shell de produto: menu JARVIS OS e Agents OS

- Status: **aprovado pelo PI (2026-08-30)** — SPEC da F01 `aprovada-pi` na mesma data, com as quatro perguntas abertas resolvidas.
- GitHub: épico [#205](https://github.com/RodReis/rrb-jarvisOS/issues/205); fatia [#206](https://github.com/RodReis/rrb-jarvisOS/issues/206) em `proplan:backlog`.
- **Numeração corrigida:** a proposta nasceu como "MVP-019" e o número já estava tomado — os épicos MVP-017–021 (Command Center) entraram na `main` enquanto esta spec era redigida. 022 é o primeiro número livre: 010–016 seguem reservados pela Pipeline V2/V3 (branch `codex/pipeline-v2-design`, PR #189) e 017–021 são a série do Command Center.
- Fila: **depois do MVP-009 fechar** (decisão do PI). Não bloqueia nem é bloqueado por MVP-017.
- Depende de: M3-F04a (AppShell e rail dual) e M4-F03 / FIX #172 (Settings em abas) — entregues.

## Tese

O protótipo (`docs/design/design-system/JARVISOS.md §2`) já define **a forma** do menu — grupos, ordem, rótulos, rail dual. O que o app tem hoje é o placeholder da M3-F04a (`Início · Operações · Projetos · Terminal · Settings` e um "Agentes" solto). Este MVP não desenha menu: **liga cada item do protótipo ao módulo real que o atende e esconde o que ainda não existe**, para que o menu cresça com o produto em vez de prometer 32 telas e entregar 4.

## Decisões do PI (2026-08-30)

| # | Decisão | Onde |
|---|---|---|
| 1 | **Item sem módulo entregue fica oculto** — o menu mostra só o que abre tela real; grupo sem item some. O item entra na fatia que entrega o módulo | F01 |
| 2 | **HARNESSES lista os executores registrados no app** (hoje Claude Code; Codex com o MVP-010), nunca a lista fixa de seis do protótipo | F01 |
| 3 | **Connectors, Providers e Permissões vivem só no Settings** (abas do FIX #172); SISTEMA no menu = `Terminal` + `Settings` | F01 |
| 4 | Entra como **fatia nova em MVP próprio**, não como `[FIX]` sobre a M3-F04a — há decisão de produto que um FIX não absorve | processo |
| 5 | **`Terminal` é item de SISTEMA**, não sexta aba do Settings: é ferramenta de operação, não configuração | F01 |
| 6 | **Fila: depois do MVP-009 fechar** — a M9-F06 entrega o painel de runs, então o menu já nasce com Mission Control visível | processo |
| 7 | **Itens sem MVP ficam no mapa como reserva de lugar** (ocultos no app), para a fatia futura saber em que grupo o item nasce | F01 |
| 8 | **O Command Center não vira MVP novo: ele é o MVP-017**, cuja F05 entrega a UI do Command Center. O item aparece quando aquela fatia registrar o módulo — sem editar o shell | F01 |

**Sobre a decisão 8.** A pergunta "o Command Center precisa de MVP próprio?" foi levada ao PI e respondida com *sim* — e a resposta **já existia na `main`**: os épicos MVP-017–021 foram criados no mesmo dia, com `M17-F05 UI do Command Center` prevista. Nenhum MVP novo foi criado; o mapa da SPEC passa a apontar para a M17-F05. O episódio é o mesmo risco que este repositório já registrou duas vezes: **planejamento em paralelo produzindo dois donos para o mesmo escopo**. A regra que o evita continua sendo a da DECISIONS 2026-08-30 §5 — proposta se confere contra a `main` antes de virar decisão.

## Fatias

| Índice | SPEC | Resultado |
|---|---|---|
| M22-F01 | `spec-shell-01-menu-jarvis-agents-os.md` | Menu dos dois sub-módulos do JARVIS projetado do registro de módulos; mapa item ↔ módulo ↔ MVP |

Uma fatia só. O menu do NOA fica fora (o protótipo `NOA.md §2` o trata como atalhos de view — outra conversa).

## Invariantes

- O menu é **projeção** do registro de módulos, nunca uma lista escrita à mão na tela.
- Nenhum item aponta para placeholder.
- Nenhum dado de menu é inventado (harness, sessão, contagem): o que não vem do app não aparece.
- Isolamento de rota por espaço (SPEC-Fundacao-02) e rail dual (SPEC-DesignSystem-04a) permanecem intactos.

## Done do MVP

- Todo item visível abre um módulo entregue; todo módulo entregue tem um item.
- Registrar um módulo novo (na fatia que o entrega) faz o item aparecer no grupo certo sem tocar o AppShell.
- O mapa item ↔ módulo ↔ MVP da SPEC é a fonte única de onde cada tela futura se encaixa.

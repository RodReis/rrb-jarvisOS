# MVP-019 — Shell de produto: menu JARVIS OS e Agents OS

- Status: **proposta** — SPEC da F01 em `rascunho`, com perguntas abertas ao PI. Sem issue até `aprovada-pi`.
- Numeração: **provisória.** Os MVPs 010–016 vivem na branch `codex/pipeline-v2-design` (PR #189) e as decisões da Pipeline V3 reservam 017–018; 019 é o primeiro número livre. O PI pode renumerar/reposicionar na fila.
- Depende de: M3-F04a (AppShell e rail dual) e M4-F03 (Settings em abas, FIX #172) — entregues.
- Não depende de: MVP-009. **Não bloqueia** nenhum MVP; pode entrar na fila a qualquer momento.

## Tese

O protótipo (`docs/design/design-system/JARVISOS.md §2`) já define **a forma** do menu — grupos, ordem, rótulos, rail dual. O que o app tem hoje é o placeholder da M3-F04a (`Início · Operações · Projetos · Terminal · Settings` e um "Agentes" solto). Este MVP não desenha menu: **liga cada item do protótipo ao módulo real que o atende e esconde o que ainda não existe**, para que o menu cresça com o produto em vez de prometer 32 telas e entregar 4.

## Decisões estruturais do PI (2026-08-30)

| # | Decisão | Onde |
|---|---|---|
| 1 | **Item sem módulo entregue fica oculto** — o menu mostra só o que abre tela real; grupo sem item some. O item entra na fatia que entrega o módulo | F01 |
| 2 | **HARNESSES lista os executores registrados no app** (hoje Claude Code; Codex com o MVP-010), nunca a lista fixa do protótipo | F01 |
| 3 | **Connectors, Providers e Permissões vivem só no Settings** (abas do FIX #172); SISTEMA no menu = `Terminal` + `Settings`. Um caminho por tela | F01 |
| 4 | Entra como **fatia nova em MVP próprio**, não como `[FIX]` sobre a M3-F04a — há decisão de produto (as três acima) que um FIX não absorve | processo |

## Fatias

| Índice | SPEC | Resultado |
|---|---|---|
| M19-F01 | `spec-shell-01-menu-jarvis-agents-os.md` | Menu dos dois sub-módulos do JARVIS projetado do registro de módulos; mapa item ↔ módulo ↔ MVP |

Uma fatia só. O menu do NOA fica fora (o NOA não tem sub-módulo e o protótipo `NOA.md §2` o trata como atalhos de view — outra conversa).

## Invariantes

- O menu é **projeção** do registro de módulos, nunca uma lista escrita à mão na tela.
- Nenhum item aponta para placeholder.
- Nenhum dado de menu é inventado (harness, sessão, contagem): o que não vem do app não aparece.
- Isolamento de rota por espaço (SPEC-Fundacao-02) e rail dual (SPEC-DesignSystem-04a) permanecem intactos.

## Done do MVP

- Todo item visível abre um módulo entregue; todo módulo entregue tem um item.
- Registrar um módulo novo (na fatia que o entrega) faz o item aparecer no grupo certo sem tocar o AppShell.
- O mapa item ↔ módulo ↔ MVP da SPEC é a fonte única de onde cada tela futura se encaixa.

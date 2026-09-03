# SPEC-Jornada-02 — Prompt e brief refinado por IA

- MVP/Fatia: MVP-025 · M25-F02.
- Issue: [#239](https://github.com/RodReis/rrb-jarvisOS/issues/239); épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237).
- Status: **aprovada-pi** (2026-09-03) — perguntas abertas resolvidas pelo PI nesta data.
- Depende de: M25-F01; M5-F04 (rota de assinatura); M8-F02 (`ContextPack`); M8-F03 (contrato da pergunta e `Decision`).

## Objetivo

Transformar o **prompt do PI** num `BRIEF.md` aceito, por um refinamento em que a IA pergunta o que falta — uma decisão por vez, no contrato da SPEC-Planejamento-03 — e nunca inventa o que não foi dito.

## Etapa Prompt

- Campo de texto livre, autosave, sem tamanho mínimo imposto além de não-vazio. Pode anexar arquivos de referência (Markdown/texto) que entram no `ContextPack` como fonte `prompt`.
- Salvar o prompt cria a revisão `PROMPT.md` no Git do projeto (marco documental, M8-F01) e avança para `refinamento`.
- Editar o prompt depois do brief aceito invalida `BRIEF_ACCEPTED` e dependentes (matriz da SPEC-Planejamento-06).

## Refinamento

- A IA recebe o prompt e o `ProjectBriefSchema` (dez blocos do design §9.2: identidade; problema/usuários/resultado; escopo e métricas; jornadas; domínio e dados; integrações; stack e restrições; não funcionais e testes; política Git, provider e orçamento; riscos e decisões abertas) e **gera as perguntas** para os blocos que o prompt não responde.
- Cada pergunta obedece ao contrato da M8-F03 (título, enunciado, 2–3 opções excludentes, recomendada primeiro com justificativa, impacto por opção, texto livre, "Decide por mim" quando delegável) e declara **qual bloco preenche e por quê** (design §9.1).
- Bloco já respondido pelo prompt **não vira pergunta** — vira afirmação com origem `prompt`, exibida para o PI confirmar ou corrigir no aceite.
- "Não sei" cria decisão pendente (design §9.1); pendência material bloqueia o aceite, pendência não material entra no brief como aberta.
- Respostas gravam `Decision` (tabela da M8-F03), com autoria `pi` ou `agente`. Perguntas coincidentes com decisões já gravadas (projeto migrado) são omitidas e a decisão reaproveitada.
- O refinamento termina quando todos os blocos têm resposta ou pendência declarada. Sem teto numérico de perguntas; o progresso por bloco fica visível.

## Brief

- A IA gera `BRIEF.md` com uma seção por bloco. **Toda afirmação carrega origem**: `prompt` (estava no texto do PI), `decisao` (resposta do wizard, com id) ou `proposto` (a IA inferiu). Afirmação sem origem é rejeitada pelo validador de saída antes de gravar.
- Validador de saída recusa requisito legal, regulatório, de consentimento, aceite duplo ou classificação de domínio cuja origem não seja `prompt` ou `decisao` (invariante 9 da CONVENTION, aplicada ao texto gerado).
- Gate `BRIEF_ACCEPTED`: o PI vê o brief, a **lista de `proposto` em separado**, corta os que não quer e aceita a revisão (hash + identidade, SPEC-Planejamento-06). Cortar um proposto regenera só a seção afetada. "Decide por mim" não aceita.
- Aceite cria commit documental e avança para `prd`.

## Geração

- Pelo ponto único, com `ContextPack` montado pelo serviço (prompt, decisões, schema) e manifesto registrado.
- **Rota de assinatura** (Claude MAX via Claude Code CLI): uso registrado sem valor monetário. Rota paga só se o PI a habilitar explicitamente para o projeto; sem opt-in e sem assinatura disponível, a etapa bloqueia com `BLOCKED_EXTERNAL` e ação concreta — nunca cai em rota paga por conta própria.
- Saída estruturada (JSON validado por schema) — a prosa do brief é renderizada a partir dela, para que a origem por afirmação seja verificável e não convenção de texto.

## Critérios de aceite

1. Prompt vazio não avança; prompt salvo vira revisão e etapa `refinamento`.
2. Bloco respondido pelo prompt não gera pergunta; aparece como afirmação `prompt` para confirmação.
3. Toda pergunta gerada passa no validador do contrato da M8-F03 (inclusive a varredura da invariante 9 de `wizard-catalogo.spec.ts`, agora aplicada a perguntas geradas).
4. Nenhuma afirmação do brief existe sem origem; `proposto` aparece em lista própria no gate.
5. Cortar um `proposto` não altera afirmações de outra origem.
6. Sem rota de assinatura e sem opt-in de rota paga, a geração bloqueia sem chamada e sem custo.
7. Ledger registra cada chamada com rota, tokens e `contextPackId`; chamada por rota paga sem opt-in reprova em teste.
8. Sessão interrompida retoma na pergunta pendente sem repetir decisões (critério 6 da M8-F03 mantido).
9. Aceite exige sessão autenticada; "Decide por mim" não aceita.

## Testes e evidência

Unitários do validador de saída (origem, invariante 9, schema); fixtures de prompt completo/parcial/vazio; teste de rota (assinatura, paga com e sem opt-in, indisponível); Playwright do prompt → perguntas → gate com corte de proposto. Geração real com Claude Code CLI em smoke separado, fora da suíte padrão. Relatório `SPEC-Jornada-02`. Gate visual do pop-up e do gate antes de fechar.

## Perguntas resolvidas pelo PI (2026-09-03)

1. **Os dez blocos do design §9.2 permanecem.** Os blocos 1 (identidade, owner, diretório, repositório) e 9 (política Git, provider, orçamento) são **pré-preenchidos** pelo app — resolvidos na criação do projeto e pelos defaults do produto — e o brief os exibe para confirmação, sem pergunta. Descartado perguntar o que o app já sabe e descartado remover os blocos (o MVP-009 lê o brief inteiro). — decidido.
2. **`proposto` é cortado item a item** no gate; o que sobra foi visto e entra no aceite. Vale para todos os gates deste MVP. Descartado aceitar/rejeitar o bloco inteiro: um proposto ruim obrigaria a regenerar todos. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Perguntas geradas, não catálogo fixo** — decisão "tudo com IA" do PI (2026-09-03). O catálogo da M8-F03 deixa de ser fonte; o contrato e o validador da pergunta continuam.
- **Saída estruturada obrigatória**: sem ela, "origem por afirmação" seria promessa em prosa, e o critério 4 dependeria de auditar texto — o mesmo limite que levou a M8-F04 a compor.
- **Bloqueio antes de rota paga** é a decisão 4 do MVP-008 levada à consequência: o gate de USD só existe para rota paga, então a rota paga nunca pode ser fallback silencioso.

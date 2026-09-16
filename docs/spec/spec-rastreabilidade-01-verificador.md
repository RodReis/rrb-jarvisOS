# SPEC-Rastreabilidade-01 — Verificador da matriz e gerador do FORA-DE-ESCOPO

- MVP/Fatia: `[INFRA]` — não pertence a MVP de produto. Infra de processo, como o relatório de testes (ADR-003).
- Issue: [#361](https://github.com/RodReis/rrb-jarvisOS/issues/361) — pré-criada em `proplan:planejado` (exceção do PI de 2026-08-28), implementação não autorizada. Card irmão: [#362](https://github.com/RodReis/rrb-jarvisOS/issues/362).
- Status: **rascunho** — 1 de 6 perguntas resolvida; 5 em aberto (§6). Não implementar.
- Decisões do PI: **2026-09-16** — modo do gate (§3.1).
- Depende de: `docs/RASTREABILIDADE.md` §5 (contrato do gate).
- Rastreabilidade: esta SPEC não implementa requisito de `docs/iniciais/`; é o mecanismo que impede requisito de sumir.

## 1. Problema

`docs/RASTREABILIDADE.md` foi citado no `CLAUDE.md` como documento normativo **antes de existir como
arquivo**, e ninguém percebeu. Esse é o modo de falha desta classe de regra: ela não é violada com
barulho, ela apodrece em silêncio. A matriz recém-criada corre o mesmo risco — 27 linhas
`a-classificar` que ninguém reabre, `adiado` com data vencida que ninguém revisita, e
`FORA-DE-ESCOPO.md` editado à mão até divergir da matriz.

Regra normativa sem verificador é decoração. Esta fatia entrega o verificador.

## 2. Objetivo e fronteira

Entregar um verificador executável que falha quando a matriz está inconsistente com a origem, e um
gerador que reconstrói `docs/FORA-DE-ESCOPO.md` a partir dela.

**Fora de escopo:** classificar requisito (é decisão do PI), extrair inventário dos documentos
iniciais (card próprio), alterar SPECs existentes, e qualquer mudança no fluxo de aceite.

## 3. Contrato do verificador

Entradas: `docs/iniciais/*.md`, `docs/RASTREABILIDADE.md`, `docs/spec/*.md`, `docs/FORA-DE-ESCOPO.md`.

Falha quando:

| # | Condição | Por quê |
|---|---|---|
| V1 | ID existe em `docs/iniciais/` e não tem linha na matriz | requisito desapareceu |
| V2 | Linha com situação fora dos cinco estados, ou `a-classificar` | classificação pendente é bloqueio, não estado |
| V3 | `transferido` sem MVP de destino nomeado e existente em `docs/mvp/` | "um MVP futuro" não é compromisso |
| V4 | `adiado` sem gatilho **ou** sem data de reavaliação | é exclusão disfarçada |
| V5 | `adiado` com data de reavaliação vencida | decisão venceu e ninguém decidiu |
| V6 | `absorvido` sem ponteiro para o requisito/fatia que o atendeu | alegação sem prova |
| V7 | Situação ≠ `mantido` sem motivo, decisor e data | decisão sem assinatura |
| V8 | ID duplicado, ou ID citado numa SPEC que não existe na matriz | rastreabilidade quebrada |
| V9 | `docs/FORA-DE-ESCOPO.md` diverge do que o gerador produz | edição à mão (guarda anti-drift) |

Saída: relatório por ID com a regra violada, no mesmo padrão do relatório de testes.

### 3.1 Modo do gate — decisão do PI de 2026-09-16

**V2–V9 são bloqueantes desde a primeira execução. V1 entra em aviso** enquanto houver inventário
pendente em `RASTREABILIDADE.md` §6.

Razão: V1 é a única regra que depende de trabalho ainda não feito (extração e classificação).
Bloquear por ela hoje pararia toda entrega por um débito conhecido e já planejado. V2–V9 não
dependem de nada pendente: são qualidade da linha que **alguém acabou de escrever**, e é exatamente
onde a erosão começa — `adiado` sem gatilho, `transferido` para MVP inexistente, data vencida.

Consequências operacionais:

- Código de saída ≠ 0 em qualquer falha de V2–V9. V1 imprime aviso e não altera o código de saída.
- O aviso de V1 conta os IDs de origem sem linha e **falha** se esse número **aumentar** em relação
  ao baseline versionado — catraca. Débito conhecido é tolerado; débito novo, não.
- V1 vira bloqueante automaticamente quando o contador chega a zero; não depende de nova decisão,
  e o baseline é removido junto.
- Linha `a-classificar` continua sendo V2, portanto **bloqueante**. As 27 linhas atuais são o
  contra-exemplo óbvio: seriam bloqueio imediato. Ver pergunta 7.

O gerador reescreve `FORA-DE-ESCOPO.md` a partir da matriz, filtrando `transferido`, `adiado` e
`excluído`, agrupado por estado, ordenado por ID. Modo `--check` compara sem escrever (V9).

## 4. Declaração de rastreabilidade na SPEC

Toda SPEC declara no cabeçalho os IDs que cobre. O formato já existe no repositório —
`spec-blueprints-01` traz a linha `Rastreabilidade:`. Esta fatia apenas a torna obrigatória e legível
por máquina:

```
- Rastreabilidade: RF-002, RF-025 · cobre parcialmente RF-003
```

## 5. Prova

- Regras: um caso por linha de V1–V9, com matriz sintética em fixture — nenhuma regra entra sem teste
  que a veja falhar.
- Guarda: rodar o gerador duas vezes é idempotente; `--check` sobre arquivo editado à mão falha.
- Não toca UI, IPC, janela nem preload — sem prova visual ou E2E.
- Categorias que não se aplicam entram como `not_run`, nunca `pass` (TESTING.md).

## 6. Perguntas abertas ao PI

Nenhuma delas tem resposta óbvia, e a SPEC não vira `aprovada-pi` com qualquer uma em aberto.

1. ~~Modo do gate.~~ **Resolvida em 2026-09-16:** bloqueante para V2–V9, V1 em aviso com catraca
   (§3.1). Abriu a pergunta 7.
2. **Onde roda:** job próprio no CI, ou dentro de `quality`? `CI-PR.md` manda manter o caminho
   crítico curto; o verificador é rápido, mas job novo custa ~20-40s de fila.
3. **Divergência do `FORA-DE-ESCOPO.md` (V9):** falha o CI, ou regenera e commita? Falhar é coerente
   com a guarda anti-drift do relatório de testes; regenerar é mais cômodo e esconde a edição manual.
4. **Escopo do V1 na origem:** o verificador varre os quatro documentos iniciais, ou só
   `requisitos-agent-os.md` (o único com IDs próprios) enquanto os outros três não têm inventário?
5. **O PRD do design system está duplicado byte a byte** em `docs/iniciais/` e
   `docs/design/uploads/` (MD5 idêntico, registrado no `CLAUDE.md` §graphify). Duas cópias de um
   documento de origem vão divergir. Qual é a canônica, e a outra vira ponteiro ou é removida?
6. **Quem mantém a matriz no dia a dia:** Cowork escreve e Code só verifica, ou o Code também escreve
   linha quando descobre requisito não coberto durante a implementação?
7. **Aberta pela decisão de §3.1:** `a-classificar` cai em V2, que é bloqueante — ou seja, as 27
   linhas de hoje fecham o gate no dia em que o verificador subir, que é o resultado que você
   recusou. Três saídas: (a) `a-classificar` migra de V2 para o mesmo regime de aviso-com-catraca
   do V1, e vira bloqueio quando zerar; (b) a classificação (E4 do plano de inventário) é
   pré-requisito de merge do verificador — o código espera a matriz; (c) `a-classificar` sai da
   matriz e vira lista à parte, fora do alcance do verificador. Minha recomendação é (a): mantém o
   débito visível e impede que cresça, que é a mesma lógica que você já escolheu para V1 — (c)
   recria o buraco que a matriz existe para fechar.

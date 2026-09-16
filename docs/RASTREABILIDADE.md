# RASTREABILIDADE.md — matriz normativa de requisitos

Matriz que prova **para onde cada requisito aprovado foi**. Não é relatório nem histórico: é
gate. Requisito sem linha aqui bloqueia aprovação documental.

> **Fonte canônica do escopo comprometido: `docs/iniciais/`.** Os quatro documentos iniciais
> — `requisitos-agent-os.md`, `plano-implementacao-agent-os.md`,
> `fronteiras-desenvolvimento-noa-jarvisos.md` e `prd-design-system-plataforma.md` — definem
> o produto a entregar por inteiro. Tudo que está lá é escopo comprometido até o fim, salvo
> decisão explícita do PI registrada nesta matriz. O que entra depois (MVP, SPEC, ADR) é
> ordem e unidade de entrega, nunca redução do conjunto.

## 1. Regra fundamental

Nenhum requisito aprovado pode desaparecer durante a decomposição em MVPs, SPECs ou fatias.
Fatiamento altera ordem e unidade de entrega, não o resultado comprometido. Todo requisito
removido do MVP de origem deve ser classificado como `transferido`, `absorvido`, `adiado` ou
`excluído`, com motivo, destino quando aplicável, gatilho, decisor e data. Um requisito
`transferido` permanece obrigatório e deve apontar para um MVP posterior nomeado. Ausência
na matriz constitui bloqueio de aprovação.

Decorrências, todas invioláveis:

- **Fatiar não reduz escopo.**
- **Requisito não pode desaparecer** — nem por simplificação de implementação, nem por
  "ficou óbvio que não precisa", nem por omissão silenciosa numa SPEC.
- **Mudança de destino exige decisão explícita do PI.** Cowork e Code **propõem**; nenhum dos
  dois reclassifica requisito por conta própria.
- **Aprovação de uma fatia não aprova cortes no MVP.** Aceite de fatia é aceite daquela fatia.
- **Aprovação de uma SPEC não aprova o que ela deixou de fora.** O que a SPEC não cobre
  continua comprometido e continua nesta matriz.

## 2. Identificador do requisito

Rastreabilidade sem ID estável é prosa. Todo requisito carrega ID imutável, atribuído pela
origem e nunca reciclado:

| Prefixo | Documento de origem | Forma |
|---|---|---|
| `RF-` | `docs/iniciais/requisitos-agent-os.md` | `RF-001` … `RF-025`, subitens `RF-009.1` — **já existem no documento; preservar exatamente** |
| `PLN-` | `docs/iniciais/plano-implementacao-agent-os.md` | `PLN-01`… por componente/fase |
| `FRT-` | `docs/iniciais/fronteiras-desenvolvimento-noa-jarvisos.md` | `FRT-01`… por regra/restrição |
| `DS-` | `docs/iniciais/prd-design-system-plataforma.md` | `DS-01`… por componente/padrão |

Regras de ID:

- ID **nunca** é reaproveitado. Requisito `excluído` mantém a linha e o ID para sempre.
- Requisito que se divide gera sufixos (`RF-010.1`, `RF-010.2`) e a linha-mãe vira
  `absorvido`, apontando para os filhos. Divisão não é corte.
- Requisito novo, criado depois dos documentos iniciais, recebe `NEW-nnn` e entra na matriz
  na mesma aprovação que o criou.

## 3. Estados

Cinco estados. `mantido` e `absorvido` são cumpridos; `transferido` é compromisso com data
futura; `adiado` é o único sem compromisso; `excluído` é saída deliberada.

| Estado | Significado | Obrigações |
|---|---|---|
| `mantido` | Continua no MVP atual, na forma original | Ponteiro para MVP/SPEC/fatia |
| `transferido` | **Continua comprometido** e será implementado no MVP nomeado | MVP de destino **nomeado** (nunca "um MVP futuro"); motivo; decisor/data |
| `absorvido` | Atendido por outra solução, ou fundido em outro requisito | Ponteiro para o requisito/fatia que o atendeu + evidência de que o resultado comprometido foi entregue |
| `adiado` | **Poderá voltar, mas não tem compromisso** | **Gatilho** (condição concreta que traz de volta) **e data de reavaliação**, ambos obrigatórios; motivo; decisor/data |
| `excluído` | Saiu do produto por decisão explícita | Motivo; decisor/data. Linha e ID permanecem |

Regras de estado:

- **`adiado` sem gatilho e sem data de reavaliação não existe.** Falta um dos dois, o
  requisito é `excluído` — e então a decisão precisa ser tomada e assinada como exclusão. É
  exatamente o buraco que esta matriz fecha: "adiado" indefinido é exclusão disfarçada.
- **Chegada da data de reavaliação de um `adiado` é evento, não silêncio.** O Cowork leva ao
  PI para nova decisão: vira `transferido`, `excluído`, ou ganha nova data com novo motivo.
  Data vencida sem decisão bloqueia aprovação documental igual a linha ausente.
- **`absorvido` exige prova, não alegação.** Sem evidência de que o resultado foi entregue de
  outra forma, o estado correto é `transferido` ou `adiado`.
- `a-classificar` **não é um estado válido** — é marcação de inventário incompleto (§6). Linha
  nesse estado bloqueia igual a linha ausente.

## 4. Colunas obrigatórias

Toda linha carrega, sem exceção:

| Coluna | Conteúdo |
|---|---|
| ID | §2 |
| Requisito | Título curto, na palavra do documento de origem |
| Origem | Arquivo + seção/âncora exata |
| Situação | Um dos cinco estados de §3 |
| MVP/SPEC atual | Onde está hoje |
| Destino | MVP nomeado (`transferido`) ou requisito/fatia (`absorvido`); `—` nos demais |
| Gatilho / reavaliação | Obrigatório em `adiado`; `—` nos demais |
| Motivo | Por que saiu do MVP de origem. Obrigatório em tudo que não é `mantido` |
| Decisor / data | Sempre o PI, com data. `—` enquanto não decidido |
| Evidência de aceite | Issue fechada pelo PI, PR mergeada, comentário de encerramento |

## 5. Gate — como esta regra deixa de ser decorativa

Esta matriz já estava citada no `CLAUDE.md` antes de existir como arquivo. Regra normativa
sem verificador morre em silêncio; foi o que aconteceu. O gate tem três degraus:

1. **Aprovação de SPEC (Cowork).** Nenhuma SPEC vira `aprovada-pi` sem que todo requisito que
   ela toca tenha linha nesta matriz, com estado válido.
2. **Encerramento de card (Code).** O comentário de encerramento (skill `fechar-card`) cita os
   IDs entregues e, se a entrega deixou de fora requisito que a SPEC prometia, registra a saída
   como **Imprevisto** para decisão do PI. Isto é evidência, **não** gate: o que trava entrega
   continua sendo CI verde e aceite do PI (`CLAUDE.md`). Transformar isto em gate de
   `proplan:done` é mudança de processo e depende de decisão explícita do PI — ainda pendente.
3. **Verificador automático (a implementar).** Card [#361](https://github.com/RodReis/rrb-jarvisOS/issues/361), SPEC em rascunho:
   `docs/spec/spec-rastreabilidade-01-verificador.md`. Modo do gate decidido pelo PI em
   2026-09-16: V2–V9 bloqueantes, V1 em aviso com catraca até o inventário fechar. Contrato mínimo:
   - lê os IDs declarados em `docs/iniciais/`, na matriz e nas SPECs;
   - falha se um ID existe na origem e não na matriz;
   - falha se uma linha tem estado inválido, `a-classificar`, `adiado` sem gatilho/data, ou
     `transferido` sem MVP nomeado;
   - falha se um `adiado` passou da data de reavaliação sem nova decisão;
   - regenera `docs/FORA-DE-ESCOPO.md` a partir desta matriz e falha se o arquivo divergir
     (guarda anti-drift, mesmo padrão do relatório de testes — ADR-003);
   - entra no job `gate` como check bloqueante.

   Enquanto o verificador não existir, o gate é manual e a regra vale igual — mas o risco de
   erosão é real e conhecido.

## 6. Estado do inventário

O inventário nasce incompleto por honestidade: **classificar é decidir, e decidir é do PI.**
O Cowork extraiu e ancorou os requisitos; o destino de cada um é sessão de trabalho com o PI.

| Documento de origem | Situação do inventário |
|---|---|
| `requisitos-agent-os.md` | **Extraído** — 27 linhas abaixo, `a-classificar` |
| `plano-implementacao-agent-os.md` | **Pendente** de extração (`PLN-`) |
| `fronteiras-desenvolvimento-noa-jarvisos.md` | **Pendente** de extração (`FRT-`) |
| `prd-design-system-plataforma.md` | **Pendente** de extração (`DS-`) |

A coluna "MVP/SPEC atual" traz, onde o casamento é literal, uma **proposta do Cowork** marcada
`(proposta)`. Proposta não é decisão e não vale como classificação.

Plano de extração e da sessão de classificação com o PI: card [#362](https://github.com/RodReis/rrb-jarvisOS/issues/362),
`docs/plan/plano-inventario-rastreabilidade.md`.

## 7. Matriz — `requisitos-agent-os.md`

Origem de todas as linhas: `docs/iniciais/requisitos-agent-os.md`, seção `### <ID>`.

| ID | Requisito | Situação | MVP/SPEC atual | Destino | Gatilho / reavaliação | Motivo | Decisor / data | Evidência |
|---|---|---|---|---|---|---|---|---|
| RF-001 | Alternância entre espaços | a-classificar | MVP-001 (proposta) | — | — | — | — | — |
| RF-002 | Command Center | a-classificar | MVP-017 (proposta) | — | — | — | — | — |
| RF-003 | Persona JARVIS OS por voz | a-classificar | MVP-017 (proposta) | — | — | — | — | — |
| RF-004 | Navegação principal | a-classificar | MVP-022 (proposta) | — | — | — | — | — |
| RF-005 | Kanban operacional | a-classificar | — | — | — | — | — | — |
| RF-006 | Workflows | a-classificar | — | — | — | — | — | — |
| RF-007 | Automations | a-classificar | — | — | — | — | — | — |
| RF-008 | Skill Creator | a-classificar | — | — | — | — | — | — |
| RF-009 | Catálogo de Skills | a-classificar | — | — | — | — | — | — |
| RF-009.1 | Specialties | a-classificar | — | — | — | — | — | — |
| RF-010 | Connectors & Credentials | a-classificar | MVP-006 (proposta) | — | — | — | — | — |
| RF-011 | Providers de IA | a-classificar | MVP-005 (proposta) | — | — | — | — | — |
| RF-012 | Mission Control | a-classificar | — | — | — | — | — | — |
| RF-013 | Harnesses e agentes executores | a-classificar | MVP-010 (proposta) | — | — | — | — | — |
| RF-014 | Specialist Teams | a-classificar | MVP-011 (proposta) | — | — | — | — | — |
| RF-015 | Agent Memory | a-classificar | MVP-007 (proposta) | — | — | — | — | — |
| RF-015.1 | Notebook | a-classificar | — | — | — | — | — | — |
| RF-016 | Operator Central | a-classificar | — | — | — | — | — | — |
| RF-017 | OS Desktop | a-classificar | MVP-004 (proposta) | — | — | — | — | — |
| RF-018 | Analytics e custos | a-classificar | MVP-005 / MVP-015 (proposta) | — | — | — | — | — |
| RF-019 | Segurança e permissões | a-classificar | MVP-001 (proposta) | — | — | — | — | — |
| RF-020 | Autonomous Remote | a-classificar | — | — | — | — | — | — |
| RF-021 | Backend Services | a-classificar | — | — | — | — | — | — |
| RF-022 | SEO Content Pipeline | a-classificar | — | — | — | — | — | — |
| RF-023 | Settings | a-classificar | MVP-001 (proposta) | — | — | — | — | — |
| RF-024 | Multiusuário | a-classificar | — | — | — | — | — | — |
| RF-025 | Voz Online no MVP, Offline como evolução | a-classificar | MVP-017 / MVP-018 (proposta) | — | — | — | — | — |

## 8. Matriz — `plano-implementacao-agent-os.md` (`PLN-`)

Inventário pendente de extração.

## 9. Matriz — `fronteiras-desenvolvimento-noa-jarvisos.md` (`FRT-`)

Inventário pendente de extração.

## 10. Matriz — `prd-design-system-plataforma.md` (`DS-`)

Inventário pendente de extração.

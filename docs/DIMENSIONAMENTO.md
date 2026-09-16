# DIMENSIONAMENTO.md — tamanho e risco de MVP

Responde duas perguntas **diferentes** sobre um MVP proposto, e responde as duas porque uma
sozinha engana: um MVP de 2 fatias que mexe no Policy Engine é mais perigoso que um de 8
fatias de UI.

- **T (Tamanho)** — quanto custa entregar.
- **R (Risco)** — quanto custa errar.

T e R são independentes e **ambos obrigatórios** no cabeçalho de todo MVP.

## Por que não é hora nem token

- **Hora** é estimativa fabricada: o Code não gasta hora humana, e hora de PI é aceite, não
  implementação. Número inventado vira número citado.
- **Token** varia com contexto, modelo e número de tentativas — não com escopo. Não é
  estimável antes; é **medível depois**. Entra em §4 como recalibração, nunca como unidade.

A unidade honesta já existe no projeto: a **fatia** — unidade de entrega real, com histórico
verificável (MVP-003: 8 fatias; MVP-001: 6; MVP-002 e MVP-014: 5; MVP-017 e MVP-005: 4).

## 1. Escala T — Tamanho

Pontos = **1 por fatia prevista** + **1 ponto por fator presente**, contado **uma vez por
fatia** que o exibe:

| Fator | Conta quando |
|---|---|
| Migração de schema | A fatia cria ou altera schema persistido (Prisma/SQLite/Supabase) |
| Travessia de processo | A fatia cria ou altera IPC / preload / fronteira main↔renderer |
| Integração externa nova | Provider, conector, API ou serviço ainda não integrado |
| ADR nova | A fatia exige decisão estrutural registrada |
| Prova nova | A fatia exige categoria de teste ou prova visual/E2E que ainda não existe |
| Superfície sensível | A fatia toca Policy Engine, Vault, auditoria, RLS ou escopo de entidade |

| Faixa | Pontos | Leitura |
|---|---|---|
| **Curto** | ≤ 4 | Uma ou duas fatias diretas |
| **Médio** | 5 – 10 | MVP típico deste projeto |
| **Grande** | 11 – 18 | Precisa de ordem de fatias explícita e checkpoint intermediário |
| **Enorme** | ≥ 19 | **Gatilho de decisão do PI**: partir em mais de um MVP, ou registrar por que não |

`T-enorme` não veta nada. Obriga uma decisão registrada antes da primeira fatia.

## 2. Escala R — Risco

Quatro dimensões, 0 a 3 cada:

| Dimensão | 0 | 3 |
|---|---|---|
| **Irreversibilidade** | Revertível com `git revert` | Formato de dado persistido, protocolo de sync, migração destrutiva |
| **Superfície de segurança** | Não toca | Policy Engine, Vault, credencial, auditoria, RLS, IPC |
| **Raio de alcance** | Um módulo isolado | Quebra transversal se errar |
| **Incerteza** | Caminho conhecido | Dependência externa não provada, licença, hardware, API instável |

| Faixa | Pontos |
|---|---|
| **R-baixo** | 0 – 2 |
| **R-médio** | 3 – 5 |
| **R-alto** | 6 – 8 |
| **R-crítico** | ≥ 9 |

`R-alto` ou `R-crítico` exige ADR e prova **antes da primeira fatia**, qualquer que seja T.
A dimensão *Incerteza* tem precedente vivo: o achado de licença que derrubou o Porcupine no
MVP-018 era incerteza de dependência externa não provada, e apareceu depois do plano pronto.

## 3. Declaração obrigatória

Todo MVP novo ou reaberto declara no cabeçalho, antes das fatias:

```
**Dimensionamento:** T-médio (7 pts: 4 fatias + IPC + integração externa + prova nova) ·
R-alto (7 pts: irrev. 1, segurança 3, alcance 2, incerteza 1)
```

A conta aparece, não só a faixa. Faixa sem conta não é verificável e vira opinião.

## 4. Medição a posteriori e recalibração

Ao fechar o MVP, o Cowork registra no arquivo do MVP o **real medido**: fatias efetivas, PRs,
cards `[FIX]` gerados, duração dos PRs. Tokens consumidos entram aqui **se disponíveis**, como
indicador secundário.

Se o T real divergir do estimado em **mais de uma faixa**, isso é achado: registrar em
`docs/APRENDIZADOS.md` e propor recalibração das faixas ao PI. Escala que nunca é confrontada
com o real vira ritual.

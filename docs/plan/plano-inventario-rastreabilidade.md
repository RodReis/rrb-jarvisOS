# Plano — inventário de requisitos dos documentos iniciais

Trabalho do **Cowork**, não do Code: é extração e ancoragem documental, sem código. A classificação
de destino é do **PI** — este plano prepara a decisão, não a toma.

- Issue: [#362](https://github.com/RodReis/rrb-jarvisOS/issues/362) — `proplan:planejado`, implementação não autorizada.
- Alvo: `docs/RASTREABILIDADE.md` §7–§10.
- Origem: `docs/iniciais/` — 2.574 linhas em quatro documentos.
- Estado hoje: `requisitos-agent-os.md` extraído (27 linhas, `a-classificar`); os outros três pendentes.

## Por que em etapas, e não de uma vez

Extrair tudo de uma sessão produz duas coisas ruins ao mesmo tempo: uma lista longa que ninguém
revisa linha a linha, e ruído — nem toda seção de um plano de implementação ou de um PRD é requisito.
"Metadados", "Resumo executivo" e "Tese técnica" não são compromissos de entrega; componentes, fases,
restrições e padrões operacionais são. Separar extração de classificação mantém cada sessão com uma
pergunta só.

## Etapas

### E1 — Extração `PLN-` (`plano-implementacao-agent-os.md`, 716 linhas)

Candidatos: os 9 componentes principais (Electron Shell, React UI, Runtime Local API, Supabase Local,
Policy Engine, Terminal Executor, Provider Adapters, Memory/Knowledge, Voice Layer), as 11 fases
(Fase 0–10) e os checkpoints A–E. Fronteiras de segurança entram como requisito; "Tese Técnica" e
"Trabalho Paralelizável" não.

**Risco conhecido:** fase de implementação não é requisito — é ordem. Se entrar na matriz como
requisito, a matriz passa a travar mudança de ordem, que é justamente o que o fatiamento pode fazer.
Extrair o **resultado** de cada fase, nunca a fase.

### E2 — Extração `FRT-` (`fronteiras-desenvolvimento-noa-jarvisos.md`, 325 linhas)

Candidatos: regra principal, responsabilidades das três camadas, módulos NOA e JARVIS OS, restrições
de cada camada, separação de dados, separação visual e critérios de aceite da separação.

**Observação:** boa parte já virou invariante no `ARCHITECTURE.md` e no `CONVENTION.md` §2. Onde o
requisito já é invariante vigente, a linha nasce `mantido` com ponteiro — não `a-classificar`. É o
único caso deste plano em que a classificação não precisa de decisão nova: a decisão já existe e está
escrita.

### E3 — Extração `DS-` (`prd-design-system-plataforma.md`, 767 linhas)

Candidatos: componentes da primeira versão (§11.1–11.5), padrões operacionais (§12.1–12.6), sistema
de tokens (§9), tipografia e iconografia (§10), regras de toast (§13). "Não objetivos" (§5.2) entram
direto como `excluído`, com decisor = documento de origem — é exclusão já assinada.

**Bloqueio:** este documento existe duplicado byte a byte em `docs/design/uploads/`. Resolver a
canônica antes de ancorar, senão as âncoras apontam para o arquivo errado (pergunta 5 da
`spec-rastreabilidade-01`).

### E4 — Sessão de classificação com o PI

Entrada: matriz completa, tudo `a-classificar` exceto o que E2 já resolveu. Saída: cada linha com um
dos cinco estados, decisor e data. É a sessão que efetivamente define o que o produto entrega.

**Ordem importa:** E4 depois de E1–E3, nunca em paralelo — classificar por partes gera transferências
para MVPs que uma extração posterior mostraria melhores.

## Critério de pronto

- Nenhuma linha `a-classificar` na matriz.
- Todo `transferido` aponta MVP existente em `docs/mvp/`.
- Todo `adiado` tem gatilho e data.
- `docs/FORA-DE-ESCOPO.md` regenerado a partir da matriz.
- O verificador ([#361](https://github.com/RodReis/rrb-jarvisOS/issues/361), `spec-rastreabilidade-01`) roda verde em modo bloqueante.

# SPEC-Entrega-04 — Construção e recuperação

- MVP/Fatia: MVP-009 · M9-F04.
- Issue: [#104](https://github.com/RodReis/rrb-jarvisOS/issues/104).
- Status: **aprovada-pi** (2026-08-29) — local de execução (container) e acesso a documentação técnica resolvidos pelo PI nesta data. **Emenda 2026-08-30:** chamadas ao modelo saem pelo **proxy no host** (M9-F03); validações disparadas pelo app rodam no container; revisão é feita pelo executor (ver § Emendas).
- Depende de: M9-F03 e adapter Claude Code do MVP-005.

## Objetivo

Executar Claude Code **dentro do container da M9-F03**, sobre o worktree montado, validar continuamente e recuperar até duas vezes usando somente delta e falhas relevantes.

## Entrada do executor

SPEC/hashes aprovados, ContextPack, paths permitidos, comandos de validação, `REVIEW.md`, orçamento, tentativa e falhas abertas. Segredos e relatórios resolvidos não entram.

**Ferramentas do executor.** O agente dispõe do **Context7 como MCP** para consultar documentação técnica atual durante a construção — é aqui que a consulta técnica vive na pipeline (decisão do PI 2026-08-29, herdada da revisão do MVP-008). O **aplicativo não expõe Context7 como conector**; nada no app o chama.

## Regras

- Máximo de três tentativas totais: inicial + duas recuperações.
- Escolha técnica reversível dentro da SPEC é autônoma e registrada.
- Requisito de produto ausente não é inferido.
- Documento/ADR auxiliar é atualizado no mesmo PR, sem bloquear depois do gate.
- TDD é obrigatório quando a SPEC envolver isolamento, autorização, idempotência financeira ou outra invariante crítica explicitamente existente.
- Timeout/cancelamento mata a árvore de processos e preserva evidência.
- Recuperação recebe diff atual, erros novos e histórico resumido; não relê o repositório inteiro por padrão.

## Classificação

- Corrigível: teste/lint/type/build, revisão, CI ou conflito solucionável dentro da SPEC.
- PI: mudança de produto, contradição estrutural ou escolha irreversível material.
- Externo: auth, quota, serviço ou infraestrutura sem alternativa autorizada.
- Risco do usuário: potencial de sobrescrever trabalho existente.

## Critérios de aceite

1. Comando e cwd são controlados pelo adapter, **dentro do container**; não existe caminho de execução no host.
2. Tentativa excedente é impedida.
3. Recuperação não repete descoberta resolvida.
4. Alteração fora do escopo bloqueia commit e traz diff.
5. Cancelamento não deixa subprocesso órfão.
6. Custo/tokens são atribuídos por tentativa.
7. Falha terminal contém ação mínima de retomada.
8. **Execução é containerizada:** o adapter só inicia o executor com o container pronto e o worktree montado. Teste comprova que sem container não há execução.
9. **Uso da rota de assinatura é registrado sem valor monetário** (emenda da SPEC-Providers-03); atribuição por tentativa continua obrigatória. Teste.
10. **Toda chamada ao modelo feita pelo executor passa pelo proxy do host** e chega ao `AiCallService` com `runId`/`attemptId`; o gate de orçamento do MVP-005 barra a tentativa que estouraria **antes** de ela sair. Teste com servidor que conta requisições.
11. **`test/lint/type/build` disparados pelo app rodam no container**, nunca no host. Teste comprova que o adapter não tem caminho de execução de validação no host.

## Testes e evidência

Adapter fake nas suítes comuns; fixtures de timeout/cancelamento/falha repetida/nova; smoke Claude real limitado. Relatório `SPEC-Entrega-04`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Onde o Claude Code roda:** **dentro do container da M9-F03**, com o worktree montado — nunca no host. Ver a decisão completa e o motivo na SPEC-Entrega-03. — decidido.
2. **Documentação técnica (Context7):** vive **aqui**, como ferramenta do agente construtor (MCP), e não como conector do aplicativo. Fecha a pendência herdada da revisão do MVP-008; a M9-F03 monta o ContextPack, mas o ContextPack é manifesto imutável do que foi enviado — a consulta técnica acontece **durante** a construção, que é esta fatia. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **O agente não fala com o GitHub.** Efeito remoto é do app (M9-F01/M9-F05); o container não recebe token.
- **Três tentativas contam o run inteiro** (inicial + duas), não por etapa — já é regra, cravado para não virar "três por fase".
- **Escolha técnica reversível dentro da SPEC é autônoma e registrada**; requisito de produto ausente **nunca** é inferido (invariante 9 da CONVENTION §4).
- **Revisão (M9-F05) é uma invocação do mesmo executor, no mesmo container, com `REVIEW.md` e o diff como entrada** — não existe revisor independente no MVP-009 (isso é a M11-F04). A invocação de revisão **consome orçamento** e é atribuída ao run, mas **não consome tentativa**; só a correção que ela dispara consome.

## Emendas (2026-08-30) — revisão de furos de spec

1. Critérios 10 e 11 fecham dois buracos herdados da M9-F03: sem proxy o executor não tinha como chamar modelo; sem validação no container, o app rodaria no host o código que o agente acabou de escrever.
2. A revisão não dizia quem revisa nem o que ela custa — cravado acima (Cowork, PI pode vetar).

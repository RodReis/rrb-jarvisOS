# SPEC-Blueprints-02 — Instanciação e wizard orientado

- MVP/Fatia: MVP-023 · M23-F02.
- Issue: [#215](https://github.com/RodReis/rrb-jarvisOS/issues/215); épico [#212](https://github.com/RodReis/rrb-jarvisOS/issues/212).
- Status: **aprovada-pi** em 2026-08-31, revisão exata `6a6e702a4d6ced5820d3f4c7674d6278f0b2d391`.
- Design: `docs/superpowers/specs/2026-08-31-mvp-023-blueprints-design.md`.
- Depende de: [#214](https://github.com/RodReis/rrb-jarvisOS/issues/214), [#96](https://github.com/RodReis/rrb-jarvisOS/issues/96).
- Rastreabilidade: B-FR02/B-FR03/B-NFR01/B-NFR02; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada; o aceite habilita o Backlog, sem alterar `next` ou a fila.

## Objetivo e fronteira

Converter uma revisão compatível em rascunho editável de projeto, pelo dono M8, e alimentar perguntas aplicáveis no wizard existente. Sem herança dinâmica, execução de template, aprovação copiada ou novo caminho de Git.

## Contrato e ownership

BlueprintInstancePlan congela revisão/hash do blueprint, projeto-alvo, variáveis tipadas, artefatos previstos, precondições e operationId. Registro de origem acompanha cada artefato gerado e revisão local. Não resolver latest novamente durante aplicação. Variáveis usam substituição determinística de dados; não eval/shell. Tipos, ausência obrigatória e escaping por papel são validados. Approval records nunca são criados pela cópia. Projeto recebe draft; campos e gates obedecem M8.

## Fluxo

Selecionar revisão → informar alvo pelo serviço de projeto → validar compatibilidade/variáveis → mostrar plano e conflitos → materializar rascunhos → cadastrar perguntas candidatas → abrir wizard. Pergunta por vez, recomendação e alternativas do M8-F03. Pergunta respondida só reaparece se o dono detectar mudança material aplicável. Decide por mim registra autoria da IA, justificativa e delegação limitada; não fabrica escolha/aceite do PI. Assistência usa o ContextPack e orçamento canônicos; cópia determinística não chama modelo.

## Falhas, limites e retomada

Diário separa planned/applying/reconciling/completed e conflict/cancelled/failed. Mesmo ID e entrada retornam resultado original; entrada diferente conflita. Cada efeito de projeto/documento/Git tem referência/recibo do dono. Após timeout, consultar efeito antes de retry. Não sobrescrever arquivo diferente já existente; hash/revisão esperados precedem escrita. Cancelamento preserva projeto/documentos já criados e explica parcialidade; não apaga checkout nem desfaz commits. Uma operação mutante por instância, revisão esperada e fencing pelo dono. Reinício retoma o plano fixado.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/blueprints.ts`, `src/shared/contracts/blueprints.ts`, `src/main/blueprints/` e testes junto aos módulos. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Plano fixa revisão, hashes, variáveis, alvo e operationId antes de aplicar.
2. Mudança do catálogo durante operação não muda os arquivos produzidos.
3. Variáveis inválidas/ausentes e expressão executável são rejeitadas sem efeito.
4. Arquivo preexistente diferente gera conflito sem perda de trabalho local.
5. Reexecução com ID/entrada iguais não duplica projeto/documento/commit.
6. ID com entrada diferente é conflito detectado antes de I/O.
7. Crash entre persistência, cópia e Git reconcilia pelos recibos proprietários.
8. Cancelamento após efeito mostra resultado parcial e preserva efeitos confirmados.
9. Wizard reaproveita respostas aplicáveis e faz uma pergunta por vez.
10. Decide por mim registra delegação/autoria; não cria Approval ou aceite de SPEC.
11. Cópia não gasta tokens; assistência respeita o orçamento e recorte existentes.
12. Instância funciona após descontinuação/indisponibilidade da biblioteca e continua editável.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Fakes de fronteiras externas não substituem a implementação real do núcleo da fatia. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima foram aceitos na revisão exata registrada. Dependências, fila e anexos visuais quando aplicáveis permanecem requisitos de entrada; o aceite não inicia código por inferência.

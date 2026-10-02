# SPEC-Squads-00 — Prova do orquestrador local e do integrador

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 00).
- Issue: [#369](https://github.com/RodReis/rrb-jarvisOS/issues/369); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; redigida em 2026-10-02 (ADR-006, decisão 12); critérios fixados pelo PI em 2026-10-02.
- Depende de: MVP-010 concluído.
- **Resultado (2026-10-02, PR [#372](https://github.com/RodReis/rrb-jarvisOS/pull/372)):** orquestrador local **reprovado**; integrador **inconclusivo** por defeito do instrumento. Checkpoint aceito pelo PI; prova reaberta na [Emenda E1](#emenda-e1--reabertura-da-prova-pi-2026-10-02), issue [#373](https://github.com/RodReis/rrb-jarvisOS/issues/373).

## Objetivo

Provar com medição, antes da primeira fatia de produto, as duas incertezas que fazem o MVP-011 ser R-crítico: um modelo local de 8B gerando planos válidos e um agente integrador juntando o trabalho de dois escritores sem perder código.

## Dentro

- Conjunto de referência de **fatias já entregues** (SPEC aprovada, diff mergeado, testes conhecidos) do próprio jarvisOS.
- Execução de `hermes3:8b` e `qwen3:8b` via adapter Ollama, gerando `SquadPlan` no schema da F02 para cada fatia de referência.
- Execução do mesmo conjunto pelo modelo da fase (fallback), como linha de base.
- Medição: % de planos aceitos pelo validador, motivos de rejeição, latência, uso de VRAM e de contexto (`num_ctx` efetivo) na máquina do PI.
- Conjunto de **merges históricos com conflito**, reconstruídos como dois escritores, integrados pelas camadas candidatas a integrador.
- Medição do integrador: hunks preservados, descartados com motivo e perdidos sem registro; suíte verde; achados do revisor.
- Relatório versionado com os números brutos e a recomendação do modelo padrão.

## Fora

- Escolher o modelo padrão sem atingir o critério.
- Ajustar o validador para fazer um modelo passar.
- Qualquer efeito remoto (PR, push, issue).

## Critérios numéricos (PI, 2026-10-02)

- **Orquestrador local:** vira padrão somente com **≥ 80%** de planos aceitos pelo validador no conjunto de referência.
- **Integrador:** **zero** hunk perdido sem registro **e 100%** de suítes verdes após a integração no conjunto de merges com conflito.

## Regras

1. O validador usado na prova é o da F02 em forma mínima, congelado por hash antes da medição.
2. O orquestrador local só vira padrão se atingir o critério; abaixo dele, o padrão é o modelo da fase e o local fica como opção.
3. Um único hunk perdido sem registro reprova o integrador avaliado, qualquer que seja o restante.
4. A medição roda no hardware real do PI e declara o hardware no relatório.

## Critérios de aceite

1. O relatório traz, por modelo, os números de cada fatia de referência, e não só a média.
2. O critério do PI aparece no relatório como aprovado ou reprovado, com o número.
3. O manifesto de hunks detecta perda injetada de propósito (teste negativo).
4. A medição é reproduzível pelo snapshot (modelos, prompts, validador, conjunto).

## Testes e evidência

- harness de benchmark com fixtures das fatias de referência;
- teste negativo do manifesto (hunk removido de propósito);
- relatório bruto em `reports/` conforme `TESTING.md`.

## Conjunto de referência (PI, 2026-10-02)

Fatias **mergeadas do MVP-009, do MVP-010 e do MVP-026**. A lista exata (issue, SHA do merge, SPEC) é fixada no snapshot da medição antes de rodar.

## Emenda E1 — reabertura da prova (PI, 2026-10-02)

Fatia **M11-F00b**, issue [#373](https://github.com/RodReis/rrb-jarvisOS/issues/373). Os critérios numéricos **não mudam**; muda o instrumento.

### O que a primeira medição mostrou

- **Orquestrador:** `qwen3:8b` 10/17 e `hermes3:8b` 9/17, abaixo de 80%. O número ainda superestima o local: dos planos aceitos, a maioria só tem `revisor` com `paths` vazios, ou caminhos de outra stack (`.java`, `.go`). Com escritor e caminho plausível, sobram cerca de 2 em 17 por modelo. O validador mínimo mede forma, não executabilidade, e o prompt só dava os nomes dos diretórios, sem a árvore de arquivos nem a stack.
- **Integrador:** o critério literal reprova até a resposta humana porque o instrumento produz piso não nulo:
  1. o conflito sintético era o mesmo trecho com um comentário `// w2` de um lado, e não dois comportamentos;
  2. bloco que a camada local não resolve (acima de ~18 mil caracteres) ficava com marcadores e era contado como preservado;
  3. os casos históricos são só de docs, sem suíte, e o piso deles inclui descartes humanos sem registro.

### Decisões do PI

1. **Checkpoint cumprido:** a F00 reprovou no critério e o padrão do orquestrador é o **modelo da fase**, pela assinatura (regra 2). A M11-F01 está liberada.
2. **Orquestrador local fica como opção**, só atrás do validador endurecido da [SPEC-Squads-02 § Emenda E1](spec-squads-02-planejador-validador.md), e passa por nova prova (F00-bis). Atingindo ≥ 80%, vira padrão.
3. **Integrador:** critério mantido; nova medição com o instrumento corrigido.

### Instrumento corrigido — integrador

1. **Conflito sintético real:** os dois lados acrescentam comportamentos distintos na mesma região, cada um coberto por teste próprio. A verdade é o merge que preserva os dois, montado e com a suíte verde **antes** da medição; por construção, o piso é zero.
2. Os seis casos sintéticos da primeira medição são refeitos nesse formato, sobre as mesmas fatias.
3. **Bloco não resolvido** (marcador restante ou `fora_do_contexto`) é falha do caso, nunca hunk preservado.
4. O critério do integrador é aplicado aos **casos de código com suíte**. Os merges históricos de docs continuam no relatório, como informativos.
5. Manifesto e casos congelados por hash novo antes de rodar.

### Instrumento corrigido — orquestrador (F00-bis)

1. Mesmo conjunto de referência (17 fatias).
2. O prompt recebe a **árvore de arquivos da base** do merge, dentro dos diretórios permitidos, e a stack do projeto.
3. **Replanejamento com feedback:** a rejeição do validador volta ao prompt, até o limite da M9-F04 — como na F02. O critério de 80% vale para planos aceitos dentro do limite; a primeira tentativa também aparece no relatório.
4. Validador = o endurecido da SPEC-Squads-02 § Emenda E1, congelado por hash.

### Critérios de aceite da emenda

1. O relatório traz, por modelo e por fatia, primeira tentativa e resultado dentro do limite.
2. Teste negativo do manifesto: bloco não resolvido cai em falha.
3. Teste do caso sintético: a verdade preserva os dois comportamentos e a suíte dela passa.

## Perguntas abertas ao PI

Nenhuma. Emenda E1 decidida pelo PI em 2026-10-02.

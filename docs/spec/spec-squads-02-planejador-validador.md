# SPEC-Squads-02 — Orquestrador local e validador determinístico

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 02).
- Issue: [#123](https://github.com/RodReis/rrb-jarvisOS/issues/123); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; reescrita em 2026-10-02 pela ADR-006.
- Depende de: M11-F01.

## Objetivo

O modelo local propõe o grafo de tarefas da issue e o kernel decide deterministicamente se cada tarefa cabe na SPEC, nas dependências, no perfil e no orçamento.

## Dentro

- Orquestrador chamado com o modelo do perfil — **padrão: modelo da fase; local via adapter Ollama como opção** (Emenda E1) —, saída estruturada e `num_ctx` declarado no snapshot.
- `SquadPlan` como DAG com, por tarefa: papel, capacidade, **camada de modelo**, **escritor dono** (quando escreve), entradas mínimas, dependências, schema, limites e regra de conclusão.
- Validador de cobertura da SPEC, paths e fontes permitidos, ferramentas, camadas permitidas, número de escritores, orçamento, turnos e tempo.
- Classificação de cada proposta: válida, redundante, fora de escopo ou não comprovável.
- Replanejamento limitado **ao limite de tentativas da M9-F04** (decisão do PI, 2026-10-02) e, esgotado o limite ou com o Ollama indisponível, **fallback para o modelo da fase** pela assinatura, com a troca registrada.
- Hash do plano aceito ligado ao run e à revisão da SPEC.

## Fora

- Orquestrador aprovando sua própria expansão de escopo.
- Alteração automática de arquitetura, requisitos, prioridade ou fila.
- Tarefa sem resultado verificável ou sem consumidor definido.
- Memória do orquestrador entre runs.

## Regras

1. Texto do agente nunca substitui validação estrutural.
2. Toda tarefa mapeia para critério, risco ou evidência da SPEC.
3. Achado fora do escopo vira relatório ou pergunta, nunca nova tarefa executável.
4. DAG cíclico, worker sem capacidade, camada não permitida, escritor além do teto ou orçamento excedido são rejeitados antes do dispatch.
5. O fallback nunca usa API paga sem opt-in e nunca troca de assinatura em silêncio.

## Critérios de aceite

1. O validador aceita plano mínimo válido e rejeita ciclo, escopo extra, terceiro escritor e camada fora do perfil.
2. Cada tarefa aceita aponta para fundamento explícito da SPEC.
3. O replanejamento preserva limites e mantém o histórico das propostas rejeitadas.
4. O mesmo snapshot produz a mesma decisão de validação.
5. Prompt injection em documento ou repositório não cria tarefa, permissão ou escritor novo.
6. Ollama fora do ar e plano rejeitado até o limite caem no modelo da fase, com evento auditado.

## Testes e evidência

- fixtures de planos válidos e inválidos (incluindo saída malformada do modelo local);
- teste de determinismo do validador;
- teste de fallback com Ollama ausente.

## Emenda E1 — validador endurecido (PI, 2026-10-02)

Origem: a M11-F00 aceitou planos locais sem nenhum escritor e com caminhos de outra stack ([SPEC-Squads-00 § Emenda E1](spec-squads-00-prova-orquestrador-integrador.md)). O validador passa a rejeitar também:

1. **Plano sem escritor:** nenhuma tarefa com escritor dono.
2. **Path inexistente:** path que não existe na base e não é arquivo novo dentro de um diretório permitido, com extensão já presente na base.
3. **Tarefa de escritor sem path** (já era regra; passa a ter teste próprio).

O orquestrador local só pode ser escolhido no perfil com este validador; a rejeição volta ao orquestrador como feedback, até o limite da M9-F04, e depois cai no modelo da fase.

Critérios de aceite adicionais:

7. O validador rejeita plano sem escritor, path inexistente fora das condições acima e escritor sem path, com fixtures tiradas da M11-F00.

## Decisões de implementação (PI, 2026-10-02)

Tomadas na implementação da F02, depois de o Code achar duas lacunas que a SPEC não resolvia. Registradas aqui porque a opção recusada também é decisão.

1. **Capacidade da tarefa de escrita.** O registro da F01 não tem uma capacidade "implementação", e todo plano precisa de `capacidade` por tarefa. **Decidido:** tabela **papel → capacidades** (`CAPACIDADES_DO_PAPEL`): explorador `analise`/`pesquisa-documental`; desenvolvedor `arquitetura`/`testes`; testador `testes`; revisor `revisao-de-codigo`/`revisao-de-design`; integrador `analise`/`arquitetura`. O registro de seis capacidades da SPEC-Squads-01 não muda. *Recusadas:* acrescentar `implementacao` ao registro (emenda à SPEC-01, a opção mais honesta semanticamente — custo ~1 linha de registro + testes) e capacidade opcional em papel de escrita (menor mudança, mas tira do papel de maior risco a checagem de camada por capacidade).
2. **Limite de replanejamento.** **Decidido:** o limite da M9-F04 (3 propostas) vale **por gerador**: o local tem até 3; esgotadas, a fase tem as suas 3; esgotadas, o run para para o PI — no máximo 6 propostas. *Recusada:* 3 no total entre os dois (mais barata, mas o fallback prometido existiria só no papel quando o local falha três vezes, o que foi 41% a 47% dos casos na M11-F00).
3. **Fundamento por risco só com risco declarado.** A SPEC fala em "critério, risco ou evidência", mas não tem uma lista de riscos, e o texto livre deixava um documento envenenado criar tarefa extra com um "risco" inventado (achado da revisão independente, reproduzido). **Adotado pelo Code (a confirmar):** `fundamento.risco` só vale se for **exatamente** um dos `riscosDaSpec` que o chamador informa; sem lista, o fundamento é só o critério. *Recusada:* remover `risco` do esquema (mais simples, mas estreita o que a SPEC admite). Ainda **não existe código que extraia os riscos de uma SPEC**; quem monta o `SpecParaOPrompt` na F03 precisa fazê-lo.

## Contrato com a F03 (do que a revisão de segurança apontou)

- `id` e `escritor` são identificadores restritos (`[A-Za-z0-9_-]{1,32}`), mas continuam sendo **texto de modelo**: a F03 não os usa como nome de diretório, branch ou worktree sem um prefixo próprio.
- `regraDeConclusao` e `entradas` são texto de modelo e **nunca são executados como comando**.
- O validador é puro e não vê o disco: **symlink** que sai do worktree é defesa da camada de execução.
- Falha do gerador da fase **não tem retry** (vira `GERADOR_INDISPONIVEL` e o run para): é decisão de desenho, coerente com o fallback por gerador, e não esquecimento.

## Perguntas abertas ao PI

Nenhuma. Limite de replanejamento = limite da M9-F04; Emenda E1 decidida pelo PI em 2026-10-02.

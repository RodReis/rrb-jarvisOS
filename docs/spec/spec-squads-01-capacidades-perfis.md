# SPEC-Squads-01 — Capacidades, perfis e camadas de modelo

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 01).
- Issue: [#122](https://github.com/RodReis/rrb-jarvisOS/issues/122); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; reescrita em 2026-10-02 pela ADR-006; substitui a revisão aprovada em 2026-08-29.
- Depende de: M11-F00 aprovada pelo critério.

## Objetivo

Descrever Squads por capacidades verificáveis e por camadas de modelo, e não por nomes de skills ou agentes que podem faltar no ambiente. O perfil é o contrato que o orquestrador e o validador consomem.

## Dentro

- Registro versionado de capacidades: análise, arquitetura, testes, revisão de código, revisão de design, pesquisa documental.
- **Camadas de modelo**: orquestrador local, executor e especialista, cada uma resolvida por provider e modelo das rotas existentes (MVP-005 e MVP-026).
- Perfil por tipo de fatia com:
  - capacidades obrigatórias e opcionais, cada uma com as camadas permitidas;
  - número de escritores (1 ou 2) e camada do integrador, que precisa ser diferente da do revisor;
  - ações que exigem aprovação do PI: alteração estrutural de banco, comando destrutivo e deploy (registrada);
  - limites e schemas de resultado.
- Resolução de cada capacidade em skill, ferramenta, prompt disciplinado, **modelo local via Ollama** ou indisponibilidade explícita com motivo.
- Compatibilidade entre executor, ferramentas, acesso, custo e função (somente leitura, escritor ou integrador).
- Snapshot do perfil e das resoluções no run.

## Fora

- Marketplace ou criação automática de skills.
- Agent/Squad genérico fora da pipeline.
- Autoridade para alterar SPEC, prioridade, fila, gate, Git ou merge.

## Regras

1. Skill nominal ausente não remove a disciplina; usa fallback aprovado equivalente.
2. Capacidade obrigatória sem implementação ou fallback torna o plano inelegível.
3. Perfil não concede acesso superior ao exigido pela função.
4. Mudança de perfil durante um run não altera seu snapshot.
5. **Até o MVP-028 entregue, o perfil aceita 1 escritor por padrão**; 2 escritores só em E2E de teste (ADR-006, decisão 16).
6. Fable só resolve pela rota de assinatura; nenhuma camada cai em API paga sem o opt-in do projeto (MVP-026).

## Critérios de aceite

1. Perfis são versionados, validados e reproduzíveis pela revisão registrada.
2. A resolução informa implementação, fallback ou motivo de indisponibilidade por capacidade e por camada.
3. O perfil rejeita mais de 2 escritores, integrador na mesma camada do revisor e qualquer agente com permissão de Git ou GitHub.
4. Custo e limites máximos são calculáveis antes de instanciar o Squad, contando um slot por escritor.
5. Testes cobrem skill presente, ausente com fallback, obrigatória sem fallback, e Ollama fora do ar resolvendo para o modelo da fase.

## Testes e evidência

- schema e fixtures de perfis, incluindo inválidos;
- matriz de resolução de capacidades × camadas;
- auditoria do snapshot usado.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02.

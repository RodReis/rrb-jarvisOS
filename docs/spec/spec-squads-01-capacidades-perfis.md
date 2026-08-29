# SPEC-Squads-01 — Registro de capacidades e perfis

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 01).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: MVP-010 concluído.

## Objetivo

Descrever Squads por capacidades verificáveis, não por nomes de skills ou agentes que podem faltar no ambiente.

## Dentro

- Registro versionado de capacidades como análise, arquitetura, testes, revisão de código, revisão de design e pesquisa documental.
- Perfil de Squad por tipo de fatia, com capacidades obrigatórias/opcionais, limites e schemas de resultado.
- Resolução de cada capacidade por skill, ferramenta, prompt disciplinado ou indisponibilidade explícita.
- Compatibilidade entre executor, ferramentas, acesso, custo e função somente-leitura/escritor.
- Snapshot do perfil e das resoluções no run.

## Fora

- Marketplace ou criação automática de skills.
- Agent/Squad genérico fora da pipeline.
- Autoridade para alterar SPEC, prioridade, gate, Git ou merge.

## Regras

1. Skill nominal ausente não remove a disciplina; usa fallback aprovado equivalente.
2. Capacidade obrigatória sem implementação/fallback torna o plano inelegível.
3. Perfil não pode conceder acesso superior ao exigido pela função.
4. Mudança de perfil durante run não altera seu snapshot.

## Critérios de aceite

1. Perfis são versionados, validados e reproduzíveis pela revisão registrada.
2. Resolução informa implementação, fallback ou motivo de indisponibilidade por capacidade.
3. Perfil rejeita dois escritores ou worker com permissão de Git/GitHub.
4. Custo/limites máximos podem ser calculados antes de instanciar o Squad.
5. Testes cobrem skill presente, ausente com fallback e obrigatória sem fallback.

## Testes e evidência

- schema/fixtures de perfis;
- matriz de resolução de capacidades;
- auditoria do snapshot usado.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

# MVP-014 — Release e Deploy Governado

- Status: **design e cinco SPECs aprovados pelo PI em 2026-08-29**; implementação aguarda a ordem da fila.
- GitHub: épico [#149](https://github.com/RodReis/rrb-jarvisOS/issues/149); fatias [#150–#154](https://github.com/RodReis/rrb-jarvisOS/issues/150), estado `proplan:backlog`.
- Depende de: MVP-013 concluído.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Tese

Transformar merges confirmados da Pipeline V2 em Preview, Staging e Produção verificáveis, com o mesmo artefato promovido, migrations forward-only, compensação segura e evidência durável, sem segundo aceite do PI.

## Fatias

- [ ] M14-F01 [#150](https://github.com/RodReis/rrb-jarvisOS/issues/150) — Núcleo de release e fila — `spec-release-01-nucleo-estados-fila.md`.
- [ ] M14-F02 [#151](https://github.com/RodReis/rrb-jarvisOS/issues/151) — Docker, artefatos e configuração — `spec-release-02-compose-artefatos-config.md`.
- [ ] M14-F03 [#152](https://github.com/RodReis/rrb-jarvisOS/issues/152) — Preview isolado por PR — `spec-release-03-preview-isolado.md`.
- [ ] M14-F04 [#153](https://github.com/RodReis/rrb-jarvisOS/issues/153) — Staging e Produção automática — `spec-release-04-staging-producao.md`.
- [ ] M14-F05 [#154](https://github.com/RodReis/rrb-jarvisOS/issues/154) — Compensação, retorno à V2 e E2E — `spec-release-05-recuperacao-e2e.md`.

## Fora do escopo

- Provedores além de Docker Compose, GHCR, Vercel e Railway.
- Cofre próprio de segredos.
- Restore automático do PostgreSQL.
- Observabilidade histórica e detecção de regressão do MVP-015.
- Aprendizado/contexto do MVP-016.
- LGPD, consentimento, aceite duplo, regra jurídica ou classificação de risco não fornecida pelo PI.

## Critério de done

1. Preview completo nasce por PR/fatia e é removido ao fechar o PR.
2. Merge confirmado percorre Staging e Produção automaticamente após os gates.
3. Staging e Produção usam o mesmo digest OCI e o mesmo deployment imutável do frontend.
4. Banco usa migration forward-only, backup e recuperação separada das aplicações.
5. Reinício, efeito incerto e falha parcial convergem sem duplicar deploy.
6. Release saudável produz identidade, manifesto, changelog, tag e GitHub Release.
7. Falha de código retorna à V2 na mesma SPEC sem alterar Produção diretamente.

## Gate

As cinco SPECs precisam de aprovação pré-construção do PI. Este documento não autoriza implementação, issues, push ou PR.

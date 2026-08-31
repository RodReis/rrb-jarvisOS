# SPEC-Portfolio-03 — Custos, quotas e capacidade do portfólio

- MVP/Fatia: MVP-024 · M24-F03.
- Issue: [#220](https://github.com/RodReis/rrb-jarvisOS/issues/220); épico [#213](https://github.com/RodReis/rrb-jarvisOS/issues/213).
- Status: **rascunho-completo** (2026-08-31). Redação concluída; aceite exato de MVP/SPEC antes da construção ainda não presumido.
- Design: `docs/superpowers/specs/2026-08-31-mvp-024-portfolio-design.md`.
- Depende de: [#218](https://github.com/RodReis/rrb-jarvisOS/issues/218), [#157](https://github.com/RodReis/rrb-jarvisOS/issues/157).
- Rastreabilidade: P-FR03/P-FR04/P-NFR02; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada por este documento.

## Objetivo e fronteira

Projetar custos atribuíveis por projeto, quotas compartilhadas e capacidade do scheduler, sem segunda contabilidade, scraping ou gasto automático.

## Contrato e ownership

Custo vem do ledger M15 sob período UTC semiaberto, timezone só na exibição, moeda e modo explícitos. Confirmado/estimado/reservado/desconhecido não se confundem; não somar moedas nem derivar preço por chamada de assinatura. Quota é snapshot por provider+profileFingerprint+mode+windowId; projetos consumidores apontam para o mesmo saldo, não cópias. Atribuição ao projeto só quando a origem oferece a parcela; caso contrário mostrar compartilhada/não atribuída.

## Fluxo

Resolver filtros e corte → obter agregados/referências pelo M15 → agrupar por identidade de quota/período compatível → mostrar custos e uso atribuível separadamente → obter slots/leases e motivos pelo M12. Janelas5h, semanal e créditos são dimensões distintas. Remanescente negativo/ausente/inconsistente conserva diagnóstico da fonte; não normalizar silenciosamente para sucesso. Link de detalhe abre console proprietário com o mesmo recorte.

## Falhas, limites e retomada

Quota desconhecida ou stale conserva estado/idade/fonte, nunca infinito ou zero. Sem quota estruturada do Claude, permanecer quota_unknown; não ler a tela por OCR. Limites de query/cache da F01; painel não consulta um provedor por linha. Capacidade potencial não é promessa de início nem reserva; indisponibilidade de dado não cria regra de bloqueio. Repetição/atualização reconciliam o mesmo corte e deduplicam eventos. Falha de projeção não muda limite, compra crédito, troca rota ou relança run.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/portfolio.ts`, `src/shared/contracts/portfolio.ts`, `src/main/portfolio/` e testes junto aos módulos. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Total por projeto concilia com ledger no mesmo período/moeda/modo.
2. Confirmado, estimado, reservado e desconhecido permanecem separados.
3. Moedas distintas nunca são somadas em total sem conversão autorizada.
4. Assinatura não recebe USD inventado ou preço por chamada.
5. Quota compartilhada aparece uma vez por identidade/janela no agregado.
6. Projeto sem atribuição confiável mostra não atribuído, não consumo zero.
7. Janelas5h, semanal e créditos não são somadas.
8. Quota ausente/stale tem qualidade, idade e origem explícitas.
9. Nenhuma linha consulta provedor diretamente ou usa scraping/OCR.
10. Slots, leases e espera vêm do scheduler e não garantem início.
11. Reconsulta, evento duplicado e corte temporal não duplicam custo ou quota.
12. Fonte indisponível não compra crédito, muda budget/provider ou bloqueia pelo painel.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Fakes de fronteiras externas não substituem a implementação real do núcleo da fatia. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima são proposta completa desta revisão. Revisão/aceite de entrada do PI e anexos visuais quando aplicáveis permanecem requisitos existentes; não bloqueiam publicar este planejamento nem autorizam código por inferência.

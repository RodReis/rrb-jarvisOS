# SPEC-Observabilidade-05 — Console operacional

- MVP/Fatia: MVP-015 · M15-F05.
- Issue: ainda não criada.
- Status: **aprovada-pi** (2026-08-29); implementação depende da fila, de issue ainda não criada e do gate visual abaixo.
- Depende de: M15-F04 aprovada e entregue; `DESIGN-SYSTEM.md` e protótipos HTML formais anexados/aprovados.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.
- Gate visual: layout **A — console operacional** aprovado no brainstorming; não substitui os artefatos formais do PI.

## Objetivo

Entregar ao PI um console por projeto que prioriza estado atual e exceções, permite investigar a cadeia causal e executar somente ações administrativas seguras sem duplicar lógica do runtime.

## Stack e estrutura

- React 19, TypeScript, Electron IPC e componentes públicos do Design System aprovado.
- `src/renderer/src/observability/ObservabilityConsole.tsx`: composição da rota.
- `src/renderer/src/observability/useObservabilityProjection.ts`: snapshot/deltas/reconexão.
- `src/renderer/src/observability/`: overview, atividade, alertas, custos/quotas, adapters e timeline.
- `src/main/ipc/handlers.ts`, `src/shared/contracts/ipc.ts` e `src/main/preload/index.ts`: ponte mínima tipada.
- Testes de componente próximos aos módulos; prova real em `tests/e2e/observability.e2e.ts` na F06.

## Dentro

- Seletor/contexto de um projeto.
- Cabeçalho com atualização, estado do observador e contagem de alertas.
- Cartões de pipeline, release, adapters e quota/custo com fonte/idade.
- Atividade em curso com etapa, duração, executor, próximo gate e IDs.
- Área “Atenção agora” ordenada por severidade/recência.
- Timeline `MVP → SPEC → run → PR → deploy → alerta/evidência`.
- Visões/filtros de runs, releases, alertas, custos/quotas e adapters.
- Estados loading, vazio, parcial, degradado, offline e erro recuperável.
- Reconectar por snapshot quando perder delta.
- Ações: atualizar, reconhecer, resolver com justificativa, abrir/copiar referência, exportar e testar conectividade.
- Link contextual para o fluxo proprietário quando correção for necessária.
- Teclado, foco, leitor de tela, contraste e texto pt-BR.

## Fora

- Comparar, ranquear ou priorizar projetos.
- Customizar dashboard por drag/drop ou widgets arbitrários.
- Iniciar/repetir run, deploy, rollback ou compensação.
- Editar BudgetPolicy, quota, rota, release policy ou credencial.
- Exibir stdout, prompt, resposta, diff, segredo ou payload externo bruto.
- Inventar percentual, custo, “saudável” ou horário de reset ausente.

## Regras

1. Renderer apenas projeta contratos; cálculo canônico permanece no main.
2. `unknown` é exibido como desconhecido, nunca como zero/sucesso.
3. Cor nunca é o único sinal; severidade e estado possuem texto/ícone acessíveis.
4. Estado degradado mostra idade da evidência e ação segura disponível.
5. Ação mutável exige comando tipado; link externo não executa efeito no domínio.
6. Resolução manual exige justificativa antes de enviar.
7. Filtro ativo e versão da projeção acompanham exportação/cópia de contexto.
8. Componentes/visual devem seguir `DESIGN-SYSTEM.md` e HTML aprovados, sem cair em painel genérico.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
```

## Estratégia de testes

- Testing Library para navegação, filtros, estados, teclado/foco e comandos.
- Fixtures de snapshot/deltas e reconexão após salto de versão.
- Teste de componente garante que `unknown` não recebe barra/percentual falso.
- Acessibilidade automatizada e prova manual registrada sobre o protótipo aprovado.
- Contrafactual: esconder idade, habilitar ação proprietária ou renderizar payload bruto precisa falhar.

## Critérios de aceite

1. Ao abrir um projeto, o PI identifica em uma tela estado atual, atividade e exceções.
2. Cada item navega até SPEC/run/PR/deploy/alerta/evidência correlacionados.
3. Filtro não perde contexto ao alternar visões nem após reconexão.
4. Salto de versão descarta parcial e solicita snapshot completo.
5. `quota_unknown`, provider stale e observador degradado são inequívocos.
6. Reconhecer/resolver alerta atualiza a projeção sem mutação otimista irreconciliável.
7. Nenhum controle inicia run/deploy/rollback/compensação ou edita política.
8. Tela completa opera por teclado, foco permanece previsível e estado não depende só de cor.
9. Renderer não recebe campo proibido nem abre SQLite.
10. Revisão visual comprova aderência ao `DESIGN-SYSTEM.md` e aos protótipos HTML aprovados.

## Limites

- **Sempre:** mostrar fonte/idade, usar serviço canônico e preservar acessibilidade.
- **Consultar a SPEC:** nova ação, visão, filtro ou mudança estrutural do layout.
- **Nunca:** calcular domínio no renderer, inventar dado, executar operação proprietária ou ignorar gate visual.

## Perguntas abertas ao PI

Nenhuma sobre esta SPEC. Revisão exata aprovada pelo PI em 2026-08-29. O aceite não substitui o gate futuro do `DESIGN-SYSTEM.md` e dos protótipos HTML formais antes da construção.

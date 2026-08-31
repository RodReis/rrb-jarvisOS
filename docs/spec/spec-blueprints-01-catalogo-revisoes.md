# SPEC-Blueprints-01 — Catálogo e revisões de Blueprints

- MVP/Fatia: MVP-023 · M23-F01.
- Issue: [#214](https://github.com/RodReis/rrb-jarvisOS/issues/214); épico [#212](https://github.com/RodReis/rrb-jarvisOS/issues/212).
- Status: **rascunho-completo** (2026-08-31). Redação concluída; aceite exato de MVP/SPEC antes da construção ainda não presumido.
- Design: `docs/superpowers/specs/2026-08-31-mvp-023-blueprints-design.md`.
- Depende de: [#99](https://github.com/RodReis/rrb-jarvisOS/issues/99).
- Rastreabilidade: B-FR01/B-FR02/B-NFR02; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada por este documento.

## Objetivo e fronteira

Registrar pacotes locais de documentos reutilizáveis com identidade, revisão imutável, validação de caminhos e compatibilidade. Não instanciar projeto, executar HTML/scripts ou importar aprovação.

## Contrato e ownership

BlueprintId identifica a família; BlueprintRevisionId é identidade imutável. Manifesto v1 declara propósito, versão do contrato de planejamento, artefatos (papel/path/tipo/bytes/SHA-256), variáveis tipadas e perguntas candidatas. JSON canônico, ordenação ordinal e bytes dos artefatos determinam hash lógico; data de importação não altera conteúdo. Mesma revisão/bytes retorna registro existente; mesma revisão com conteúdo diferente é conflito, não overwrite. Nova revisão não altera anteriores. Descontinuação retira da seleção padrão, sem invalidar instâncias.

## Fluxo

Diretório local explicitamente selecionado → staging próprio → enumeração/validação → cópia e verificação dos hashes → registro transacional → seleção visível. Raiz continua sujeita ao filesystem permitido. Sem download automático, exploração de home ou busca de credenciais. Validar antes e durante cópia: sem path absoluto/traversal/ADS/dispositivo Windows, colisão case-insensitive ou escape por symlink/reparse. Roles executáveis/hooks e schema desconhecido são rejeitados; HTML permanece dado até o fluxo proprietário de protótipo.

## Falhas, limites e retomada

Máximo inicial: 200 arquivos, 32 MiB por pacote, 2 MiB por texto, 8 MiB por asset, lotes de 25 arquivos/4 MiB. Limite de arquivo não se confunde com o quantum do lote: asset de até 8 MiB é transferido em blocos de no máximo 4 MiB, cedendo entre blocos e mantendo identidade e hash incremental do artefato inteiro. O checkpoint confirma o arquivo somente após verificar o hash final; crash no meio refaz apenas esse arquivo incompleto no staging, sem publicar parcial. Operação staging→validated→registered ou cancelled/failed; pacote incompleto não entra na seleção. Crash retoma pelo operationId/hash; cancelamento limpa somente staging identificado, sem apagar origem nem revisão registrada. Não há chamada de IA para importar/listar. SQLite existente mantém metadados e referências; bytes ficam em armazenamento local gerido. Renderer consulta IPC, não o disco.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/blueprints.ts`, `src/shared/contracts/blueprints.ts`, `src/main/blueprints/` e testes junto aos módulos. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Mesmo pacote e revisão produzem hash/registro iguais em duas importações.
2. Conteúdo divergente sob a mesma identidade gera conflito e conserva ambos os diagnósticos.
3. Revisão nova e descontinuação não modificam revisão anterior nem instância.
4. Manifesto rejeita campos de aprovação, permissões executáveis, roles/hooks ou schemas não suportados.
5. Paths Windows/Linux inválidos, colisão por case e reparse escapando da raiz falham antes de escrita externa.
6. Alteração da fonte durante cópia é detectada pelo hash; pacote parcial não fica selecionável.
7. Limites de arquivos/bytes/lotes são exercitados nas fronteiras e sem leitura ilimitada.
8. Crash antes/depois do registro converge sem duplicar revisão.
9. Cancelamento remove apenas staging pertencente à operação e preserva a origem.
10. Consulta do catálogo explicita compatibilidade, revisão, propósito e descontinuação.
11. Renderer/CLI recebem DTOs pelo serviço; nenhum acesso livre a paths ou SQLite.
12. Suíte temporária prova importação offline sem chamada a modelo, rede ou instalação.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Fakes de fronteiras externas não substituem a implementação real do núcleo da fatia. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima são proposta completa desta revisão. Revisão/aceite de entrada do PI e anexos visuais quando aplicáveis permanecem requisitos existentes; não bloqueiam publicar este planejamento nem autorizam código por inferência.

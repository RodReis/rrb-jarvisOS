# SPEC-Contínuo-04 — Projeções e próximo gate

- MVP: `docs/mvp/mvp-013-execucao-continua.md` (Fatia 04).
- Status: **revisão-pi** — implementação não autorizada.
- Depende de: F03 aprovada e entregue.

## Objetivo

Projetar o estado real da execução em GitHub, STATUS e evidências, e preparar o próximo gate sem aprová-lo, fechá-lo ou escondê-lo.

## Dentro

- Projeções idempotentes de run, branch, PR, checks, merge, bloqueio e cancelamento.
- Atualização curta do `docs/STATUS.md` e detalhe histórico em `docs/STATUS-ARQUIVO.md`.
- Índice Fatia ↔ SPEC validado e links para issue/PR/evidência.
- Relatório por SPEC em `reports/TESTS.md` conforme `docs/TESTING.md`.
- Painel do DAG com nós executáveis, ativos, esperando, bloqueados, mergeados e pendentes de aceite.
- Preparação de pacote do próximo gate: revisão, mudanças, questões e recomendação, sem decisão automática.

## Fora

- Fechar issue, aceitar MVP/SPEC ou mudar prioridade em nome do PI.
- Colocar prosa longa no STATUS.
- Usar comentário/label do GitHub como autoridade sem reconciliação.

## Regras

1. Projeções podem ser refeitas; estado de domínio/effects permanece a fonte reconciliada.
2. Dados extensos e históricos ficam fora do STATUS canônico.
3. Documento e ADR não bloqueiam código aprovado; divergência é registrada no PR e reconciliada sem inventar novo gate.
4. Evidência referencia head SHA, revisão de SPEC e comandos/resultados exatos.

## Critérios de aceite

1. Atualização repetida não duplica comentário, link, relatório ou entrada histórica.
2. STATUS permanece curto e contém índice íntegro Fatia ↔ SPEC.
3. Issue mergeada continua aberta até o PI aceitar/fechar.
4. Próximo gate mostra exatamente o artefato/revisão que exige decisão.
5. Divergência local/GitHub é exibida e reconciliada antes de nova projeção.
6. Retenção não remove hashes, auditoria ou relatório versionado necessário ao aceite.

## Testes e evidência

- snapshot das projeções;
- repetição/crash de cada efeito;
- verificador de links e índice;
- painel testado por componente e Playwright.

## Perguntas abertas ao PI

Nenhuma. Aguarda aprovação desta revisão exata.

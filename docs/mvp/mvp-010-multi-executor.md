# MVP-010 — Multi-executor Claude + Codex

- Status: **arquitetura aprovada pelo PI** em 2026-08-29; fatias em revisão.
- Depende de: MVP-005 e MVP-009 concluídos.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.

## Tese

Permitir que a mesma pipeline execute uma fatia com Claude Code ou Codex sem conhecer flags, eventos ou autenticação específicos. Um executor escreve; o outro revisa quando disponível.

## Fatias

| Ordem | Fatia | SPEC | Dependência |
|---:|---|---|---|
| 1 | Contrato comum e runtime de executores | `spec-multi-executor-01-runtime.md` | MVP-009 |
| 2 | Autenticação e perfil isolado do Codex | `spec-multi-executor-02-autenticacao-codex.md` | F01 |
| 3 | Codex Exec Adapter | `spec-multi-executor-03-codex-exec-adapter.md` | F02 |
| 4 | Roteamento, fallback e revisão cruzada | `spec-multi-executor-04-roteamento-revisao-cruzada.md` | F03 |
| 5 | UI e prova operacional | `spec-multi-executor-05-ui-prova-operacional.md` | F04 |

## Dentro

- `CodingExecutorRuntime` e contrato normalizado;
- Claude Code e Codex como implementações independentes;
- autenticação de assinatura por perfil dedicado;
- modos `subscription_limited`, `subscription_credits`, `api` e `local`;
- seleção por projeto/tarefa, fallback reconciliado e revisão por provider diferente;
- prova real limitada em container.

## Fora

- Squad e subagentes: MVP-011;
- execução concorrente: MVP-012;
- drenagem de roadmap: MVP-013;
- deploy e produção;
- implementação concorrente da mesma fatia.

## Done

1. Claude e Codex passam pelo mesmo contract test sem compartilhar parser.
2. Troca de executor não duplica efeito confirmado nem cria segundo escritor.
3. Assinatura, API e créditos possuem gates distintos e auditáveis.
4. GitHub/Vault/segredo do projeto não entram no container.
5. Jornada real constrói com um executor e revisa com o outro.

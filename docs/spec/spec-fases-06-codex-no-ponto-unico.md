# SPEC-Fases-06 — Codex como provider do ponto único

- MVP/Fatia: MVP-026 · M26-F06.
- Issue: [#256](https://github.com/RodReis/rrb-jarvisOS/issues/256); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **rascunho-completo** — uma pergunta aberta ao PI (abaixo). Vira `aprovada-pi` quando respondida.
- Depende de: M26-F02 (catálogo e modelo por fase); M26-F03 (console, `GenerationEvent`); **M10-F02** (autenticação e perfil isolado do Codex — puxada para a frente da fila por este MVP).

## Objetivo

Permitir que Planejamento e Especificação gerem pelo **Codex** (`gpt-5.6-sol`) pela **assinatura do Codex**, pelo mesmo ponto único, com o mesmo console e a mesma origem por afirmação — sem abrir segundo caminho de chamada de modelo.

## Dentro

- `AI_PROVIDERS` ganha `codex`; `ORIGEM_DO_PROVIDER.codex = 'cloud'`; `ROTAS_UNMETERED` ganha `codex` (assinatura registra uso sem valor monetário, como `claude-code`).
- Catálogo (`TABELA_DE_PRECO.codex`): `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4` — preço `0` na rota de assinatura. Modo `api` do Codex (M10-F02) é **rota paga**: só com o opt-in por projeto já existente, e com preço na tabela quando o PI o habilitar (preço a cadastrar na habilitação, não inventado aqui).
- `CodexAdapter` implementa o contrato dos adapters (M5-F04): `codex exec --model <id> --json` com o prompt por stdin, `cwd` do projeto, `CODEX_HOME` da M10-F02 via caminho controlado (não variável de ambiente livre — `ambienteControlado()` do MVP-004), timeout e `signal` matando o processo como o adapter do Claude Code faz. Sem shell.
- Parser de `codex exec --json` → `GenerationEvent` (F03): texto, ferramentas (comandos/leituras que o Codex executa), uso. Linha inválida = `erro` de parser sem derrubar a geração.
- Healthcheck: `ready`/`auth_required`/`quota_limited`/`quota_unknown`/`offline` da M10-F02 mapeados em `EstadoDoProvider` (`online`/`loading`/`offline`) para a tela de providers, com o detalhe no tooltip.
- **Rota de geração:** `EstadoDasRotas` (M25-F02) passa a distinguir **qual** assinatura — `escolherRota` continua puro: assinatura da fase (a do provider escolhido em `PhaseModelPolicy`) disponível → `assinatura`; indisponível → **bloqueia** com ação ("Conecte a assinatura do Codex em Providers, troque o modelo da fase, ou habilite a rota paga"). **Nenhuma assinatura cai na outra**: escolher Sol e ter só o Claude MAX conectado bloqueia, não troca.
- Combos da F02: Planejamento e Especificação passam a listar `Sol · gpt-5.6-sol`; Construção lista `gpt-5.5` **desabilitado com motivo** até a M10-F03/F04 (executor Codex no container) — listar e não atender seria fallback que não funciona.
- Auditoria: seleção, fallback recusado e troca de modelo com `AuditEvent` encadeado (ADR-004), como os demais providers.

## Fora

- Codex como **executor** da Construção (container, `codex exec` no run): M10-F03/F04.
- Revisão cruzada Claude↔Codex: M10-F04.
- Comprar créditos, criar chave, raspar cobrança (fora da M10-F02, fora daqui).

## Critérios de aceite

1. `gpt-5.6-sol` selecionado para Planejamento gera brief/perguntas/PRD pelo `CodexAdapter`; ledger registra `codex` com valor zero na assinatura.
2. Saída passa pelo mesmo validador de origem por afirmação e pela invariante 9 (SPEC-Jornada-02) — fixture de saída do Codex reprova afirmação sem origem.
3. Console mostra texto, ferramentas e uso a partir de `codex exec --json`; fixture gravada.
4. Assinatura do Codex indisponível com Sol escolhido → bloqueio com ação; nenhuma chamada ao Claude nem à API.
5. Modo `api` do Codex sem opt-in do projeto nunca é chamado — teste espelhando o da rota paga da Anthropic.
6. Health do Codex aparece na tela de providers; `auth_required` leva ao fluxo de login da M10-F02 sem o app receber segredo.
7. `gpt-5.5` aparece desabilitado na Construção com o motivo até a M10-F03/F04.
8. Nenhum caminho de chamada fora do ponto único (`call-provider`) — teste de contrato dos adapters inclui o `codex`.

## Testes e evidência

Contract test do adapter (o mesmo que os quatro existentes passam); unitários do parser com fixtures reais de `codex exec --json`; teste de `escolherRota` com duas assinaturas; int-spec do healthcheck com perfil fake; Playwright da fase Planejamento com Sol e adapter fake; smoke real com `codex-cli 0.149.0` fora da suíte padrão, sem registrar segredo. Relatório `SPEC-Fases-06`.

## Pergunta aberta ao PI

1. **A M10-F02 declara "Depende de: F01 aprovada e entregue" (runtime de executores em container).** O que esta fatia precisa dela — `CODEX_HOME` dedicado, login/logout pelo PI, health, modos de cobrança sem transição silenciosa, redaction — **não precisa do runtime em container**; o mount no container é a parte que serve ao MVP-010. Opções: **(a) Recomendada:** emendar a M10-F02 para que a dependência da M10-F01 valha só para o mount no container; a parte de host entra antes desta fatia. **(b)** Puxar também a M10-F01 (runtime), aumentando o escopo à frente do Shell. **(c)** Esta fatia entrega o perfil isolado no host por conta própria e a M10-F02 reaproveita — cria dois donos do `CODEX_HOME`, que eu desaconselho.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **Duas assinaturas, nenhuma cai na outra.** A decisão 4 do MVP-025 diz que a paga nunca é fallback; a mesma lógica vale entre assinaturas — trocar de fornecedor sem o PI decidir é a mesma surpresa em outra moeda.
- **Modo `api` do Codex é rota paga, com o mesmo opt-in.** A M10-F02 já diz "sem transição silenciosa" e "rate limit não autoriza créditos nem API"; esta fatia só aponta o interruptor existente.

# SPEC-Conectores-03 — GitHub App e autenticação

- MVP/Fatia: MVP-006 · M6-F03.
- Issue: [#89](https://github.com/RodReis/rrb-jarvisOS/issues/89).
- Status: **entregue** (2026-08-29) — implementada na M6-F03; **aprovada-pi** (2026-08-29) — dono da GitHub App, emenda ao Vault e escopo de UI resolvidos pelo PI nesta data.
- Depende de: M6-F01, M6-F02 e Vault do MVP-005.

## Objetivo

Autenticar o aplicativo desktop por GitHub App com OAuth Device Flow e manter user access/refresh tokens no Vault, sem private key, client secret ou dependência de `gh` em runtime.

## Fluxo

0. Resolver o `client_id`: o **embutido no app** (GitHub App do projeto) ou o **override do usuário** em Settings, quando preenchido.
1. Solicitar device/user code.
2. Mostrar URL, código e expiração ao usuário.
3. Fazer polling respeitando intervalo, `slow_down`, cancelamento e expiração.
4. Guardar tokens por `CredentialRef` no Vault.
5. Renovar antes do uso quando aplicável.
6. Confirmar usuário, instalação e permissões efetivas.

## Permissões por capacidade

- Metadata: leitura.
- Administration: escrita para criação/configuração de repositório.
- Contents e Workflows: escrita quando o projeto publicar conteúdo/CI.
- Issues e Pull requests: escrita.
- Checks e Actions: leitura.

A permissão efetiva é limitada simultaneamente pelo usuário, pela organização, pela instalação e pela GitHub App.

## Critérios de aceite

1. Nenhum segredo de servidor é distribuído no desktop.
2. Token e refresh token nunca chegam ao renderer.
3. Polling termina em sucesso, cancelamento, expiração ou erro normalizado.
4. Refresh preserva a referência e substitui o material secreto atomicamente.
5. Instalação/organização insuficiente gera `BLOCKED_EXTERNAL` com ação concreta.
6. Logout revoga ou remove a credencial conforme capacidade disponível e limpa o estado local.
7. `client_id` embutido funciona sem configuração; o override em Settings, quando preenchido, tem precedência. Nenhum dos dois é segredo, e nenhum private key ou client secret é distribuído.
8. **Vault estruturado:** o `CredentialRef` guarda access token, refresh token e `expires_at` como um payload cifrado único; `expires_at` é metadado consultável **sem decifrar**. Renovação substitui o material secreto **atomicamente** — falha de refresh não deixa a credencial em estado meio-escrito.
9. **UI mínima:** a tela mostra URL, código de usuário, expiração e progresso do polling; permite cancelar; e informa estado do conector (`present`/`missing`/expirado) sem exibir token.

## Testes e evidência

Contract fixtures do Device Flow, `authorization_pending`, `slow_down`, expiração e refresh; inspeção de logs; smoke real de autenticação. Relatório `SPEC-Conectores-03`; nenhum token é anexado.

## Referências técnicas verificadas

- [GitHub App Device Flow para CLI/desktop](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app)
- [Refresh de user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [Permissões exigidas por endpoints REST](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Dono da GitHub App:** **App registrada na conta do projeto, `client_id` embutido no desktop, com override opcional em Settings.** O `client_id` de uma App não é segredo (é público por design no Device Flow); o embutido dá zero atrito no primeiro uso, e o override atende quem preferir a própria App. Nenhum private key ou client secret vai para o desktop. — decidido.
2. **Emenda ao Vault (SPEC-Providers-01):** o suporte a **payload cifrado estruturado** (access + refresh + `expires_at`), a `expires_at` como **metadado não secreto** e à **rotação atômica** é **escopo desta fatia**, não uma fatia nova do MVP-005. A SPEC-Providers-01 declara rotação como "futuro" e guarda um valor único; a emenda fica registrada lá apontando para cá, e a M5-F01 (#77) não é reaberta. — decidido.
3. **UI:** **mínima, dentro desta fatia** — mesmo padrão da "UI mínima de aprovação" do MVP-004. Não existe fatia dedicada de UI de Conectores no MVP-006. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Credencial GitHub escopada por `user_id` + `workspace_id`** (espelha o `CredentialRef`): no NOA ela simplesmente aparece `missing`, sem bloqueio nem erro — o JARVIS OS é quem usa GitHub.
- **App não instalada na conta/organização → `BLOCKED_EXTERNAL`** cuja ação concreta é a **URL de instalação**, não uma mensagem genérica.
- **PAT nunca em runtime.** O smoke real usa token via `source: env` (SPEC-Providers-01), apenas em execução local ou CI, jamais commitado nem gravado no vault.

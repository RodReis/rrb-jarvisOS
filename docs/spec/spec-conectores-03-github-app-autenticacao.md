# SPEC-Conectores-03 — GitHub App e autenticação

- MVP/Fatia: MVP-006 · M6-F03.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M6-F01, M6-F02 e Vault do MVP-005.

## Objetivo

Autenticar o aplicativo desktop por GitHub App com OAuth Device Flow e manter user access/refresh tokens no Vault, sem private key, client secret ou dependência de `gh` em runtime.

## Fluxo

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

## Testes e evidência

Contract fixtures do Device Flow, `authorization_pending`, `slow_down`, expiração e refresh; inspeção de logs; smoke real de autenticação. Relatório `SPEC-Conectores-03`; nenhum token é anexado.


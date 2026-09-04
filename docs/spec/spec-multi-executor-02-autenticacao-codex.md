# SPEC-Multi-Executor-02 — Autenticação e perfil isolado do Codex

- MVP: `docs/mvp/mvp-010-multi-executor.md` (Fatia 02).
- Issue: [#117](https://github.com/RodReis/rrb-jarvisOS/issues/117); épico [#115](https://github.com/RodReis/rrb-jarvisOS/issues/115).
- Status: **aprovada-pi** (2026-08-29); **emendada pelo PI em 2026-09-04** (dependência e posição na fila — ver § Emenda).
- Depende de: **M10-F01 apenas para o mount no container** (critério 2). A parte de host não depende da F01.

## Objetivo

Disponibilizar uma identidade Codex exclusiva da pipeline, autenticada pelo PI diretamente no CLI e montada somente no container do run.

## Dentro

- `CODEX_HOME` dedicado, fora do perfil pessoal padrão e fora do repositório.
- Jornada de login/logout/reautenticação acionada pelo PI, sem captura de senha/token pelo app.
- Referência opaca ao perfil; mount somente leitura quando o CLI permitir e escrita mínima quando necessária à sessão.
- Health com `ready`, `auth_required`, `quota_limited`, `quota_unknown`, `offline` e diagnóstico sanitizado.
- Modos Codex `subscription_limited`, `subscription_credits` e `api`, sem transição silenciosa.
- Créditos somente após habilitação explícita e teto próprio do projeto.
- Redaction e varredura para impedir persistência em imagem, worktree, log e evidência.

## Fora

- Raspar telas de cobrança ou inferir saldo/reset por imagem.
- Comprar créditos, elevar plano ou criar chave de API.
- Compartilhar `CODEX_HOME` pessoal com a pipeline.
- Autenticação GitHub, Vault, Context7 ou segredo do projeto.

## Regras

1. Promoções e limites exibidos pela UI do fornecedor não são invariantes do sistema.
2. Sem telemetria oficial legível, quota é `quota_unknown`; não é tratada como ilimitada.
3. Rate limit de assinatura não autoriza créditos nem API.
4. Alterar modo de cobrança cria nova decisão auditada antes do próximo run.
5. Revogação do perfil impede novas execuções e não apaga evidências anteriores.

## Critérios de aceite

1. O PI autentica o perfil sem o app receber segredo em formulário, IPC ou log.
2. Container sem mount não acessa a sessão; container autorizado acessa somente o perfil indicado.
3. Scanner não encontra token/cookie/credencial em worktree, imagem, log ou artefatos.
4. `subscription_credits` desabilitado nunca é selecionado após quota de assinatura.
5. Teto de créditos excedido bloqueia antes da execução monetária.
6. Estados de health e quota aparecem por contrato tipado e sobrevivem a reinício.

## Testes e evidência

- integração com perfil fake e diretório temporário;
- testes de redaction e isolamento de mounts;
- smoke real explícito, limitado e sem registrar o segredo;
- evidência de crédito desabilitado e quota desconhecida.

## Emenda do PI (2026-09-04)

O MVP-026 (`docs/mvp/mvp-026-fases-modelos-e-console.md`) faz do Codex um provider do ponto único no **host** (M26-F06), e precisa desta fatia antes: `CODEX_HOME` dedicado, login/logout acionado pelo PI, health, modos `subscription_limited`/`subscription_credits`/`api` sem transição silenciosa, redaction. Nada disso depende do runtime de executores em container (M10-F01). Decisão do PI:

1. A dependência da M10-F01 passa a valer **só para o mount no container** (critério 2). Os demais critérios (1, 3–6) são entregues sem a F01.
2. Esta fatia **sobe na fila**: imediatamente antes da M26-F06, à frente das outras fatias do MVP-010. Quando o MVP-010 chegar, o critério 2 é fechado sobre o mesmo perfil — sem segundo dono do `CODEX_HOME`.
3. A rota de assinatura do Codex obedece à mesma regra da assinatura do Claude (decisão 4 do MVP-025 e decisão 3 de 2026-09-04): nenhuma cai na outra nem em API por conta própria; `api` só com opt-in por projeto.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; emenda aprovada em 2026-09-04.

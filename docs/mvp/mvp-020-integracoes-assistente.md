# MVP-020 — Integrações externas do assistente: Gmail, Agenda e Spotify

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Nenhuma fatia tem SPEC** — nascimento lazy.
- GitHub: épico [#196](https://github.com/RodReis/rrb-jarvisOS/issues/196).
- Fila: depois do MVP-019.
- Depende de: MVP-017, MVP-019 e MVP-006 (runtime de conectores, entregue).
- Resultado: compromissos no briefing, e-mail importante anunciado, música no Boas-Vindas — tudo por conectores do runtime existente.

## Tese

Agenda, Gmail e Spotify entram no fluxo do assistente **como `ConnectorAdapter` do runtime do MVP-006** — ledger de créditos, Vault OAuth com payload estruturado e rotação atômica, health — nunca como caminho paralelo. Home Assistant foi removido do escopo pelo PI (2026-08-30): o Spotify é conector direto.

## Fatias previstas

| Índice | Fatia | SPEC prevista |
|---|---|---|
| M20-F01 | Conector Agenda (Google Calendar) no briefing | `spec-assistente-01-conector-agenda.md` |
| M20-F02 | Conector Gmail (leitura e classificação de e-mail importante) | `spec-assistente-02-conector-gmail.md` |
| M20-F03 | Conector Spotify (música no Modo Boas-Vindas) | `spec-assistente-03-conector-spotify.md` |

Ordem: F01 → F02 → F03.

## Invariantes

- Todo serviço externo é conector do runtime do MVP-006; tokens no Vault com `expires_at` e rotação atômica.
- Classificação de "e-mail importante" passa pelo ponto único de IA (budget/auditoria do MVP-005).
- Falha de conector degrada o briefing (pula a seção), nunca derruba o Command Center.

## Done do épico

- Compromissos do dia entram no briefing matinal falado.
- E-mail classificado como importante gera anúncio + notificação (fluxo do MVP-019).
- Modo Boas-Vindas toca a música/playlist configurada no Spotify.

# ADR-004: Auditoria à prova de adulteração (hash-chain HMAC + trigger de storage)

- Status: aceito.
- Data: 21 de julho de 2026.
- Decisor: PI (delegou a escolha técnica ao Cowork, com pesquisa das práticas correntes).
- Relacionado: ADR-001 (local-first; auditoria é papel do cloud como espelho); SPEC-Fundacao-04 (onde entra); SPEC-Fundacao-03 (`safeStorage`/DPAPI, reusado para a chave HMAC); ADR-003 (mesma família "evidência, nunca narrada").

## Problema

O `AuditEvent` é a espinha de evidência do produto — o registro de que login/logout/troca de workspace de fato ocorreram. A SPEC-04 garantia a imutabilidade apenas "não expondo API de update/delete". Isso é fraco: qualquer código (ou pessoa) com acesso ao arquivo SQLite ainda consegue alterar ou apagar uma linha gravada, sem deixar rastro. Um registro de evidência que pode ser silenciosamente reescrito não é evidência. Precisamos da garantia de integridade que a prática atual de segurança recomenda, proporcional a um app **local-first single-user**.

## Decisão

**Defesa em profundidade, três camadas.** Nenhuma sozinha basta; juntas dão prevenção + detecção + verificação.

1. **Prevenir — na camada de storage.** Um **trigger SQLite** com `RAISE(ABORT, ...)` bloqueia `UPDATE` e `DELETE` na tabela `audit_event`; a via de escrita só faz `INSERT`. O repositório de auditoria **não expõe** método de alteração/remoção. Triggers pequenos e sem ramificação (fáceis de testar e de auditar).

2. **Detectar — hash-chain criptográfico por usuário.** Cada evento carrega:
   - `seq` — inteiro monotônico por `user_id` (detecta remoção/reordenação);
   - `prev_hash` — o `hash` do evento anterior do mesmo usuário (genesis usa um valor fixo);
   - `hash` = **HMAC-SHA-256** sobre a serialização canônica do conteúdo (`user_id`, `workspace_id?`, `type`, `payload`, `created_at`, `seq`) concatenada com `prev_hash`.

   A chave HMAC é **selada no `safeStorage`/DPAPI** (mesmo mecanismo da SPEC-03). Usar HMAC (chaveado), não SHA-256 puro, é o que impede um atacante de **recomputar toda a cadeia** após editar uma linha — sem a chave, a cadeia forjada não fecha.

3. **Verificar — re-caminhada independente.** `verifyChain(user_id)` percorre os eventos em ordem de `seq`, recomputa cada `hash` e confere `prev_hash`, reportando a **primeira quebra**. É caminho de teste (um AuditEvent adulterado à força no DB ⇒ `verifyChain` acusa) e fica disponível para diagnóstico.

## Escopo e limite honesto (o que isto NÃO é)

- É **tamper-evident**, não **tamper-proof**. Num host single-user, um atacante com o **mesmo usuário do SO** pode desbloquear a chave via DPAPI e recomputar a cadeia. A garantia forte contra o atacante local exige uma **âncora externa** (append incremental a um serviço/notário que ele não controla) — adiada para a fase de **sync** (Corte 3+), onde os dados sensíveis já vão **E2EE/AES-256** (decisão de 2026-07-21 no `DECISIONS.md`). Até lá, a cadeia protege contra adulteração acidental, bug de aplicação e a maioria das adulterações locais, e **torna detectável** o resto.
- **Sem Merkle tree, sem anchoring, sem selagem periódica** agora — são para escala/multi-parte, overkill para um log local single-user. O hash-chain HMAC + trigger é o ponto de equilíbrio.

## Consequências

- O padrão de auditoria forte fica estabelecido **cedo** (é a meta declarada da SPEC-04), não retrofitado depois.
- Reusa o `safeStorage`/DPAPI da SPEC-03 — nenhuma infra de segredo nova.
- Custo baixo: um trigger, um HMAC por inserção, uma função de verificação. `verifyChain` vira asserção de teste (categoria Regras/Banco).
- Espelha, no dado, a mesma filosofia que o ADR-003 aplica ao CI: integridade **verificável por recomputação independente**, não afirmada.
- Quando o sync entrar, a âncora externa se soma a estas camadas (não as substitui).

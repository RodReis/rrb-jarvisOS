# SPEC-Escuta-04 — Cronograma de atividades configurável

- MVP/Fatia: MVP-018 · M18-F04 — fecha o MVP-018.
- Issue: a criar quando esta SPEC chegar à `main`; épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Status: **aprovada-pi** (2026-09-10) — quatro perguntas resolvidas pelo PI nesta data, nenhuma em aberto.
- Fila: **não altera `next`.** A construção corrente é a M10-F01 ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)).
- Depende de: **M18-F03** (evento `boas-vindas`, saudação pela persona, reprodução de mídia local, as quatro guardas) e **M18-F01** (kill switch). Também MVP-002 · M2-F02 (**Policy Engine**, `evaluate(action, context) → Decision` com taxonomia em seed) e MVP-001 (`AuditEvent`/hash-chain).
- Origem: pedido do PI em 2026-09-10 — "vamos montar um cronograma de atividades, configurável". Separado da F03 na mesma data, por ser escopo novo.

## Objetivo

A F03 faz **uma** coisa na chegada, na ordem que a SPEC fixou. Esta fatia troca isso por uma **sequência que o PI monta**: quais atividades, em que ordem, disparadas por qual gatilho. É a primeira vez que o app executa uma sequência **que ninguém está olhando** — e por isso o centro desta SPEC não é o editor, é **onde a autorização acontece**.

## A decisão que organiza a fatia

O Policy Engine classifica ação em `baixo | médio | alto | bloqueado`, e `requires-approval` pressupõe alguém para aprovar. Um cronograma existe justamente para rodar **sem** esse alguém. As duas coisas não cabem no mesmo instante, então o PI moveu a autorização de lugar:

**A aprovação acontece ao configurar, não ao executar.** O PI monta a sequência, o Policy Engine classifica cada atividade **naquele momento**, e **atividade acima do tier permitido não pode nem ser salva**. O que é salvo, roda sozinho. O ato sensível deixa de ser "executar" e passa a ser **"mudar a sequência"** — que é auditado, revalidado e reversível.

Isso só é seguro porque o catálogo desta fatia é deliberadamente pequeno (§ Catálogo). A guarda do critério 4 é o que sustenta a decisão quando o catálogo crescer.

## Escopo

### Dentro

- **Sequência como dado versionado**, não código: lista ordenada de atividades, com gatilho, editável em Settings. Trocar a ordem é editar dado — mesma postura da taxonomia do Policy Engine, que também é seed.
- **Dois gatilhos:**
  - **Evento publicado pelo app** — hoje só o `boas-vindas` da F03; outros se inscrevem depois sem tocar nesta fatia.
  - **Horário** — recorrência declarada pelo PI ("toda terça às 8h").
- **Catálogo fechado de atividades, duas:** **falar** (persona no ponto único, com queda para frase fixa, como na F03) e **tocar mídia local** (arquivo ou pasta, no dispositivo de saída da M17-F05). Nada mais entra nesta fatia. **Não** há abrir app, abrir URL, nem comando de sistema — cada um desses é fatia própria, com prova própria.
- **Validação de política no salvamento:** ao salvar, cada atividade passa pelo `evaluate`; **`outcome` diferente de `allow` recusa o salvamento**, nomeando a atividade e o motivo. Fail-closed continua valendo: atividade não reconhecida pela taxonomia é `bloqueado` e não entra.
- **Mudar a sequência é ato sensível:** `AuditEvent` antes e depois, com a decisão de política de cada atividade registrada.
- **Execução resiliente:** atividade que falha ou é barrada **não aborta a sequência**. As demais seguem, e o resultado vira um **resumo do que rodou e do que não rodou**, no histórico do Command Center, com `AuditEvent` por atividade.
- **Herda as guardas da F03**, sem duplicá-las: janela de horário, kill switch da escuta, silêncio se houver áudio tocando, teto por período. Uma sequência que fala ou toca áudio obedece às mesmas regras da saudação — um lugar só para "não me incomode agora".
- **Serialização:** duas sequências que disparam no mesmo instante executam **em ordem, nunca sobrepostas**. Duas vozes ao mesmo tempo é defeito.
- **Tudo desligável**, por sequência e no conjunto.

### Fora

- **Ampliar o catálogo** — abrir app, abrir URL, comandos pela allowlist do MVP-004: cada um é fatia própria. Quando a primeira delas chegar, é ela que revisita o modelo de aprovação desta SPEC, e não o contrário.
- **Conectores** (Spotify e afins) — MVP-020, que se inscreve no evento.
- **Briefing** (agenda, e-mail) — MVP-019.
- **Condições complexas** (se/então, dependência entre atividades, variáveis) — a sequência aqui é linear.
- **Executar ação por voz** — o invariante do MVP-017 continua de pé. Nenhum gatilho desta fatia lê intenção de fala.
- **Edição de política em runtime** — segue fora, como na SPEC-Execucao-02.

## Critérios de aceite

1. **Sequência é dado, e a ordem é respeitada:** salvar, reordenar e executar produzem a ordem declarada. Teste com sequência de várias atividades.
2. **Gatilho por evento:** publicar `boas-vindas` executa a sequência inscrita nele. **Contrafactual:** sequência inscrita em outro evento não executa.
3. **Gatilho por horário:** a recorrência declarada dispara na hora certa (relógio injetado no teste, nunca `sleep`), e não dispara fora dela.
4. **A política barra no salvamento.** Uma atividade com `outcome` diferente de `allow` **não pode ser salva**; a recusa nomeia a atividade e o motivo. **Contrafactual obrigatório:** semear na taxonomia uma atividade de tier acima do permitido e tentar salvá-la — se entrar na sequência, reprova. *Este é o critério que sustenta a decisão do PI de aprovar na configuração; sem ele, "roda sozinho" perde a garantia.*
5. **Fail-closed preservado:** atividade fora da taxonomia é classificada `bloqueado` e recusada no salvamento.
6. **Mudar a sequência é auditado**, com a decisão de política de cada atividade, e `verifyAuditChain` → `ok`.
7. **Falha não aborta:** com uma atividade falhando no meio, as seguintes executam e o resumo mostra o que rodou e o que não rodou. **Contrafactual:** sequência abortada na primeira falha reprova.
8. **Guardas herdadas, não reimplementadas:** com o kill switch desligado, com áudio do sistema tocando, ou fora da janela de horário, a sequência não fala nem toca. O teste afirma que a decisão veio do mesmo ponto usado pela F03. **Contrafactual:** segunda implementação da guarda dentro desta fatia reprova.
9. **Serialização:** dois gatilhos simultâneos produzem execução em ordem, nunca simultânea. Nenhuma sobreposição de voz.
10. **Mídia toca no dispositivo escolhido** (preferência da M17-F05), nunca no padrão do SO.
11. **Nada de ação por fala:** guarda de fonte prova que todo disparo veio de evento ou relógio. **Contrafactual:** abrir este caminho a partir de um turno de voz reprova.
12. `npm run lint`, `npm run typecheck` e `npm test` verdes; prova visual do editor de sequência nos dois temas e com movimento reduzido; evidência em `reports/TESTS.md` por SPEC/issue; **verificação real do PI**: montar uma sequência, chegar e ser recebido por ela.

## Perguntas resolvidas pelo PI (2026-09-10)

1. **Gatilhos:** evento publicado pelo app **e** horário. — decidido.
2. **Catálogo:** apenas **falar** e **tocar mídia local** — o que a F03 já faz, agora em sequência configurável. — decidido.
3. **Aprovação:** **ao configurar; depois roda sozinho.** Atividade acima do tier permitido não pode ser salva. — decidido.
4. **Falha no meio:** **continua e reporta no fim.** — decidido.

## Decisões cravadas pelo Cowork (coerentes com as anteriores; o PI pode vetar)

- **Com a sessão bloqueada, sequência disparada por horário não executa atividade de áudio** — registra como não executada no resumo. Tocar música numa sala vazia é a mesma família do que as guardas da F03 existem para evitar. A sequência disparada por `boas-vindas` não é afetada: naquele instante o PI acabou de destravar.
- **O resumo espera o PI.** Se a sequência rodou com ele ausente, o resumo fica no histórico do Command Center até ser visto — não é falado por cima da chegada seguinte.
- **A sequência é linear e sem condições** nesta fatia; expressividade é evolução, não requisito de entrada.
- **Sequência desativada não conta para o teto por período** — desligar é desligar, não gastar cota.

## Riscos e limites declarados

- **O modelo de aprovação desta SPEC é seguro por causa do catálogo, não por si.** Com duas atividades locais e sem efeito externo, aprovar na configuração é proporcional. **A primeira fatia que acrescentar uma atividade com efeito real (abrir app, URL, comando) precisa reabrir esta decisão** — e o critério 4 é o que vai avisar, recusando o salvamento em vez de deixar passar calado.
- **Gatilho por horário roda com o PI longe da máquina.** As guardas herdadas e a regra de sessão bloqueada cobrem o incômodo previsível; o imprevisível só aparece no uso.
- **A verificação real é montar e ser recebido.** Sequência que passa na suíte e constrange na chegada não está pronta.

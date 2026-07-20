# ADR-001: Arquitetura Local-First com Sync Cloud

- Status: aceito.
- Data: 18 de julho de 2026.
- Contexto de time: solo + IA como par.
- Substitui/corrige: decisões #3, #4 e #10 do `prd-design-system-plataforma.md`.

## Problema

Os documentos de planejamento descrevem dois produtos incompatíveis.

`requisitos-agent-os.md` e `plano-implementacao-agent-os.md` descrevem um agent OS
**local-first**: cofre de memória híbrido local para operação/offline, Ollama local
como primeira opção, tray/background services, auto-start no boot, voz offline como
evolução, roteamento local sem internet.

`prd-design-system-plataforma.md` decide o oposto:

- #3: "Plataforma será um SaaS multi-tenant compartilhado".
- #4: "Supabase Cloud será a fonte de verdade dos dados sincronizados".
- #10: "Agentes e automações funcionarão apenas enquanto a Plataforma estiver aberta".

A decisão #10 sozinha invalida RF-006 (Power Guard), RF-007 (crons), RF-020
(Autonomous Remote) e RF-021 (auto-start), além dos workflows Daily Summary e
Finance Alert. A #4 contradiz "memória híbrida local para offline". Sem resolver isso,
qualquer spec nova nasce sobre uma base contraditória.

## Decisão

O produto é um **desktop app local-first com sincronização cloud**.

1. **Fonte de verdade operacional é local.** Execução, memória de trabalho e estado
   operam no dispositivo. Funciona offline para os fluxos essenciais.
2. **Supabase Cloud é espelho de sync, auth e auditoria** — não fonte de verdade.
   O armazenamento local é reconstruível a partir do cloud, mas o cloud não é
   pré-requisito para operar.
3. **Multiusuário é baseado em contas, não multi-tenant server-side.** Cada usuário
   autentica (Google via Supabase Auth), tem dados locais isolados por `user_id` e
   sincroniza seu próprio recorte. Não há execução de agentes no servidor.
4. **Agentes rodam enquanto a Plataforma estiver ativa, inclusive minimizada em tray.**
   Não sobrevivem a logout nem reboot. Crons e workflows funcionam nesse modo.
   Execução autônoma com app totalmente fechado / máquina desligada fica fora do MVP.

## Correções aos documentos existentes

| Doc / item | Antes | Depois |
|---|---|---|
| PRD #3 | SaaS multi-tenant compartilhado | Desktop local-first, multiusuário por conta; sync/auth via cloud |
| PRD #4 | Supabase Cloud é fonte de verdade | Local é fonte de verdade operacional; Cloud é espelho de sync/auditoria |
| PRD #6 | Local é cache/outbox, nunca única fonte | Local é fonte operacional e reconstruível a partir do sync |
| PRD #10 | Agentes só com app aberto | Agentes rodam com app ativo, inclusive em tray; não sobrevivem a logout/reboot |
| RF-020 Autonomous Remote | Modo remoto/autônomo | Fora do MVP (depende de execução com app fechado) |

## Consequências

Positivas:

- Offline real para os fluxos essenciais, como os requisitos pediam.
- Sem infraestrutura de servidor de execução; menor superfície para solo + IA.
- Auth e sync ficam concentrados numa única camada (Supabase Auth + tabelas de sync).

Custos e limites aceitos:

- Sem execução verdadeiramente 24/7. Crons dependem do app rodando (em tray).
- BYOK continua válido, mas "BudgetPolicy impede gasto" vira **estimativa e alerta**,
  não bloqueio garantido — o provider cobra o usuário direto. Ver questão aberta 1.
- Primeiro login exige internet (OAuth Google); sessão é cacheada para uso offline
  posterior. Ver questão aberta 2.

## Questões abertas

1. BudgetPolicy com BYOK: aceitar como estimativa + alerta, ou proxyar chamadas para
   bloqueio real? (Proxy adiciona infra e latência; contradiz "chave só no cofre do SO".)
2. Duração e renovação da sessão offline: quanto tempo o app opera sem reautenticar?
3. Sync de conflitos: estratégia quando o mesmo registro muda offline em dois
   dispositivos (last-write-wins vs. merge por entidade).

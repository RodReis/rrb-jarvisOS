# SPEC-Scheduler-01 — Pool global e fila justa

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 01).
- Status: **revisão-pi** — implementação não autorizada.
- Depende de: MVP-011 concluído.

## Objetivo

Substituir o slot global único da V1 por um pool durável de capacidade, com dois executores por padrão e fila justa entre projetos.

## Dentro

- Limites configuráveis global, por projeto, executor e classe de recurso.
- Padrão V2: dois slots globais e no máximo dois runs por projeto.
- Fila persistida com elegibilidade, prioridade aprovada, idade e motivo de espera.
- Alternância entre projetos sem starvation, preservando precedência explícita do roadmap.
- Lease com owner, fencing token, TTL/heartbeat e recuperação.
- Métricas de ocupação, espera e decisões do scheduler.

## Fora

- Decidir independência entre fatias; F02.
- Mais de duas execuções globais como padrão.
- Alterar prioridade de produto automaticamente.
- Contar workers somente-leitura como novos writers; usam limites próprios do Squad.

## Regras

1. Capacidade livre não torna uma fatia elegível sem todos os gates.
2. Configuração reduzida não mata run ativo; impede novas aquisições até ficar abaixo do teto.
3. Lease expirado exige reconciliação antes de redispatch.
4. Mesmo snapshot de fila produz decisão determinística, salvo tempo/health registrados como entrada.

## Critérios de aceite

1. Nunca há mais writers ativos que o limite global/projeto.
2. Dois projetos continuamente elegíveis avançam sem starvation.
3. Reinício preserva posição, lease e motivo de espera sem duplicar run.
4. Fencing token impede dono antigo de confirmar progresso após perda do lease.
5. UI/API explica qual limite ou gate mantém cada item na fila.

## Testes e evidência

- property tests de capacidade/fairness;
- relógio controlado para TTL/heartbeat;
- crash antes/depois da aquisição;
- métricas e auditoria das decisões.

## Perguntas abertas ao PI

Nenhuma. Aguarda aprovação desta revisão exata.

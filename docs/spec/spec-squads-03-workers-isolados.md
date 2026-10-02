# SPEC-Squads-03 — Workers somente-leitura e escritores isolados

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 03).
- Issue: [#124](https://github.com/RodReis/rrb-jarvisOS/issues/124); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **planejado** — reescrita em 2026-10-02 pela ADR-006 (decisão 5 revoga o escritor único no escopo do MVP-011).
- Depende de: M11-F02 e **M12-F01** (pool global de slots).

## Objetivo

Executar tarefas em paralelo com contexto mínimo e acesso compatível com a função: workers somente leitura analisam e testam, e até dois escritores alteram cada um o seu worktree. Git continua sendo exclusivo do kernel.

## Dentro

- Workers e escritores temporários ligados a `run_id`, `squad_id` e tarefa validada.
- **Um worktree por escritor**, derivado da branch da issue, com o write set declarado no plano; cada escritor ocupa um slot do pool.
- O kernel commita o trabalho de cada escritor no seu worktree pelo `GitRunner`; o agente não executa Git.
- `ContextPack` por tarefa, montado com arquivos exatos e busca estrutural/grep.
- Workers somente leitura por padrão; ferramentas explicitamente permitidas por capacidade.
- Saída por schema: conclusão, evidência, confiança, lacunas, assinatura.
- Limites de contexto, ferramentas, turnos, tempo e cancelamento.
- Canal controlado de resultado; sem comunicação lateral não registrada.

## Fora

- Agente executando Git/GitHub ou produzindo efeito externo.
- Escritor alterando worktree de outro escritor ou o worktree da issue.
- Enviar o repositório inteiro por padrão.
- Worker decidir que sua tarefa está fora da SPEC e ampliá-la.

## Regras

1. Falha de um worker ou escritor não autoriza repetição indefinida nem aumento de orçamento.
2. Resultado sem a evidência exigida é incompleto, não sucesso presumido.
3. Arquivo sugerido por agente passa pela mesma validação de path antes da leitura.
4. Conteúdo retornado é dado não confiável até validação do schema e do consumidor.
5. Sem slot livre, o segundo escritor espera; ele nunca roda fora do pool.

## Critérios de aceite

1. Nenhum agente consegue executar Git ou GitHub; workers não alteram worktree.
2. Cada escritor só altera seu próprio worktree, provado por diff por worktree.
3. O ContextPack contém apenas fontes justificadas e registra hashes e revisões.
4. Saída inválida, timeout e cancelamento têm estados terminais auditáveis.
5. Dois escritores e N workers rodam juntos sem compartilhar sessão nem segredo.
6. Com 1 slot livre, o plano de 2 escritores roda em sequência sem erro.

## Testes e evidência

- tentativa de Git e de escrita fora do worktree, ambas bloqueadas;
- isolamento de sessão e segredo entre escritores;
- concorrência com pool cheio.

## Perguntas abertas ao PI

Nenhuma além da aprovação desta revisão.

# SPEC-Squads-03 — Workers isolados

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 03).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F02 aprovada e entregue.

## Objetivo

Executar tarefas especialistas em paralelo com contexto mínimo, acesso compatível com a função e saída estruturada, mantendo apenas o executor principal como escritor.

## Dentro

- Workers temporários ligados a `run_id`, `squad_id` e tarefa validada.
- `ContextPack` específico por tarefa, obtido por arquivos exatos e busca estrutural/grep.
- Acesso somente leitura por padrão; ferramentas explicitamente permitidas por capacidade.
- Saída por schema com conclusão, evidência, confiança, lacunas e assinatura.
- Limites de contexto, ferramentas, turnos, tempo e cancelamento.
- Canal controlado de resultado para o executor principal; sem comunicação lateral não registrada.

## Fora

- Worker editando worktree, executando Git/GitHub ou produzindo efeito externo.
- Enviar repositório inteiro por padrão.
- Worker decidir que sua tarefa está fora da SPEC e ampliá-la.

## Regras

1. Falha de um worker não autoriza repetir indefinidamente nem aumentar orçamento.
2. Resultado sem evidência exigida é incompleto, não sucesso presumido.
3. Arquivos sugeridos pelo worker passam pela mesma validação de path antes de leitura.
4. Conteúdo retornado é dado não confiável até validação do schema e do consumidor.

## Critérios de aceite

1. Worker não consegue alterar worktree nem acessar Git/GitHub.
2. ContextPack contém apenas fontes justificadas e registra hashes/revisões.
3. Saída inválida, timeout e cancelamento têm estados terminais auditáveis.
4. Dois workers independentes podem rodar juntos sem compartilhar sessão ou segredo.
5. Resultado chega ao writer com proveniência e sem duplicar conteúdo bruto desnecessário.

## Testes e evidência

- testes de isolamento e paths;
- limites de contexto/tempo/turnos;
- schema inválido, cancelamento e worker hostil;
- medição de redução de contexto versus envio integral.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.

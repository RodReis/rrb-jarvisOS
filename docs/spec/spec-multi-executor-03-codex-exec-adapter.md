# SPEC-Multi-Executor-03 — Codex Exec Adapter

- MVP: `docs/mvp/mvp-010-multi-executor.md` (Fatia 03).
- Status: **revisão-pi** — implementação não autorizada.
- Depende de: F02 aprovada e entregue.

## Objetivo

Implementar `CodexExecExecutorAdapter` sobre o CLI Codex, mantendo o contrato estável do runtime e o isolamento externo definido pela pipeline.

## Dentro

- Invocação do executável pinado, sem shell, com argumentos permitidos e cwd controlado.
- Execução não interativa por `codex exec`, saída JSONL e schema final obrigatório.
- Parser incremental tolerante a linhas parciais e eventos novos.
- Timeout, cancelamento, encerramento da árvore e classificação de exit codes.
- Sessão retomável somente quando suportada e reconciliada com run/attempt/worktree.
- Sandbox do Codex tratado como defesa adicional; container, paths e política externos continuam autoritativos.
- Mapeamento de uso/quota disponível para os eventos normalizados.

## Fora

- Git remoto, commit, push, PR ou merge pelo CLI.
- Mudança automática da SPEC, dos paths permitidos ou dos comandos de validação.
- Dependência de texto humano como resultado canônico.
- Fallback ou escolha do revisor; F04.

## Regras

1. Versão/capacidade incompatível falha antes de tocar o worktree.
2. Schema inválido é falha do executor, ainda que o processo retorne zero.
3. Retomada nunca associa sessão a outra revisão, worktree ou tentativa incompatível.
4. Evento de ferramenta não confirma efeito externo; o `EffectJournal` continua autoritativo.
5. Flags e nomes internos do CLI ficam encapsulados no adapter.

## Critérios de aceite

1. O adapter passa integralmente pelo contract test da F01.
2. Fixtures cobrem JSONL parcial, evento desconhecido, saída inválida, timeout, kill e retomada.
3. Processo não usa shell e rejeita argumento/cwd fora do request validado.
4. Falha após alteração retorna paths/evidência suficientes para preservar e diagnosticar o delta.
5. Nenhum segredo aparece em argv, stdout persistido ou resultado estruturado.
6. Teste de compatibilidade detecta versão do CLI sem assumir recurso inexistente.

## Testes e evidência

- parser e mapping por fixture;
- integração com executável fake;
- contract tests compartilhados;
- smoke real opt-in em container exclusivo.

## Perguntas abertas ao PI

Nenhuma. Aguarda aprovação desta revisão exata. Flags exatas serão confirmadas na documentação atual durante o plano técnico, sem alterar estes contratos.

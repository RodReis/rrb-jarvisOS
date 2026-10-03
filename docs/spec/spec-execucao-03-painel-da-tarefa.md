# SPEC-Execucao-03 — Painel da tarefa: output dos agentes ao vivo

- MVP: `docs/mvp/mvp-028-quadro-execucao-squads.md` (Fatia 03).
- Issue: [#378](https://github.com/RodReis/rrb-jarvisOS/issues/378); épico [#368](https://github.com/RodReis/rrb-jarvisOS/issues/368).
- Status: **aprovada-pi** (2026-10-02) — redigida a pedido do PI ("workspace = IDE + kanban; ao clicar na tarefa em execução vemos o output do trabalho dos agentes"), com a correção do PI de que o workspace é visualizador.
- Requisito: **RF-005.1** (abrir a tarefa para ver logs, artefatos e decisões).
- Ordem no MVP-028 (PI, 2026-10-02): **F01 → F03 → F02**.
- Depende de: M28-F01 (quadro e card); M26-F03 (`GenerationEvent`, `GenerationTrace`, `ConsoleDaGeracao`).

## Objetivo

Clicar num card do quadro e ver, ao vivo e só para leitura, o que cada agente daquela issue está fazendo: o texto que produz, as ferramentas que chama, o diff que já existe no worktree, os checks e a saída dos testes. A SPEC-Execucao-01 só previa um link para o console da geração, o que não atende a esse pedido.

## Dentro

- **Painel lateral da issue**, aberto pelo clique no card, sem sair do quadro. Ele funciona com o run em execução e com o run já encerrado; no encerrado, o painel reproduz o que foi gravado.
- **Abas do painel:**
  1. **Plano:** o `SquadPlan` aceito, com papel, camada de modelo, escritor dono e estado de cada tarefa.
  2. **Uma aba por tarefa/agente** (orquestrador, W1, W2, testador, revisor, integrador): output ao vivo com texto, chamadas de ferramenta com resumo e resultado, e uso de tokens. Reutiliza o `ConsoleDaGeracao` e o `GenerationTrace` da M26-F03, um trace por tarefa.
  3. **Diff:** o worktree da issue contra a base, por arquivo.
  4. **Arquivos:** a árvore do worktree e um **visualizador** de arquivo com destaque de sintaxe e busca, só para leitura.
  5. **Checks:** o detalhe da coluna PR/MERGE, com cada check, o estado, o tempo de espera e a última consulta.
  6. **Testes:** a saída da suíte que a tarefa de TESTE rodou, redigida.
- **Sinal de vida por aba:** "último evento às HH:MM (há X min)". Uma tarefa sem eventos mostra há quanto tempo está sem sinal e nunca mostra "processando" sem prazo.
- **Erros visíveis na aba e no card:** limite do provedor, orçamento de tentativas esgotado e falha do adapter aparecem com o código e a mensagem do evento `erro`.

## Fora

- **Edição de arquivo pelo PI.** O workspace é visualizador: o PI acompanha e decide, mas não escreve código (decisão do PI, 2026-10-02).
- Terminal interativo.
- Comando disparado do painel. Pausar, cancelar e aprovar continuam no card (M28-F01/F02).
- Persistir o resultado completo das ferramentas: segue a M26-F03, que guarda até 2 KB com o tamanho original.

## Regras

1. O painel só lê; o renderer recebe os eventos por IPC tipado (assinar e cancelar a assinatura por issue) e não executa comando.
2. Todo texto passa pelo redator do MVP-004 antes de chegar ao renderer, como no console da geração.
3. O estado da tarefa vem do ledger e do trace, nunca da ausência de evento.
4. Reabrir o app reconstrói o painel a partir dos traces gravados.
5. Fechar o painel cancela a assinatura e não afeta o run.

## Critérios de aceite

1. Clicar no card de uma issue em DEVELOPER abre o painel com uma aba por tarefa do plano, e a aba do escritor mostra texto e ferramentas chegando ao vivo.
2. A aba Arquivos abre qualquer arquivo do worktree com destaque de sintaxe e não oferece gravação. A aba Diff mostra a mudança do worktree contra a base, e a aba Checks mostra o check pendente da coluna PR/MERGE.
3. Uma tarefa sem evento mostra "sem sinal desde HH:MM", e uma tarefa com erro do provedor mostra o código do erro na aba e no card.
4. O run encerrado reabre no painel com a mesma sequência de eventos, a partir do banco.
5. Nenhum segredo chega ao renderer: o teste injeta um token num argumento de ferramenta e o painel mostra a versão redigida.

## Testes e evidência

- teste de projeção (trace → aba) por tipo de evento, incluindo `erro` e ausência de sinal;
- teste de tela do painel com abas e prova visual;
- teste de redação no caminho do painel;
- teste de reconstrução após reinício.

## Referência

A ideia de transcrição por subagente e painel de trabalho lateral vem do PI-Desktop (`vastsa/PI-Desktop`, LGPL-3.0), usado só como referência de UX. Nenhum código é copiado.

## Perguntas abertas ao PI

Nenhuma.

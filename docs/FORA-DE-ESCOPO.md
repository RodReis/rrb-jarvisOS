# FORA-DE-ESCOPO.md — registro das saídas

> **ARQUIVO GERADO. NÃO EDITAR À MÃO.**
> Esta é uma **view** de `docs/RASTREABILIDADE.md`, filtrada pelos estados `transferido`,
> `adiado` e `excluído`. Editar aqui é violação de processo: corrige-se na matriz e regenera.
> Enquanto o gerador não existir (card `[INFRA]` do verificador — `RASTREABILIDADE.md` §5), a
> regeneração é manual pelo Cowork e a matriz continua sendo a única fonte de verdade.

## O que este arquivo é, e o que não é

- **É** a leitura rápida do que saiu do MVP de origem: o que foi empurrado para frente, o que
  perdeu compromisso e o que saiu do produto.
- **Não é** a matriz — a matriz responde *para onde cada requisito foi*, esta view responde
  apenas *o que saiu*.
- **Não é** o backlog — o backlog é fila de execução (`docs/STATUS.md` + board); aqui não há
  ordem, nem prioridade, nem fila.
- **Não recebe** requisito `mantido` nem `absorvido`: nenhum dos dois saiu.
- **Não recebe** alternativa técnica proposta e não escolhida: isso é decisão, e mora no ADR
  ou na seção de decisões da SPEC — não é requisito removido.

## Transferidos — continuam comprometidos

Requisito `transferido` é obrigação com endereço: sai do MVP de origem e entra no MVP nomeado.
Aparecer nesta seção **não** afrouxa a entrega.

_(vazio — inventário ainda em classificação; ver `RASTREABILIDADE.md` §6)_

## Adiados — sem compromisso, com gatilho

Requisito `adiado` não tem compromisso de entrega, mas tem **gatilho** e **data de
reavaliação** obrigatórios. Data vencida sem nova decisão do PI é bloqueio de aprovação.

_(vazio — inventário ainda em classificação)_

## Excluídos — saíram do produto

Saída deliberada e assinada pelo PI. A linha e o ID permanecem na matriz para sempre: exclusão
registrada é diferente de requisito que sumiu.

_(vazio — inventário ainda em classificação)_

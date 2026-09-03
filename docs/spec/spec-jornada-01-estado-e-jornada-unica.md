# SPEC-Jornada-01 — Estado do projeto e jornada única

- MVP/Fatia: MVP-025 · M25-F01.
- Issue: [#238](https://github.com/RodReis/rrb-jarvisOS/issues/238); épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237).
- Status: **aprovada-pi** (2026-09-03) — perguntas abertas resolvidas pelo PI nesta data.
- Depende de: M8-F01–F06 (entregues).

## Objetivo

Dar ao projeto um **estado de jornada** persistido e uma **única superfície** que mostra a etapa atual e o próximo passo. Sem chamada de IA: esta fatia reorganiza o que o MVP-008 entregou para que as fatias seguintes tenham onde encaixar a geração.

## Estado do projeto

`Project.etapa` deixa de ser texto opaco e vira enum com transições explícitas:

```
prompt → refinamento → brief-aceito → prd → prd-aceito → design → arquitetura
       → pacote-aceito → roadmap → mvp-aceito → spec-aceita → construcao
```

- Transição só acontece por evento nomeado (prompt salvo, brief aceito, anexos completos…), nunca por edição direta.
- Aceite (`brief-aceito`, `prd-aceito`, `pacote-aceito`, `mvp-aceito`, `spec-aceita`) só avança com `Approval` do PI (SPEC-Planejamento-06, critério 4).
- Invalidação de gate (mudança semântica a montante) **regride** a etapa para a primeira não invalidada e registra o motivo.
- Estado é derivável: o serviço recalcula a etapa a partir de revisões e aprovações existentes e recusa etapa persistida incoerente com elas (fonte de verdade são os artefatos e os aceites, não a coluna).

## Superfície

- A tela **Projetos** lista os cards com **nome, etapa atual e um único CTA** ("Escrever o prompt", "Responder o refinamento", "Aceitar o brief", "Anexar design"…). Renomear e Remover continuam no card; **Planejar** e **Contexto do projeto** desaparecem como botões.
- Abrir um projeto mostra a **jornada como trilha** (etapas concluídas, atual e futuras) com o conteúdo da etapa atual em foco. Etapa concluída é consultável (documento, revisão, quem aceitou, quando); etapa futura é visível e desabilitada, com o que falta para chegar nela.
- O `ContextPack` (M8-F02) **sai da superfície**: o serviço monta o pacote a partir da etapa (tarefa = etapa; arquivos = artefatos da etapa anterior) e o manifesto fica consultável no histórico do projeto. Formulário "Tarefa ou SPEC / Arquivos do contexto" é removido.
- Os painéis existentes (pacote estrutural, anexos, roadmap, centro de aprovações) passam a ser **conteúdo de etapa**, renderizados só na etapa correspondente. O centro de aprovações vira o CTA de aceite da etapa.

## Migração

- Projeto existente sem `BRIEF.md` aceito → etapa `prompt`. Decisões gravadas na `decision` permanecem e a F02 as reaproveita quando a pergunta coincidir.
- Projeto com pacote/roadmap já gerados pelo fluxo antigo → também `prompt`: os artefatos compostos ficam no Git como revisões anteriores, mas não contam como etapa concluída, porque não têm brief nem origem de modelo.
- Nada é apagado. Migration adiciona a coluna/enum e o serviço deriva a etapa na primeira leitura.

## Critérios de aceite

1. Toda transição de etapa tem evento nomeado e `AuditEvent`; edição direta da coluna não existe na ponte IPC.
2. Etapa persistida incoerente com revisões/aprovações é recalculada e o desvio auditado.
3. A tela Projetos mostra exatamente um CTA por projeto, correspondente à etapa atual.
4. Nenhum painel de etapa futura aceita ação; o que falta é dito em texto.
5. `ContextPack` continua sendo montado e registrado em manifesto para cada geração futura, sem formulário na superfície.
6. `projeto1` (criado antes desta fatia) abre na etapa `prompt` com suas decisões preservadas.
7. Invalidação de gate regride a etapa e a tela mostra o motivo.

## Testes e evidência

Unitários da máquina de etapas (transições, recálculo, invalidação); Playwright da tela Projetos (um CTA, trilha, etapa futura desabilitada, migração de projeto antigo). Relatório `SPEC-Jornada-01`. **Gate visual antes de fechar:** screenshot da jornada apresentado ao PI — esta fatia existe porque a verificação visual nunca aconteceu no MVP-008.

## Perguntas resolvidas pelo PI (2026-09-03)

1. **Projeto aberto tem rota própria** (`Projetos/<slug>`): a lista de Projetos vira índice; a trilha de etapas e o conteúdo da etapa atual ocupam a tela. Descartado expandir dentro da lista — a trilha e o conteúdo da etapa precisam de espaço. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **A etapa é derivada, não declarada.** Uma coluna que só o código escreve viraria uma segunda fonte de verdade para o que as revisões e aprovações já dizem.
- **Botão "Planejar" morre.** A jornada é o planejamento; um botão separado recriaria a confusão de "o que faço primeiro".
- **`ContextPack` sem formulário** é a leitura literal da M8-F02: o pacote é pré-condição de geração, não tarefa do PI.

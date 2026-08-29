# SPEC-Planejamento-01 — Projeto, persistência e Git local

- MVP/Fatia: MVP-008 · M8-F01.
- Issue: [#94](https://github.com/RodReis/rrb-jarvisOS/issues/94).
- Status: **revisão documental; implementação não autorizada**.
- Dependências: MVP-005 e MVP-006 concluídos.

## Objetivo

Criar ou importar um projeto local, persistir seu planejamento e inicializar Git automaticamente sem publicar nada no GitHub.

## Fluxo

1. Validar nome, slug e diretório absoluto.
2. Detectar colisão e oferecer retomar, importar ou escolher outro nome.
3. Criar estrutura documental mínima.
4. Inicializar repositório e branch `main` quando ainda não houver Git.
5. Persistir `Project` e `PlanningSession` no SQLite.
6. Criar commit automático somente ao concluir um marco documental.

## Regras

- Respostas do wizard são autosalvas no SQLite; não geram commit individual.
- Repositório existente nunca é reinicializado ou limpo.
- Arquivos do usuário não são sobrescritos silenciosamente.
- Git local é fonte das revisões documentais; SQLite guarda estado de trabalho.
- Remote, issue, PR e push ficam fora desta fatia.

## Critérios de aceite

1. Projeto novo retoma depois de reinício sem perder identidade ou respostas.
2. Importação preserva conteúdo e histórico existentes.
3. Colisão não cria diretório parcial nem modifica o alvo.
4. Primeiro marco produz commit determinístico com somente os documentos esperados.
5. Falha de commit preserva dados no SQLite e oferece retomada.
6. Nenhum efeito remoto ocorre.

## Testes, evidência e custo

Integração em diretórios temporários para novo/importado/colisão/reinício/falha de commit. Relatório `SPEC-Planejamento-01`. Sem API externa e sem custo de modelo obrigatório.

# SPEC-Planejamento-01 — Projeto, persistência e Git local

- MVP/Fatia: MVP-008 · M8-F01.
- Issue: [#94](https://github.com/RodReis/rrb-jarvisOS/issues/94).
- Status: **aprovada-pi** (2026-08-29) — local do projeto, execução do Git e escopo da importação resolvidos pelo PI nesta data.
- Dependências: MVP-005 e MVP-006 concluídos.

## Objetivo

Criar ou importar um projeto local, persistir seu planejamento e inicializar Git automaticamente sem publicar nada no GitHub.

## Fluxo

1. Validar nome, slug e diretório. **Default: sob o diretório gerido pelo app** (`userData`); diretório externo só depois de opt-in explícito na allowlist.
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
- **Git é o `git` do sistema, executado pelo terminal controlado do MVP-004** (M4-F02): comando pinado na allowlist de comandos, sem shell, cwd na allowlist, com timeout/kill, classificado pelo Policy Engine e auditado. Não existe segundo caminho de escrita em disco fora do enforcement.
- **Ausência de `git` na máquina** é `BLOCKED_EXTERNAL` com ação concreta, nunca fallback silencioso para outra implementação.

## Critérios de aceite

1. Projeto novo retoma depois de reinício sem perder identidade ou respostas.
2. Importação preserva conteúdo e histórico existentes.
3. Colisão não cria diretório parcial nem modifica o alvo.
4. Primeiro marco produz commit determinístico com somente os documentos esperados.
5. Falha de commit preserva dados no SQLite e oferece retomada.
6. Nenhum efeito remoto ocorre.
7. **Projeto nasce sob `userData` sem tocar a allowlist.** Escolher diretório externo exige opt-in explícito já registrado; a criação do projeto **nunca** amplia a allowlist por conta própria. Teste dos dois caminhos.
8. **Toda operação de Git passa pelo terminal controlado** e gera `AuditEvent`; nenhuma escrita de repositório ocorre por caminho paralelo. Teste comprova que o caminho é único.
9. **Importar o próprio `rrb-jarvisOS`** preserva `docs/`, histórico e `STATUS.md`, e não sobrescreve nada — é o smoke da importação.

## Testes, evidência e custo

Integração em diretórios temporários para novo/importado/colisão/reinício/falha de commit. Relatório `SPEC-Planejamento-01`. Sem API externa e sem custo de modelo obrigatório.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Onde nasce o projeto:** **sob o diretório gerido pelo app** (`userData`) por padrão; diretório externo exige **opt-in explícito na allowlist**, coerente com a postura conservadora já decidida na SPEC-Execucao-03. Criar projeto **não** é caminho para ampliar permissão. **Consequência registrada:** enquanto a fatia de **UI da allowlist de diretórios** não existir (pendência aberta do MVP-004, ainda sem spec), só é possível criar projeto dentro do diretório do app. — decidido.
2. **Execução do Git:** **`git` do sistema pelo terminal controlado do MVP-004**, não biblioteca JS embarcada. Motivo: reusa o gate que já existe (Policy Engine + `AuditEvent` + timeout/kill) em vez de abrir um segundo caminho de escrita em disco que escaparia do enforcement do próprio MVP-004. **Consequência:** esta fatia passa a depender da **M4-F02** (#75) e exige `git` instalado e pinado na allowlist de comandos. — decidido.
3. **Escopo da importação:** o critério de aceite **inclui importar o próprio `rrb-jarvisOS`**. É a verificação mais forte disponível — o formato de `docs/` deste repositório é exatamente o que a pipeline gera; se a importação quebrar aqui, o formato está errado. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`Project` e `PlanningSession` escopados por `user_id` + `workspace_id`** (CONVENTION §2 e ARCHITECTURE: toda entidade carrega escopo). Projetos são do **JARVIS OS**; o NOA não os lista.
- **Layout documental do projeto gerado espelha este repositório** (`docs/` com `spec/`, `mvp/`, `adr/`), porque é o formato que a M8-F06 e o MVP-009 consomem.
- **Mensagem de commit documental em pt-BR**, determinística por marco (CLAUDE.md § Idioma), com a identidade de git já configurada na máquina.

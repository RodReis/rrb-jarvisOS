# SPEC-ExecucaoReal-03 — UI da allowlist de diretórios

- MVP/Fatia: MVP-004 · M4-F03.
- Issue: [#110](https://github.com/RodReis/rrb-jarvisOS/issues/110).
- Status: **aprovada-pi** (2026-08-29) — local da tela, forma de entrada, granularidade e numeração resolvidos pelo PI nesta data.
- Dependências: **MVP-002 entregue** (allowlist de diretórios como dado + checagem — SPEC-Execucao-03; Policy Engine — SPEC-Execucao-02). **M4-F01 entregue** (enforcement fail-closed de filesystem). **M4-F02 entregue** (terminal controlado; o cwd passa por `isPathAllowed`). **MVP-003 entregue** (Design System — a tela usa os componentes da SPEC-DS-03a/03b e os padrões da SPEC-DS-04b). `AuditEvent`/hash-chain (SPEC-Fundacao-04), logging (SPEC-Fundacao-06). Settings existente (SPEC-Fundacao-05).
- Decisões que sustentam esta spec: SPEC-Execucao-03 (modelo, default de fábrica, canonicalização, matching recursivo, edição auditada); RF-016 ("diretórios configuráveis"); RF-019 (editar permissão = alto risco); ARCHITECTURE § Fronteiras (renderer nunca toca FS; IPC tipado); ADR-004 (auditoria); ADR-005 (logging).

## Por que esta fatia existe

A verificação da M4-F02 no app real encontrou o buraco (`DEVELOPMENT.md`): **os canais da allowlist de diretórios existem na ponte desde o MVP-002 e nenhuma tela os usa** — zero referência a `addAllowedDirectory` em `src/renderer`. Pelo aplicativo o usuário **não consegue permitir um diretório**, e sem isso o terminal não executa nada, porque o cwd sempre cai fora da allowlist. A verificação só terminou porque foi usada a ponte direto, fora da UI.

Não é `[FIX]`: não existe parágrafo definindo onde essa tela mora nem como se comporta, então havia escopo a decidir — e decidir escopo é do PI. Daí a spec.

## Objetivo

Entregar a **tela que faltava**: uma seção em Settings onde o usuário vê os diretórios permitidos, adiciona um por **seletor nativo de pasta** e remove os que adicionou — tudo pelos canais IPC que já existem, com auditoria já implementada no repositório. A fatia **não** cria conceito novo, não muda contrato e não toca enforcement.

## Escopo

### Dentro

- **Seção "Diretórios permitidos" na tela Settings**, acessível nos dois workspaces (Settings é capacidade compartilhada, SPEC-Fundacao-05). Usa os componentes do Design System; nenhum estilo novo.
- **Listar** os diretórios permitidos do usuário via `listAllowedDirectories` (canal existente).
- **Adicionar** por **seletor nativo de pasta**: novo handler IPC no main que abre `dialog.showOpenDialog` com `properties: ['openDirectory']` e, com a escolha confirmada, chama `AllowlistRepository.add`. Cancelar o diálogo não altera nada e não gera evento.
- **Remover** um diretório via `removeAllowedDirectory` (canal existente).
- **Marcar o diretório gerido pelo app** (`appDir`, default de fábrica) como **não removível** na UI, espelhando o repositório, que já recusa removê-lo.
- **Estado vazio, carregando e erro** conforme os padrões da SPEC-DS-04b.
- **Feedback de path canonizado:** a lista exibe o caminho **como foi canonizado e gravado**, não como digitado ou escolhido, para o usuário ver exatamente o que permitiu.
- **i18n** (`i18next`, pt-BR e en-US), como o resto do Settings.

### Fora

- **Granularidade read-only versus read-write por diretório** — permanece **fora**, decisão do PI nesta data. Um diretório permitido continua valendo para leitura e escrita juntas.
- **Alterar `isPathAllowed`, o Policy Engine ou o enforcement** da M4-F01/M4-F02 — nada disso muda; esta fatia só consome.
- **Allowlist de comandos** — já tem UI própria no painel do terminal (M4-F02); esta fatia não a toca.
- **File Explorer, System Monitor, navegação de arquivos** — seguem futuros (RF-016).
- **Diretórios de rede, montagens remotas** — seguem fora, como na SPEC-Execucao-03.

## Regras

- O **renderer nunca toca o filesystem**: o seletor de pasta abre no **main**, e o path volta por IPC tipado já canonizado. A tela recebe strings, nunca handle de arquivo.
- **Adicionar é um ato só.** Não há confirmação em duas etapas nem aceite duplo — a ação é auditada, que é a garantia prevista, e aceite duplo não foi pedido por ninguém (CONVENTION §4, invariante 9).
- **Editar a allowlist continua sendo ação de alto risco** (RF-019): classificada pelo Policy Engine e auditada com `AuditEvent` encadeado, exatamente como o repositório já faz. A UI não cria nem relaxa política.
- **A tela nunca canoniza nem valida path por conta própria** — quem canoniza é o main (`allowlist-canon`), fonte única.
- Diretório já presente na lista não vira duplicata: o repositório já trata, e a UI apenas reflete o resultado.

## Critérios de aceite

1. **A seção aparece em Settings** nos dois workspaces e lista os diretórios permitidos do usuário. Teste de tela.
2. **Adicionar pelo seletor nativo** insere o diretório escolhido e a lista reflete o path **canonizado**. Teste com o diálogo dublado.
3. **Cancelar o seletor não altera a allowlist** e não gera `AuditEvent`. Teste — é o caso que uma implementação apressada erra.
4. **Remover** tira o diretório da lista; o **`appDir` não é removível** e a UI o apresenta como fixo. Teste dos dois casos.
5. **Adicionar e remover geram `AuditEvent` encadeado**; `verifyAuditChain` passa depois das duas operações. Teste.
6. **O renderer não toca o filesystem:** nenhuma API de FS é usada no renderer; o diálogo abre no main. Teste comprova que a tela só fala por IPC tipado.
7. **Jornada real fecha o buraco:** com a allowlist vazia além do `appDir`, permitir uma pasta pela tela faz o terminal aceitar aquele cwd que antes recusava. É o critério que prova que a fatia resolve o problema que a originou.
8. Estados vazio/carregando/erro seguem a SPEC-DS-04b.
9. `npm run test` e `npm run lint` passam; evidência em `reports/TESTS.md` (Regras + Tela).

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Onde mora a tela:** **seção em Settings**. Diretórios permitidos governam filesystem (M4-F01) **e** terminal (M4-F02) — é capacidade compartilhada da plataforma. A allowlist de **comandos** ficou no painel do terminal por ser específica dele; a de diretórios não é. — decidido.
2. **Forma de entrada:** **seletor nativo de pasta** (`dialog.showOpenDialog` no main), não campo de texto. Num campo onde errar significa permitir a pasta errada, digitação livre é risco sem contrapartida; o seletor devolve caminho real e o main canoniza. — decidido.
3. **Granularidade read versus write:** **permanece fora** — leitura e escrita continuam juntas por diretório. Separar exigiria mexer em `isPathAllowed`, no Policy Engine e no enforcement de três fatias já aceitas, sem caso de uso concreto que peça. A fatia entrega a tela que falta, nada além. — decidido.
4. **Numeração:** **M4-F03, dentro do MVP-004**. A pendência nasceu na verificação da M4-F02 e é o que falta para o MVP-004 ser utilizável pelo aplicativo; o épico [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) passa a ter três fatias e só fecha com ela. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Escopo por `user_id`**, como o repositório já implementa (SPEC-Execucao-03). A allowlist de diretórios não é separada por workspace: o filesystem da máquina é o mesmo nos dois.
- **Nenhum canal IPC existente muda.** A fatia adiciona **um** canal — o do seletor de pasta — e consome os três que já existem. Contrato antigo intacto significa nenhuma fatia entregue quebra.
- **Sem confirmação dupla, sem diálogo de consentimento, sem texto de política.** A garantia é a auditoria, que já existe; inventar cerimônia aqui seria criar regra que ninguém pediu.
- **A tela mostra o motivo de o `appDir` ser fixo** em uma linha, para o usuário não achar que é defeito.

## Ordem e dependências

M4-F01 e M4-F02 entregues → **M4-F03**. Não bloqueia a fila do MVP-005 e pode ser executada quando o PI decidir. **Desbloqueia:** uso real do terminal e do filesystem pelo aplicativo, e a **M8-F01** (MVP-008), que sem esta tela fica limitada a criar projeto apenas dentro do diretório gerido pelo app.

## Testes e evidência

Testes de tela (Testing Library) para listar/adicionar/cancelar/remover e para o `appDir` fixo; teste do handler do diálogo no main com `dialog` dublado; teste de auditoria encadeada; prova de navegador (Playwright) da jornada da seção em Settings; verificação no app real da jornada do critério 7. Relatório `docs/test-reports/SPEC-ExecucaoReal-03.md` conforme ADR-003 — números só do `--json` dos runners. Custo externo: zero.

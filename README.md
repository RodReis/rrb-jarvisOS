# rrb-jarvisOS

Desktop app **local-first** com dois espaços de usuário sobre uma plataforma compartilhada.

- **NOA** — espaço pessoal (hoje, agenda, rotina, saúde, finanças, conteúdo, memória)
- **JARVIS OS** — espaço profissional/operacional, com o **Agents OS** como área interna
- **Desenvolvimento** — a plataforma compartilhada. Não é workspace de usuário e nunca aparece na troca de espaço

O SQLite local é a **fonte de verdade operacional**; o Supabase Cloud é espelho de sync, auth e auditoria — nunca o contrário ([ADR-001](docs/DECISIONS.md)).

---

## Subir o app

```bash
npm install && npm run dev
```

O `postinstall` recompila o `better-sqlite3` para o ABI do Electron; o `dev` sobe o processo main, o preload e o renderer com HMR.

> **Se o Electron abortar com `Assertion failed: (isolate_data->snapshot_data()) != nullptr`**, a variável `ELECTRON_RUN_AS_NODE` está setada no seu shell. Ela faz o Electron subir como Node puro, e o erro **não** é o que parece — não é falha de bundle. Rode `unset ELECTRON_RUN_AS_NODE` antes do `npm run dev`. Note que `ELECTRON_RUN_AS_NODE= npm run dev` **não** resolve: esvaziar a variável não é o mesmo que removê-la.

O app sobe sem configuração nenhuma — só o **login** fica indisponível até o `.env` existir (ver [Login](#login-opcional)). Fechar a janela **minimiza para a bandeja**; para encerrar de verdade, use o menu do tray.

### Portas

| O quê | Porta | Observação |
|---|---:|---|
| Renderer (dev) | 5173 | Default do Vite. O `electron.vite.config.ts` **não declara porta**, então a 5180 com `strictPort` do CLAUDE.md ainda não vale — é o bug [#41](https://github.com/RodReis/rrb-jarvisOS/issues/41) |
| Galeria de prova | 5181 | `strictPort` — falha se ocupada, em vez de trocar |
| Supabase local | 54321 | Só quando a stack Docker está no ar |

---

## Stack

| Camada | Escolha |
|---|---|
| Shell | Electron + electron-vite, `contextIsolation` on, `nodeIntegration` off |
| Interface | React 19 + TypeScript + Tailwind v4 |
| Design system | Radix Primitives encapsulados + tokens próprios (`src/design/`) |
| Persistência local | SQLite (`better-sqlite3`) com migrations por `user_version` |
| Sync / auth | Supabase (espelho), OAuth Google por loopback no navegador do sistema |
| Observabilidade | winston (main) + electron-log (renderer), com redaction obrigatória |
| Testes | Vitest (unidade, integração, componente) + Playwright-Electron (E2E e prova visual) |

### Estrutura

```
src/
├── main/        processo principal — IPC, storage, auth, policy, execução
├── preload/     a ponte: contrato tipado, sem acesso a Node no renderer
├── renderer/    a interface (React)
├── shared/      contratos e regras puras, compartilhados entre main e renderer
└── design/      o design system — tokens → ui → patterns
```

**Regra inviolável:** o renderer nunca acessa Node, segredo ou executa comando direto. Tudo passa pelo preload, por um canal tipado e nomeado. E `src/design/` não importa domínio, renderer, main, Electron nem Node — a fronteira é verificada pelo ESLint e quebra o build se furada.

---

## Comandos

```bash
npm run dev            # sobe o app em desenvolvimento
npm run build          # typecheck + build de produção
npm test               # suíte completa (Vitest)
npm run test:watch     # Vitest em modo watch
npm run test:prova     # prova visual em navegador real (Playwright)
npm run lint           # ESLint + Prettier (só verifica)
npm run lint:fix       # ESLint + Prettier (corrige)
npm run typecheck      # tsc nos dois projetos (node e web)
npm run test:report    # regenera reports/TESTS.md a partir dos runners
```

`dev`, `test` e `lint` verdes é o piso de qualquer entrega.

### Galeria de prova visual

Não é rota do app — é um servidor separado que renderiza os componentes do design system para inspeção e captura:

```bash
npx vite --config vite.prova.config.ts
```

Depois abra `http://127.0.0.1:5181/?galeria=jornada&cena=choice`. Outras galerias: `controles`, `dados`, `identidades`, `shell`, `operacionais`.

---

## Login (opcional)

Sem `.env`, o app roda normalmente com o usuário local — só o login fica indisponível, com aviso claro na tela.

Para habilitá-lo, copie `.env.example` para `.env` e preencha `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. O arquivo documenta onde obter cada valor e por que a `service_role` **nunca** entra num app desktop.

O fluxo abre no navegador do sistema e retorna por um servidor loopback local — não há webview embutida. Os tokens ficam no cofre do SO (`safeStorage`), nunca no renderer, e a sessão offline vale 30 dias.

---

## Supabase local (opcional)

Necessário só para rodar os testes de RLS. Exige Docker.

```bash
npx supabase start     # sobe a stack
npx supabase stop      # derruba
```

Sem ele, os testes de RLS são **pulados** em vez de falharem — quem clona o repo sem Docker não vê vermelho por isso. No CI a stack é obrigatória, e a ausência dela falha o build. Detalhe em [`supabase/README.md`](supabase/README.md).

---

## Testes

Três categorias, definidas pelo que cada teste prova — não pela pasta ([ADR-003](docs/DECISIONS.md)):

| Categoria | O que prova | Padrão |
|---|---|---|
| **Regras de Negócio** | lógica pura, sem storage/IPC/rede | `*.spec.ts` |
| **Banco** | storage real: SQLite em arquivo temporário, RLS contra a stack Docker | `*.int-spec.ts` |
| **Tela** | componente em jsdom + E2E no app empacotado | `*.test.tsx`, `tests/e2e/` |

A evidência é **gerada por máquina** em [`reports/TESTS.md`](reports/TESTS.md), com uma linha por entrega. O CI barra divergência entre o arquivo e a execução limpa — número escrito à mão não passa.

Além disso há a **prova visual**: Playwright num navegador de verdade, medindo o que jsdom não mede — contraste computado, layout real, foco pintado. Ela existe porque teste de papel prova contrato e não prova pintura: ao longo do MVP-003 ela pegou seis defeitos que passavam com a suíte inteira verde.

---

## Documentação

| Doc | O que é |
|---|---|
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Ordem de execução e status por fatia — onde estamos dentro de cada entrega |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Desenho, módulos, dados, resiliência |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADRs — ler antes de propor mudança estrutural |
| [`docs/STATUS.md`](docs/STATUS.md) | Kanban e roadmap, espelho das GitHub Issues |
| [`docs/CONVENTION.md`](docs/CONVENTION.md) | Contrato do processo e das entidades |
| [`docs/TESTING.md`](docs/TESTING.md) | Metodologia de teste e o relatório de evidência |
| [`docs/spec/`](docs/spec/) | Specs por fatia — só se implementa fatia com spec `aprovada-pi` |

---

## Estado

**MVP-001 Fundação** ✅ · **MVP-002 Execução local controlada** ✅ · **MVP-003 Design System** ✅

Próximo: **MVP-004** — execução real (terminal controlado + execução allowlisted).

Ambiente 100% local até o fim do MVP; sem deploy em nuvem.

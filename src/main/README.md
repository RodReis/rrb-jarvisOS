# `src/main` — processo principal (Electron)

O lado privilegiado do app: janela, IPC, e futuramente o runtime de domínio.
Tudo que toca Node, disco, segredo ou processo mora aqui — **nunca** no renderer.

| Caminho | Papel |
|---|---|
| `index.ts` | Ciclo de vida do app: ready, janela, encerramento |
| `window.ts` | Criação da `BrowserWindow` e aplicação das opções de segurança |
| `ipc/` | Handlers dos canais declarados em `src/shared/contracts/ipc.ts` |
| `preload/` | A ponte tipada exposta ao renderer via `contextBridge` |

## Regras

- **Um handler por canal do contrato.** Nada de rota genérica: se o canal não
  está em `IPC_CHANNELS`, o renderer não o alcança.
- **O preload não expõe `ipcRenderer`.** Só métodos nomeados, tipados pelo
  contrato compartilhado.
- O preload é bundlado como **CommonJS** (`index.cjs`) de propósito: preload ESM
  exigiria `sandbox: false`, e o sandbox é critério de aceite da spec.
- Política e auditoria (Policy Engine, `AuditEvent`) entram nos MVPs seguintes;
  quando entrarem, o main **não decide sozinho** — consulta o Policy Engine.

## Testes

`*.spec.ts` (categoria *Regras de Negócio*) e `*.int-spec.ts` (categoria *Banco*,
a partir da Fatia 04). Ver `docs/TESTING.md`.

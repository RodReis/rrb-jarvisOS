# `src/shared` — contratos compartilhados

O vocabulário comum entre main e renderer. É o único código importado pelos dois
lados, e por isso a regra é dura: **nada aqui pode depender de Electron, de Node
ou do DOM**. Código que precisa de um desses pertence a `src/main` ou
`src/renderer`.

| Caminho | Papel |
|---|---|
| `contracts/` | Tipos e constantes da fronteira: canais IPC, formato dos payloads, opções de segurança |
| `domain/` | Entidades de domínio (`UserProfile`, `Workspace`, …) — chegam na Fatia 04 |
| `policies/` | Avaliador puro do Policy Engine — chega no MVP-002 |

## Por que as opções de segurança moram aqui

`contracts/security.ts` guarda `RENDERER_SECURITY` (contextIsolation, sandbox,
nodeIntegration). Fica em `shared` — e não junto da criação da janela — porque é
**contrato, não comportamento**: precisa ser verificável por teste sem carregar
o Electron. `src/main/window.spec.ts` prova que a janela realmente aplica esses
valores, fechando as duas pontas.

## Testes

`*.spec.ts` (categoria *Regras de Negócio*): unidade pura, sem storage, sem IPC,
sem rede. Ver `docs/TESTING.md`.

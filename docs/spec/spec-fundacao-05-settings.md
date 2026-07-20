# SPEC-Fundacao-05 — Settings mínimo

- MVP: `docs/mvp/mvp-001-fundacao.md` (Fatia 05)
- Status: **rascunho** — vira `aprovada-pi` quando as perguntas abertas estiverem resolvidas.
- Dependências: Fatias 01–04 entregues (persiste preferências no `UserProfile` da Fatia 04).

## Objetivo

Tela de configurações mínima: idioma e tema. Fecha o MVP Fundação.

## Escopo

### Dentro

- Tela Settings acessível nos dois workspaces (capacidade compartilhada; preferências salvas por usuário).
- **Idioma**: `pt-BR` (padrão) e `en-US`. Troca aplica na UI sem reiniciar. Infra de i18n mínima (chaves de tradução para o shell e telas existentes — não traduzir docs internos).
- **Tema**: claro/escuro seguindo preferência do SO por padrão, com override manual (claro | escuro | sistema).
- Persistência das preferências no `UserProfile` local (Fatia 04); mudança gera evento comum, **não** exige aprovação (ação de baixo risco).

### Fora

- Notificações, autosave, efeitos sonoros, AI Engine, Identity/Soul, seleção de modelo — RF-023 completo fica para MVP futuro. Preferências por workspace (por ora, só por usuário).

## Critérios de aceite

1. Trocar idioma atualiza a UI imediatamente e persiste entre sessões.
2. Tema segue o SO por padrão; override manual persiste entre sessões.
3. Preferências são por usuário: logout/login de outro usuário não herda as do anterior.
4. `npm run test` e `npm run lint` passam.

## Perguntas abertas ao PI

1. Biblioteca de i18n: `i18next` (padrão de mercado, mais peso) ou dicionário próprio mínimo (2 idiomas, shell pequeno)? Proposta do Cowork: dicionário próprio nesta fatia; migrar para i18next quando o volume de telas justificar.

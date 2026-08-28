# Product

## Register

product

## Users

Quatro perfis, do PRD §6 — todos operando um **desktop app local-first** (Electron), não um site.

- **Operador da Plataforma** — o uso principal. Precisa ler o estado do sistema de relance, disparar comandos, acompanhar agentes em execução, entender custo, distinguir nível de risco e agir sobre falha sem ambiguidade. Contexto: sessão longa, janela sempre aberta, alternando entre os dois espaços de usuário.
- **Administrador** — configura providers, políticas, temas e permissões. Precisa ver o **impacto** de uma mudança antes de confirmá-la.
- **Desenvolvedor de produto** — compõe módulos novos sem recriar tokens, acessibilidade, estados e padrões operacionais.
- **QA e responsável por acessibilidade** — precisa de casos executáveis, matriz de estados e critérios objetivos de aprovação.

### As três camadas (`docs/iniciais/fronteiras-desenvolvimento-noa-jarvisos.md`)

O sistema tem **três camadas**, não dois espaços. Confundi-las é o erro que a fronteira existe para evitar:

| Camada | O que é | Espaço de usuário? |
|---|---|---|
| **Desenvolvimento** | base técnica compartilhada — Electron, runtime, IPC, Policy Engine, AuditEvent, providers | **Não.** Modo/admin técnico, nunca espaço de usuário final |
| **NOA** | espaço **pessoal** — Agenda, Conteúdo, Finanças, Saúde, Memória, Automações | Sim |
| **JARVIS OS** | espaço **profissional/operacional** — Agentic OS, Mission Control, Agents, Squads, Workflows, Analytics | Sim |

`Agentic OS` é **área interna do JARVIS OS** — usa o `workspace_id` dele, não cria um quarto workspace nem tem identidade, orçamento ou memória próprios.

A **camada compartilhada** (Auth, Workspaces, Permissões, Auditoria, BudgetPolicy, Conectores, Providers, Memória, Notificações, Voice layer, Settings) é capacidade **técnica** comum; os dados e políticas se separam por `workspace_id`, `user_id` e — quando houver — `organization_id`.

### Separação de linguagem (o que rege o design)

A fronteira §206 define o tom de cada espaço, e é isso que o DS precisa carregar:

- **NOA** — linguagem **pessoal, calma e privada**. Dados pessoais são privados por padrão; saúde, finanças e documentos são **sempre alto risco**; compartilhar com o JARVIS é bloqueado no MVP.
- **JARVIS OS** — linguagem **operacional**. Deploy, publicação, envio de mensagem e alteração de banco remoto **sempre** exigem aprovação.

Mesma base visual, dois registros de voz. É o que o MVP-003 chama de *"base única, 2 identidades"* — e a Fatia 05 é quem materializa os deltas (`docs/design/design-system/NOA.md` e `JARVISOS.md`).

## Product Purpose

Permitir que qualquer módulo da Plataforma componha uma experiência operacional coerente, acessível e tematizável a partir de contratos visuais e comportamentais compartilhados — **uma base única com duas identidades de usuário** (NOA e JARVIS OS) sobre uma camada técnica comum (Desenvolvimento), nunca dois design systems.

Sucesso é: um módulo novo nasce consistente sem que ninguém escreva CSS local; o operador distingue risco, estado e custo sem ler documentação; e o NOA reutiliza a mesma base com identidade semântica própria.

### Fontes de verdade do design

| Documento | O que define |
|---|---|
| `docs/iniciais/fronteiras-desenvolvimento-noa-jarvisos.md` | as três camadas, o que é compartilhado, a separação de linguagem |
| `docs/design/design-system/README.md` | base visual comum — tokens, tipografia, toasts, animações, claro/escuro §2.6 |
| `docs/design/design-system/JARVISOS.md` | delta JARVIS + Agents OS (Mission Control, Harnesses, Teams, Governance, Knowledge) |
| `docs/design/design-system/NOA.md` | delta NOA (Hoje, Agenda, Rotina, Saúde, Finanças, Conteúdo, Memória) |
| `docs/design/JARVIS Platform (offline).html` | o protótipo realizado — **vence o PRD** onde divergirem sobre a experiência |
| `docs/design/design-system/screens/` | 41 mockups (jarvis 20 · agents 13 · noa 7 · login 1) |
| `docs/iniciais/prd-design-system-plataforma.md` | governa a **forma de implementar** (React tipado, tokens, WCAG 2.2 AA) |

Regra de precedência (SPEC-DesignSystem-02): onde protótipo e PRD divergirem sobre a **experiência realizada**, o protótipo vence; o PRD governa só **como** implementar.

## Brand Personality

**Operacional, preciso, cinético.**

Sala de operações, não painel de controle: informação densa e legível, movimento que **indica estado** em vez de decorar, pretensão técnica assumida sem virar caricatura. O protótipo (`docs/design/JARVIS Platform (offline).html`) é a referência realizada dessa voz — carbono quase-preto, Michroma nos títulos, Share Tech Mono nas labels, glow do acento nas superfícies de marca.

Voz da escrita: direta e em pt-BR. Mensagem de erro diz **o que houve e qual o próximo passo** — nunca stack trace cru, nunca "algo deu errado".

## Anti-references

Quatro coisas que esta interface não pode parecer:

- **Dashboard SaaS genérico** — cards uniformes com ícone+título+texto repetidos, métrica gigante com label pequena, gráfico roxo de template. É exatamente o que o protótipo deliberadamente não é.
- **Sci-fi de brinquedo** — glow em tudo, fonte futurista sem hierarquia, animação contínua sem significado. Este é o risco *próprio* deste protótipo levado longe demais: o movimento existe para comunicar estado.
- **Admin corporativo cinza** — Bootstrap/Material sem identidade, tabela cinza, zero personalidade.
- **Terminal hacker verde-em-preto** — estética Matrix, mono em tudo, verde fósforo. Clichê de "ferramenta técnica".

## Design Principles

Os dez princípios do PRD §7 valem integralmente. Os cinco que mais decidem no dia a dia:

1. **Clareza antes de efeito visual.** Quando o brilho disputa com a legibilidade, a legibilidade vence — inclusive contra o protótipo.
2. **Estado nunca é comunicado só por cor.** Forma, ícone, texto e posição carregam o mesmo sinal. Vale para daltonismo e vale para quem olha de relance.
3. **Ação sensível mostra impacto antes da confirmação.** O usuário aprova o que vai acontecer, não um botão.
4. **Componentes não conhecem infraestrutura nem domínio.** O DS recebe dado por props tipadas; não busca, não persiste, não decide política. Regra verificável por lint (`src/design/README.md`).
5. **Preferência visual não altera significado semântico.** O acento é do usuário; `ok/warn/err/info` são do sistema. Se "erro" pudesse ser verde porque alguém escolheu verde, a cor pararia de significar erro.

## Accessibility & Inclusion

**WCAG 2.2 nível AA** em todos os componentes e padrões públicos (PRD §14). Requisitos que mais moldam o código:

- Operação completa por teclado, ordem de foco previsível, foco visível e não encoberto.
- Contraste mínimo nos **dois** modos (claro e escuro) — o modo claro das telas internas é canônico, não uma cortesia.
- Nome, papel e estado expostos corretamente (a a11y se verifica por papel, não por classe CSS).
- Movimento respeita `prefers-reduced-motion`.
- Zoom e reflow não podem ocultar ação essencial.
- Drag and drop tem alternativa por teclado.
- Texto de erro identifica o problema **e** a próxima ação.

Nota de tensão registrada: a fonte de corpo do protótipo (Rajdhani) foi mantida por decisão do PI mesmo em texto denso, contra a sugestão do PRD §10.1. Se surgir queixa real de legibilidade em log/terminal, é revisão de escopo do PI — não ajuste unilateral.

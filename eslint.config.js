import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // O lint cobre o código do app e o ferramental do repo — não o protótipo visual
  // (docs/design/, referência do MVP-003) nem o tooling de terceiros instalado na raiz.
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'reports/.raw/**',
      'docs/**',
      '.aiox-core/**',
      '.aiox/**',
      '.claude/**',
      '.codex/**',
      '.gemini/**',
      '.antigravity/**',
      'graphify-out/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'scripts/**/*.{ts,mjs}', 'tests/**/*.ts'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    // Fronteira do design system (SPEC-DesignSystem-01, critério 2; PRD §8.1).
    //
    // O DS é reutilizável em NOA e JARVIS justamente por não conhecer domínio nem
    // infraestrutura. Escrever a regra na spec não a torna verificável — esta regra
    // **quebra o lint** quando um arquivo de `src/design/` importa caminho proibido,
    // que é o que a transforma de intenção em garantia.
    files: ['src/design/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                // Domínio/produto e a ponte IPC: o DS recebe dado por props, nunca o busca.
                '@shared/*',
                '@renderer/*',
                '**/src/shared/*',
                '**/src/renderer/*',
                // Main process, Node e Electron: o DS roda no renderer sandboxed.
                '**/src/main/*',
                'electron',
                'node:*',
                // Espelho de sync — nem em tipo: seria dependência de infraestrutura.
                '@supabase/*',
                // Relativo que escapa de src/design/ (o `..` de dentro do DS é legítimo).
                '../../*'
              ],
              message:
                'Fronteira do design system (SPEC-DesignSystem-01): src/design/ não importa domínio, renderer, main, Electron/Node nem Supabase. Dados entram por props tipadas.'
            }
          ]
        }
      ]
    }
  },
  {
    // Isolamento dos adapters de IA (SPEC-Providers-02, critério 1).
    //
    // "O ponto de chamada não conhece Anthropic diretamente — só a interface `AiAdapter`" é
    // uma frase da spec até virar regra. A garantia real é esta: **só** `src/main/ai/` pode
    // importar um SDK de provider, e dentro dela só o arquivo do adapter o faz.
    //
    // Sem isto, o isolamento decai por conveniência — o primeiro lugar que precisa de um tipo
    // do SDK o importa direto, e a troca de provider deixa de ser "escrever outro adapter".
    // Escopo em `src/main/` e não em `src/**`: no flat config, um bloco posterior que declare
    // `no-restricted-imports` **substitui** o do bloco anterior para os arquivos que ele casa,
    // e um `src/**` aqui apagaria a fronteira do design system logo abaixo — foi exatamente o
    // que `tests/design/fronteira.int-spec.ts` pegou. O main é onde o SDK poderia ser
    // importado de qualquer forma: `src/design/` e `src/renderer/` já não alcançam node_modules
    // de provider pelas suas próprias fronteiras.
    files: ['src/main/**/*.ts'],
    ignores: [
      'src/main/ai/anthropic-adapter.ts',
      'src/main/ai/*.int-spec.ts',
      // A implementação do engine de STT é quem pode importar o runtime dele.
      'src/main/voz/faster-whisper-engine.ts',
      'src/main/voz/*.int-spec.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/*'],
              message:
                'Critério 1 (SPEC-Providers-02): só o adapter do provider importa o SDK dele. O resto do app fala com a interface `AiAdapter` — é isso que torna trocar de provider uma questão de escrever outro adapter.'
            },
            {
              // Mesmo desenho, mesma razão (SPEC-Voz-01, critério 1): o app fala com
              // `SttEngine`, nunca com o runtime concreto. A `ignores` acima libera só a
              // implementação — trocar de engine tem de ser escrever outra, não caçar imports
              // espalhados pelo main.
              group: ['faster-whisper*', 'whisper*', 'onnxruntime*'],
              message:
                'Critério 1 (SPEC-Voz-01): só a implementação do engine conhece o runtime de STT. O resto do app fala com a interface `SttEngine`.'
            }
          ]
        }
      ]
    }
  },
  {
    // Componentes consomem só tokens (SPEC-DesignSystem-03a, critério 5).
    //
    // A camada `ui` é onde o valor solto entra: um `#0a0b0e` ou um `text-[14px]` digitado à
    // mão funciona, não quebra nada, e desfaz a escala em silêncio. Foi o que a própria 03a
    // encontrou — `text-[14px]` repetido em sete arquivos antes desta regra existir.
    //
    // `tokens/` fica de fora de propósito: é lá que os valores primitivos **devem** morar. A
    // regra vale para quem os consome, não para quem os define.
    files: ['src/design/{ui,patterns}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Cor literal em qualquer string: `#rgb`, `#rrggbb`, `rgb(...)`, `hsl(...)`.
          // `rgba(var(--jos-borda-rgb), .12)` passa — o RGB vem do tema, só o alfa é do uso.
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\b(rgb|hsl)a?\\((?![^)]*var\\(--jos)/]',
          message:
            'Critério 5 (SPEC-DesignSystem-03a): cor literal em src/design/ui. Use um token — var(--jos-cor-*) ou os exports de tokens/.'
        },
        {
          // Medida arbitrária em classe Tailwind: `text-[14px]`, `size-[20px]`, `rounded-[5px]`.
          // A forma com `var(--jos-...)` dentro dos colchetes continua permitida.
          selector: 'Literal[value=/-\\[[0-9]+(\\.[0-9]+)?(px|rem|em|ms|s)\\]/]',
          message:
            'Critério 5 (SPEC-DesignSystem-03a): medida literal em classe. Use um token — var(--jos-texto-*), var(--jos-raio-*), var(--jos-tamanho-*), var(--jos-duracao-*).'
        },
        {
          // Classe Tailwind montada por interpolação: `` `border-[var(--jos-cor-${tom})]` ``.
          //
          // O Tailwind descobre classes **varrendo o texto do código-fonte** — uma classe que só
          // existe em runtime nunca chega ao CSS gerado. Achado na F03b: a versão interpolada
          // produzia **zero** ocorrências no bundle, contra 53 das escritas por extenso, e o
          // painel com tom semântico renderizava sem borda colorida.
          //
          // Mesma classe de defeito do `@source` faltando (F03a): CSS que não existe não quebra
          // nada — só não pinta. Use um mapa literal (ver `ui/semantica.ts`).
          selector: 'TemplateLiteral[quasis.0.value.raw=/(bg|text|border|shadow|ring|fill)-\\[/]',
          message:
            'Classe Tailwind interpolada não é gerada — o Tailwind varre o código-fonte, não o runtime. Use um mapa literal (ex.: CLASSE_BORDA_SEMANTICA em ui/semantica.ts).'
        }
      ]
    }
  },
  {
    rules: {
      // A fronteira renderer↔main é tipada: `any` a dissolveria em silêncio.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  prettier
)

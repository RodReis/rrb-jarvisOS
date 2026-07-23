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
    rules: {
      // A fronteira renderer↔main é tipada: `any` a dissolveria em silêncio.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  prettier
)

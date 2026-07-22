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
    rules: {
      // A fronteira renderer↔main é tipada: `any` a dissolveria em silêncio.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  prettier
)

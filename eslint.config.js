import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import {defineConfig} from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/storybook-static/**',
      'tools/storybook/static/**',
      '**/target/**',
      '**/node_modules/**',
      '**/fixtures/**',
      '**/bin/**',
      '**/obj/**',
      '**/.data/**',
      '**/.venv/**',
      '**/__pycache__/**',
      '**/test-results/**',
      '**/.vscode-test/**',
      // Scaffolding templates are checked filled in: the CLI's browser test
      // builds and checks a scaffolded renderer with its own TypeScript setup.
      'packages/cli/templates/renderer/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {globals: {...globals.node, ...globals.browser}},
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'inline-type-imports'}],
      'no-constant-condition': ['error', {checkLoops: false}],
      eqeqeq: ['error', 'always', {null: 'ignore'}],
    },
  },
  {
    files: [
      'packages/{schemas,cli,integrations/vscode}/src/**/*.{ts,tsx}',
      'packages/host/{core,vscode-ui,inspector}/src/**/*.{ts,tsx}',
      'packages/{engine,renderers,extractors}/*/src/**/*.{ts,tsx}',
      'examples/renderers/*/src/**/*.{ts,tsx}',
      'tools/storybook/{src,stories,harness}/**/*.{ts,tsx}',
    ],
    plugins: {'react-hooks': reactHooks},
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
)

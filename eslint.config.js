import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import {defineConfig} from 'eslint/config'
import tseslint from 'typescript-eslint'
import {engineContractsRule} from './tools/scripts/engine-contracts.mjs'
import {lifecycleFiles, machinesPlugin} from './tools/scripts/check-machines/lifecycle-rule.mjs'

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
      // Generated from packages/sdk/src/extractor.ts, which is linted.
      'packages/cli/node/extractor.mjs',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {globals: {...globals.node, ...globals.browser}},
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'inline-type-imports'}],
      'no-constant-condition': ['error', {checkLoops: false}],
      eqeqeq: ['error', 'always', {null: 'ignore'}],
    },
  },
  {
    // Decisions the engine owns (tools/scripts/engine-contracts.mjs): the code outside it asks the engine.
    files: ['**/src/**/*.{ts,tsx,js,mjs}', 'tools/**/*.{ts,tsx,js,mjs}'],
    // Renderers can't reach the engine from their sandboxed frames; they classify rows through the renderer SDK.
    ignores: ['packages/engine/**', 'packages/renderers/**', 'tools/scripts/engine-contracts.test.mjs'],
    rules: {'no-restricted-syntax': engineContractsRule},
  },
  {
    files: [
      'packages/{schemas,machine,cli,integrations/vscode}/src/**/*.{ts,tsx}',
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
  {
    // Lifecycles are explicit state machines (docs/guides/state-machines.md). A warning here; npm run check:machines
    // fails when a file gains one over tools/scripts/check-machines/baseline.json.
    files: lifecycleFiles,
    plugins: {machines: machinesPlugin},
    rules: {'machines/lifecycle': 'warn'},
  },
)

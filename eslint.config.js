import {readdirSync} from 'node:fs'
import js from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import {defineConfig} from 'eslint/config'
import tseslint from 'typescript-eslint'
import {consideredPlugin} from './tools/scripts/considered-rule.mjs'
import {engineContractsRule} from './tools/scripts/engine-contracts.mjs'
import {lifecycleFiles, machinesPlugin} from './tools/scripts/check-machines/lifecycle-rule.mjs'

// Vendored shadcn/ui components: each with a pristine base in upstream/, which test/shadcn.test.mjs reproduces it from.
const shadcn = 'packages/host/core/src/ui/components'
const vendored = readdirSync(`${import.meta.dirname}/${shadcn}/upstream`)
  .filter(file => file.endsWith('.json') && file !== 'manifest.json')
  .map(file => `${shadcn}/${file.replace(/\.json$/, '.tsx')}`)

// The workspaces whose source is React.
const react = [
  'packages/{schemas,machine,cli,integrations/vscode}/src/**/*.{ts,tsx}',
  'packages/host/{core,vscode-ui,inspector}/src/**/*.{ts,tsx}',
  'packages/{engine,renderers,extractors}/*/src/**/*.{ts,tsx}',
  'examples/renderers/*/src/**/*.{ts,tsx}',
  'tools/storybook/{src,stories,harness}/**/*.{ts,tsx}',
]

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
      // Build and test output, as the .gitignore files list it.
      '**/pkg/**',
      'packages/engine/js/artifacts/**',
      'packages/sdk/vendor/**',
      'packages/integrations/vscode/.package/**',
      'packages/extractors/typescript-support/.runtime-*/**',
      'tools/storybook/screenshots/**',
      ...vendored,
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: {...globals.node, ...globals.browser},
      parserOptions: {
        // Each file's nearest tsconfig.json: a workspace's own, or its browser/ or test/ one.
        projectService: {
          // Configuration beside a workspace's tsconfig.json, which compiles only src.
          allowDefaultProject: [
            'examples/renderers/minimal/playwright.config.ts',
            'packages/cli/playwright.config.ts',
            'packages/host/core/playwright.config.ts',
            'packages/host/inspector/playwright.config.ts',
            'packages/host/vscode-ui/playwright.config.ts',
            'packages/host/inspector/vite.config.ts',
            'packages/host/core/build/*.d.mts',
            'packages/host/core/scripts/*.d.mts',
          ],
          defaultProject: 'tsconfig.base.json',
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 12,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Tuned: each option allows one well-defined idiom and nothing else (docs/maintainers/linting.md).
      '@typescript-eslint/restrict-template-expressions': ['error', {allowNumber: true}],
      '@typescript-eslint/no-confusing-void-expression': ['error', {ignoreArrowShorthand: true}],
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'],
            },
          ],
        },
      ],
      '@typescript-eslint/strict-boolean-expressions': ['error', {allowNullableString: true, allowNullableBoolean: true}],
      '@typescript-eslint/no-use-before-define': ['error', {functions: false, classes: false, typedefs: false, ignoreTypeReferences: true}],
      '@typescript-eslint/class-methods-use-this': ['error', {ignoreClassesThatImplementAnInterface: true, ignoreOverrideMethods: true}],
      '@typescript-eslint/no-shadow': ['error', {ignoreTypeValueShadow: true, ignoreFunctionTypeParameterNameValueShadow: true}],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/require-array-sort-compare': ['error', {ignoreStringArrays: true}],
      '@typescript-eslint/parameter-properties': ['error', {prefer: 'class-property'}],
      '@typescript-eslint/method-signature-style': ['error', 'property'],
      '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'inline-type-imports'}],
      '@typescript-eslint/consistent-type-exports': ['error', {fixMixedExportsWithInlineTypeSpecifier: true}],
      '@typescript-eslint/consistent-return': 'error',
      '@typescript-eslint/default-param-last': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-loop-func': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/strict-void-return': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // The TypeScript versions above replace these.
      'no-unused-vars': 'off',
      'consistent-return': 'off',
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always'],
      // `!!value` narrows `value` in TypeScript; `Boolean(value)` doesn't.
      'no-implicit-coercion': ['error', {allow: ['!!']}],
      ...Object.fromEntries(
        [
          'array-callback-return',
          'default-case-last',
          'grouped-accessor-pairs',
          'guard-for-in',
          'logical-assignment-operators',
          'no-alert',
          'no-caller',
          'no-constructor-return',
          'no-eval',
          'no-extend-native',
          'no-extra-bind',
          'no-labels',
          'no-lone-blocks',
          'no-lonely-if',
          'no-multi-assign',
          'no-new',
          'no-new-func',
          'no-new-wrappers',
          'no-object-constructor',
          'no-param-reassign',
          'no-promise-executor-return',
          'no-proto',
          'no-return-assign',
          'no-script-url',
          'no-self-compare',
          'no-sequences',
          'no-template-curly-in-string',
          'no-unassigned-vars',
          'no-unmodified-loop-condition',
          'no-unneeded-ternary',
          'no-unreachable-loop',
          'no-useless-assignment',
          'no-useless-call',
          'no-useless-computed-key',
          'no-useless-concat',
          'no-useless-rename',
          'no-useless-return',
          'no-var',
          'object-shorthand',
          'operator-assignment',
          'prefer-arrow-callback',
          'prefer-const',
          'prefer-exponentiation-operator',
          'prefer-numeric-literals',
          'prefer-object-has-own',
          'prefer-object-spread',
          'prefer-regex-literals',
          'prefer-rest-params',
          'prefer-spread',
          'prefer-template',
          'preserve-caught-error',
          'radix',
          'symbol-description',
          'yoda',
        ].map(rule => [rule, 'error']),
      ),
    },
  },
  {
    // Shipped libraries and UIs report through their callers, not the console; CLIs, scripts and tests print by design.
    files: ['packages/**/src/**/*.{ts,tsx}'],
    ignores: ['packages/integrations/github-action/**'],
    rules: {'no-console': 'error'},
  },
  {
    // What Considered measures (.considered.yaml) has to be readable by its scc provider (tools/scripts/considered-rule.mjs).
    plugins: {considered: consideredPlugin},
    rules: {'considered/regex-backtick': 'error'},
  },
  {
    // JavaScript has no annotations, so type-aware rules would only report `any`; every other rule still applies.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Decisions the engine owns (tools/scripts/engine-contracts.mjs): the code outside it asks the engine.
    files: ['**/src/**/*.{ts,tsx,js,mjs}', 'tools/**/*.{ts,tsx,js,mjs}'],
    // Renderers can't reach the engine from their sandboxed frames; they classify rows through the renderer SDK.
    ignores: ['packages/engine/**', 'packages/renderers/**', 'tools/scripts/engine-contracts.test.mjs'],
    rules: {'no-restricted-syntax': engineContractsRule},
  },
  {
    // The Rules of Hooks and the React Compiler's rules (refs, purity, immutability, set-state-in-effect…), all errors.
    files: react,
    plugins: {'react-hooks': reactHooks},
    rules: Object.fromEntries(Object.keys(reactHooks.configs['recommended-latest'].rules).map(rule => [rule, 'error'])),
  },
  {
    // What the React Compiler's rules don't cover: leaked listeners and timers, unstable context values and default
    // props, conditions that render `0`, index keys, and the APIs React 19 replaces (docs/maintainers/linting.md).
    files: react,
    // The extractors aren't React, and NestJS has a `forwardRef` of its own.
    ignores: ['packages/extractors/**'],
    plugins: {'@eslint-react': eslintReact},
    rules: Object.fromEntries(
      [
        'no-leaked-conditional-rendering',
        'no-unstable-context-value',
        'no-unstable-default-props',
        'no-array-index-key',
        'web-api-no-leaked-event-listener',
        'web-api-no-leaked-timeout',
        'dom-no-flush-sync',
        'no-context-provider',
        'no-forward-ref',
        'no-use-context',
      ].map(rule => [`@eslint-react/${rule}`, 'error']),
    ),
  },
  {
    // Accessibility of the hosts' and renderers' markup: semantic elements, keyboard support for what responds to the
    // mouse, and a name for every control.
    files: ['**/*.tsx'],
    ...jsxA11y.flatConfigs.strict,
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      // Its label may be text a few elements in: a table header's button's code, a heading's prose.
      'jsx-a11y/control-has-associated-label': [
        'error',
        {...jsxA11y.flatConfigs.strict.rules['jsx-a11y/control-has-associated-label'][1], depth: 4},
      ],
      // A tab panel, a window splitter (a focusable separator) and a scrollable region take focus in the ARIA patterns.
      'jsx-a11y/no-noninteractive-tabindex': ['error', {roles: ['tabpanel', 'separator', 'region']}],
      // A component's `autoFocus` prop is its own API: the pane that takes focus when asked to (focus moves on purpose).
      'jsx-a11y/no-autofocus': ['error', {ignoreNonDOM: true}],
    },
  },
  {
    // Lifecycles are explicit state machines (docs/guides/state-machines.md). A warning here; npm run check:machines
    // fails when a file gains one over tools/scripts/check-machines/baseline.json.
    files: lifecycleFiles,
    plugins: {machines: machinesPlugin},
    rules: {'machines/lifecycle': 'warn'},
  },
  {
    // Rules this configuration turns on whose existing violations are still being fixed (docs/maintainers/linting.md#turning-on-a-rule).
    // Each comes off this list in the change that fixes the last of them; nothing is added to it.
    rules: Object.fromEntries(
      [
        '@typescript-eslint/await-thenable',
        '@typescript-eslint/class-methods-use-this',
        '@typescript-eslint/consistent-return',
        '@typescript-eslint/default-param-last',
        '@typescript-eslint/method-signature-style',
        '@typescript-eslint/no-base-to-string',
        '@typescript-eslint/no-confusing-void-expression',
        '@typescript-eslint/no-deprecated',
        '@typescript-eslint/no-dynamic-delete',
        '@typescript-eslint/no-empty-function',
        '@typescript-eslint/no-generated-empty-object-type',
        '@typescript-eslint/no-invalid-void-type',
        '@typescript-eslint/no-loop-func',
        '@typescript-eslint/no-meaningless-void-operator',
        '@typescript-eslint/no-misused-promises',
        '@typescript-eslint/no-misused-spread',
        '@typescript-eslint/no-non-null-assertion',
        '@typescript-eslint/no-shadow',
        '@typescript-eslint/no-unnecessary-condition',
        '@typescript-eslint/no-unnecessary-type-assertion',
        '@typescript-eslint/no-unnecessary-type-conversion',
        '@typescript-eslint/no-unnecessary-type-parameters',
        '@typescript-eslint/no-unsafe-argument',
        '@typescript-eslint/no-unsafe-assignment',
        '@typescript-eslint/no-unsafe-call',
        '@typescript-eslint/no-unsafe-member-access',
        '@typescript-eslint/no-unsafe-return',
        '@typescript-eslint/no-unsafe-type-assertion',
        '@typescript-eslint/no-unused-vars',
        '@typescript-eslint/no-use-before-define',
        '@typescript-eslint/parameter-properties',
        '@typescript-eslint/prefer-find',
        '@typescript-eslint/prefer-for-of',
        '@typescript-eslint/prefer-nullish-coalescing',
        '@typescript-eslint/prefer-optional-chain',
        '@typescript-eslint/prefer-promise-reject-errors',
        '@typescript-eslint/prefer-string-starts-ends-with',
        '@typescript-eslint/require-array-sort-compare',
        '@typescript-eslint/require-await',
        '@typescript-eslint/restrict-plus-operands',
        '@typescript-eslint/restrict-template-expressions',
        '@typescript-eslint/strict-boolean-expressions',
        '@typescript-eslint/strict-void-return',
        '@typescript-eslint/switch-exhaustiveness-check',
        '@typescript-eslint/unbound-method',
        '@typescript-eslint/use-unknown-in-catch-callback-variable',
        'array-callback-return',
        'eqeqeq',
        'no-console',
        'no-labels',
        'no-multi-assign',
        'no-new-func',
        'no-param-reassign',
        'no-promise-executor-return',
        'no-script-url',
        'no-sequences',
        'no-template-curly-in-string',
        'no-unmodified-loop-condition',
        'prefer-const',
        'radix',
      ].map(rule => [rule, 'off']),
    ),
  },
)

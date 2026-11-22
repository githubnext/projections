# Linting

ESLint is the only linter (`eslint.config.js`); oxfmt formats, so no rule here
is about layout. The configuration is strict: typescript-eslint's
`strictTypeChecked` and `stylisticTypeChecked` presets, more of its rules, and
the core rules that find bugs, and
[eslint-plugin-regexp](https://ota-meshi.github.io/eslint-plugin-regexp/)'s
recommended rules with the `u` flag required. A rule is off only for a reason
recorded below, never because fixing its violations is work.

## How it runs

`npm run lint` (`tools/scripts/lint.mjs`) runs ESLint once per workspace and
once more for the files outside every workspace, one at a time locally and two
at a time in CI (`--jobs <n>` overrides it). Type-aware rules load a TypeScript
program for each tsconfig they meet and keep it, so a single process over the
whole repository holds every workspace's program at once and runs out of memory;
a process per workspace holds one. Arguments pass through to ESLint
(`npm run lint -- --fix`), and `TIMING=10` prints each process's slowest rules,
as CI does.

Type information comes from each workspace's dependencies' built declarations
(`dist`), so lint runs after the build, like the typecheck. `tools check --fast`
lints only the changed files, and those in a workspace only when its
dependencies' `dist` is current; `tools check --affected` lints the changed and
dependent workspaces. Type-aware results can change when another file changes,
so lint runs without `--cache`.

Vendored code isn't linted as authored code: the shadcn/ui components in
`packages/host/core/src/ui/components` that have a pristine base in `upstream/`
must stay reproducible from it (`test/shadcn.test.mjs`).

## Every TypeScript file has a tsconfig.json

The rules find a file's types through its nearest `tsconfig.json`, as editors
do. A workspace's `tsconfig.json` covers `src`; its Playwright specs have
`browser/tsconfig.json` and its typed tests `test/tsconfig.json`, and its
`typecheck` script checks each. A new directory of TypeScript outside `src` gets
its own `tsconfig.json` and a place in `typecheck`. The few configuration files
beside a workspace's `tsconfig.json` (`playwright.config.ts`, a
`vite.config.ts`, hand-written `.d.mts`) are listed in `allowDefaultProject`.

JavaScript files (`.mjs`, `.js`, `.cjs`) get every rule except the type-aware
ones: without annotations those only report `any`. Converting a script or test
to TypeScript (Node runs `.ts` directly) brings it under them.

## Tuned rules

Each option allows one defined idiom and nothing else.

| Rule                            | Option                                        | Why                                                                                                                                         |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `restrict-template-expressions` | `allowNumber`                                 | A number's string form is defined; objects, nullish values, `any` and booleans still fail.                                                  |
| `no-confusing-void-expression`  | `ignoreArrowShorthand`                        | `onClick={() => setOpen(true)}` returns nothing anyone reads.                                                                               |
| `no-floating-promises`          | node:test's `test`, `describe` and hooks      | The runner awaits them.                                                                                                                     |
| `prefer-promise-reject-errors`  | `allowThrowingUnknown`                        | Passing on a rejection or abort reason unchanged, as `only-throw-error` allows rethrowing; `any` and non-`Error` values still fail.         |
| `strict-boolean-expressions`    | `allowNullableString`, `allowNullableBoolean` | `if (name)` on `string \| undefined` means missing or empty on purpose. Nullable numbers (the `0` bug), objects and `any` still fail.       |
| `no-use-before-define`          | not functions, classes or types               | Hoisted helpers below their first use are this codebase's file layout; variables still can't be read before they're declared.               |
| `class-methods-use-this`        | not interface implementations or overrides    | The interface decides the method is an instance method.                                                                                     |
| `curly`                         | `multi-line`                                  | Braces are required when the body is on its own line, where a second statement can hide; one-line guards (`if (!x) return`) can't hide one. |
| `no-console`                    | shipped `src` only                            | CLIs, scripts and tests print by design.                                                                                                    |
| `no-implicit-coercion`          | allows `!!`                                   | `!!value` narrows `value` in TypeScript; `Boolean(value)` doesn't, so its fix breaks type checking.                                         |

## Rules that stay off

- `explicit-function-return-type`, `explicit-module-boundary-types`: they
  restate what TypeScript infers. `isolatedDeclarations` is the compiler's way
  to pin exported signatures, if a package needs that.
- `naming-convention`: names come from JSON Schema, the renderer protocol, YAML,
  CSS and data attributes, so a configuration would be a list of exceptions.
- `no-await-in-loop`: the loops that await do so on purpose (polling, ordered
  steps on one browser driver, ordered module resolution); running them in
  parallel would be the bug.
- `require-atomic-updates`: prone to false positives, by ESLint's own account.
- `promise-function-async`: its fix changes behaviour. An `async` wrapper
  returns a new promise on every call, so a function that hands out one cached
  promise per key stops doing so, and synchronous throws become rejections. In
  `.tsx` it also takes every component for an async function, because React 19's
  `ReactNode` includes `Promise`. `no-floating-promises` and
  `no-misused-promises` catch the promise bugs that matter.
- Style without a bug class: `no-plusplus`, `no-nested-ternary`,
  `no-negated-condition`, `prefer-destructuring`, `prefer-named-capture-group`.
- `no-template-curly-in-string`, in the few tests whose strings are GitHub
  Actions expressions (`${{ … }}`) or prose about template literals: the
  literal `${` is what they check.

## Rules of our own

- `considered/regex-backtick` (`tools/scripts/considered-rule.mjs`): a backtick
  in a regular expression literal is written `\x60`. Considered's scc provider
  reads a bare one as the start of a template string and stops counting the
  file, so its size and complexity limits would quietly not apply.

## Turning on a rule

A rule this configuration turns on whose existing violations aren't fixed yet is
listed at the end of `eslint.config.js` as `off`. The change that fixes the last
of a rule's violations removes it from the list; nothing is added to it. A new
rule goes in on, with its violations fixed in the same change.

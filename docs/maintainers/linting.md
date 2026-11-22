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

| Rule                                    | Option                                        | Why                                                                                                                                             |
| --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `restrict-template-expressions`         | `allowNumber`                                 | A number's string form is defined; objects, nullish values, `any` and booleans still fail.                                                      |
| `no-confusing-void-expression`          | `ignoreArrowShorthand`                        | `onClick={() => setOpen(true)}` returns nothing anyone reads.                                                                                   |
| `no-floating-promises`                  | node:test's `test`, `describe` and hooks      | The runner awaits them.                                                                                                                         |
| `prefer-promise-reject-errors`          | `allowThrowingUnknown`                        | Passing on a rejection or abort reason unchanged, as `only-throw-error` allows rethrowing; `any` and non-`Error` values still fail.             |
| `strict-boolean-expressions`            | `allowNullableString`, `allowNullableBoolean` | `if (name)` on `string \| undefined` means missing or empty on purpose. Nullable numbers (the `0` bug), objects and `any` still fail.           |
| `no-use-before-define`                  | not functions, classes or types               | Hoisted helpers below their first use are this codebase's file layout; variables still can't be read before they're declared.                   |
| `class-methods-use-this`                | not interface implementations or overrides    | The interface decides the method is an instance method.                                                                                         |
| `curly`                                 | `multi-line`                                  | Braces are required when the body is on its own line, where a second statement can hide; one-line guards (`if (!x) return`) can't hide one.     |
| `no-console`                            | shipped `src` only                            | CLIs, scripts and tests print by design.                                                                                                        |
| `no-implicit-coercion`                  | allows `!!`                                   | `!!value` narrows `value` in TypeScript; `Boolean(value)` doesn't, so its fix breaks type checking.                                             |
| `jsx-a11y/no-noninteractive-tabindex`   | `tabpanel`, `separator` and `region` roles    | ARIA's patterns focus a tab panel, a window splitter and a scrollable region (`role="region"` with a name), whose content the keyboard scrolls. |
| `jsx-a11y/no-autofocus`                 | `ignoreNonDOM`                                | A component's `autoFocus` prop is its own API, such as the projections pane taking focus when asked to; the DOM attribute still fails.          |
| `jsx-a11y/control-has-associated-label` | `depth: 4`                                    | A table header's or button's text may be a few elements in (`<th><button><code>{name}</code></button></th>`).                                   |

## React

The React workspaces (the hosts, the renderers, the kit and SDK, Storybook) get
three plugins, every rule an error:

- `eslint-plugin-react-hooks`, its `recommended-latest` set: the Rules of Hooks,
  `exhaustive-deps` and the React Compiler's rules. `refs` keeps `ref.current`
  out of render, `set-state-in-effect` keeps effects from rendering twice to
  derive state, `immutability` and `purity` keep render pure, and
  `preserve-manual-memoization` keeps `useMemo` and `useCallback` honest. A
  lifecycle these push out of effects and refs becomes a state machine
  ([the guide](../guides/state-machines.md)).
- `@eslint-react/eslint-plugin`, chosen rules that find what the React
  Compiler's don't: `no-leaked-conditional-rendering` (a `0` rendered by
  `count && …`), `no-unstable-context-value` and `no-unstable-default-props` (a
  new object on every render), `no-array-index-key`,
  `web-api-no-leaked-event-listener` and `web-api-no-leaked-timeout`,
  `dom-no-flush-sync`, and the APIs React 19 replaces: `no-context-provider`,
  `no-forward-ref` and `no-use-context`. Not its `naming-convention-*` rules (as
  below), nor its `exhaustive-deps`, `set-state-in-effect` and other rules that
  repeat `react-hooks`. The extractors are outside it: they aren't React, and
  NestJS has a `forwardRef` of its own.
- `eslint-plugin-jsx-a11y`, its `strict` set, on every `.tsx`, and
  `control-has-associated-label` (off in `strict`) with `strict`'s options,
  three tuned above: a control is a real element or has its role, keyboard
  support and a name. Its deprecated rules (`label-has-for`, `accessible-emoji`,
  `no-onchange`) stay off. Its peer range stops at ESLint 9 though it runs on
  10, so an `overrides` entry in `package.json` gives it the workspace's ESLint.

Lists whose items have no id of their own (text runs, lines, diagnostics) key
them with the renderer SDK's `keyed`, not their index. A container that only
catches what its controls bubble (a row that is a click target as wide as its
card, Escape anywhere in a panel) is `role="presentation"`, and the controls in
it carry the keyboard.

## Imports

`eslint-plugin-import-x` checks imports between modules and packages. It
resolves them with `eslint-import-resolver-typescript`, through each workspace's
`tsconfig.json` (and its `browser/` and `test/` ones), as TypeScript does.

| Rule                         | Option                                                        | Why                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-cycle`                   | `ignoreExternal`; type-only imports don't count (its default) | A cycle of values makes one module read another before it has evaluated. Type-only imports are erased, so they can't; packages in `node_modules` aren't followed.       |
| `no-duplicates`              | `prefer-inline`                                               | One import per module, its types inline (`import {value, type Shape}`), as `consistent-type-imports` writes them.                                                       |
| `no-extraneous-dependencies` | development dependencies outside shipped `src`                | A workspace declares what it imports. Shipped `src` uses only dependencies and peer dependencies; tests, specs, scripts and configuration may use development ones too. |

Two arrangements change what `no-extraneous-dependencies` allows. Workspaces
that bundle their build declare what they bundle as development dependencies,
and their `src` imports it: the SDK (`packages/sdk`) bundles the internal
workspaces, the VS Code extension everything but `vscode` (which the VS Code
host provides, so it is a core module here), and the TypeScript helper replaces
`typescript` with the examined repository's own. The renderers' and the kit's
browser suites run in the renderer harness, so they may import what it declares
too, as `npm run check:boundaries` allows.

`no-self-import`, `no-useless-path-segments`, `no-mutable-exports` and `first`
take no options.

Left out:

- `no-unresolved`, `named`, `namespace`, `default`, `export` and the other rules
  that check what an import resolves to: TypeScript reports the same, with the
  resolution the build uses, and a script or test in JavaScript fails on its
  first run.
- `no-default-export`: configuration files (Vite, Playwright, tsdown, ESLint)
  and Storybook stories must default-export.

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
  Actions expressions (`${{ … }}`) or prose about template literals: the literal
  `${` is what they check.

## Rules of our own

- `considered/regex-backtick` (`tools/scripts/considered-rule.mjs`): a backtick
  in a regular expression literal is written `\x60`. Considered's scc provider
  reads a bare one as the start of a template string and stops counting the
  file, so its size and complexity limits would quietly not apply.

## eslint-plugin-unicorn

Most of `eslint-plugin-unicorn` is one author's style, so none of its presets
are on. These of its rules are, each for a bug class:

- Mutation: `no-array-sort` and `no-array-reverse` (an expression's
  `.sort()`/`.reverse()` also changes the array it was called on; use
  `toSorted()`/`toReversed()`, which is why every `lib` is ES2023 or later).
- Coercion and lost types: `prefer-number-properties` (the global `isNaN` and
  `isFinite` coerce, `Number.isNaN` and `Number.isFinite` don't),
  `prefer-string-replace-all` (`replace` with a string replaces only the first
  match), `require-array-join-separator`, `prefer-type-error`,
  `throw-new-error`, `error-message`, `new-for-builtins`, `no-new-array`,
  `no-instanceof-builtins`, `no-typeof-undefined`,
  `text-encoding-identifier-case`, `prefer-structured-clone` (a JSON round trip
  drops `undefined`, `Date`s, `Map`s and `Set`s).
- Platform: `prefer-node-protocol`, `prefer-global-this`,
  `prefer-add-event-listener` (an `onX =` assignment replaces whoever else
  listens), `no-invalid-remove-event-listener`, and in shipped source
  `prefer-dom-node-text-content` (`innerText` lays the page out to read it;
  browser tests read the rendered text with it on purpose).
- Promises: `no-unnecessary-await`, `no-await-in-promise-methods`,
  `no-single-promise-in-promise-methods`, `no-useless-promise-resolve-reject`.
- Clearer equivalents that remove a way to get it wrong: `prefer-set-has`,
  `prefer-array-find`, `prefer-array-some`, `prefer-array-flat-map`,
  `prefer-array-index-of`, `prefer-includes`, `prefer-regexp-test`, `prefer-at`,
  `no-useless-spread`, `no-useless-fallback-in-spread`,
  `no-useless-switch-case`, `consistent-assert`, `prefer-export-from` (with
  `checkUsedVariables: false`, so a module that uses what it re-exports keeps
  its import).

Its stylistic rules stay off, among them `no-null` (`null` is JSON's and
React's), `no-array-reduce`, `no-array-callback-reference`,
`consistent-function-scoping`, `explicit-length-check`,
`no-await-expression-member`, `prevent-abbreviations`, `filename-case`,
`max-nested-calls` and the comment-style rules, which would rewrite the TSDoc
that `check:tsdoc` reads.

`require-post-message-target-origin` stays off too: it can't tell a window's
`postMessage` from a worker's, a `MessagePort`'s or a VS Code webview's, and
every call it reports here is one of those, where a second argument is a
transfer list, not an origin. The posts to windows already name their origin.

## Turning on a rule

A new rule goes in on, with its violations fixed in the same change. Where a
rule's existing violations need fixing by hand, one at a time, it goes in on
with them recorded in `eslint-suppressions.json` (ESLint's bulk suppressions):
each file's count of each rule's violations, which ESLint lets stand while
reporting any more. The file only shrinks. A count higher than a file's
violations fails the lint, so the change that fixes one also lowers its count:
`npm run lint -- --prune-suppressions`. Nothing is added to it by hand, and a
new file never appears in it. ESLint writes it in its own layout, so oxfmt
leaves it alone.

Two rules are suppressed this way, each for the hand work its violations need:

- `no-non-null-assertion` (`!`): most mark an index or lookup the code knows is
  there; each becomes a check that says what happens when it isn't, or a type
  that holds it.
- `no-unsafe-type-assertion` (`as` that narrows): most read JSON, messages or
  DOM values; each becomes a parse or a type guard where the value enters.

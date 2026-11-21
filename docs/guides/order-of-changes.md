# Control the order of changes

Suppose your monorepo's _Package dependencies_ projection uses the built-in
`workspace-dependencies` extractor and the generic `dag` renderer. When a pull
request touches dozens of packages, you want reviewers to see the most widely
depended-on packages first.

## Use configuration first

You don't need custom rules for common ordering tweaks. Configure the default
comparator directly in your projection definition:

```json
{
  "id": "dependencies",
  "title": "Package dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dag",
  "comparator": {
    "order": { "by": "dependents", "direction": "descending" }
  }
}
```

## Write a custom comparator for domain-specific logic

If you're curious what else comparators can do—like domain verdicts, API
compatibility levels, and detecting moved components—see
[Custom comparators: what they make possible](comparators.md).

When the right review order depends on knowledge only your team has—such as a
curated list of core platform packages that should always come first—reach for a
custom comparator.

A custom comparator lives in a comparator file (`<name>.comparator.yaml`) made
of YAML declarations layered on top of the default comparator. The default
comparator always runs first, and your file adds what only your domain knows:

- **`identity`** links items the default matcher couldn't pair, including
  renames, moves, splits, and merges.
- **`classify`** attaches a summary sentence and optional annotations to each
  change.
- **`steps`** controls ordering declaratively—either ranking steps or gathering
  matching changes into a new step.
- **`metadata`** records verdicts and counts that renderers or CI workflows can
  consume.

Expressions use [CEL](https://cel.dev), the same expression language behind
Kubernetes admission policies: small, side-effect free, and guaranteed to
terminate. Because comparator files are data rather than code, they run
sandboxed everywhere comparisons are viewed, behave identically on every
machine, and never require `--trust`.

### Write a custom comparator

This comparator file pulls any step touching your priority platform packages to
the front:

```yaml
# .github/projections/dependencies/priority.comparator.yaml
format: projections.comparator
version: 0
description: Steps that change the packages in options.priority come first, most important first.

variables:
  - name: priority
    expression: 'has(options.priority) && options.priority != null ? options.priority : []'

steps:
  # A change ranks at its position in the list; a step ranks by its best change,
  # and steps that change none of them keep their order after the others.
  rank: lists.range(size(variables.priority)).filter(i, variables.priority[i] == change.id)
```

```json
{
  "id": "dependencies",
  "title": "Package dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dag",
  "comparator": {
    "file": ".github/projections/dependencies/priority.comparator.yaml",
    "options": { "priority": ["workspace:@acme/core", "workspace:@acme/auth", "workspace:@acme/ui"] }
  }
}
```

If you don't need `options`, pass the file path as a string instead:
`"comparator": ".github/projections/dependencies/priority.comparator.yaml"`.
Comparator files must end in `.comparator.yaml` (or `.yml`), and any object
without `file` configures the default comparator. To scaffold a commented
starter (`<id>.comparator.yaml`) along with its test file, run
`projections init <id> --comparator custom`. There is nothing to build or
install:

- **Editor support:** In VS Code, the Projections extension adds semantic
  highlighting for CEL inside `*.comparator.yaml` files, surfaces type errors
  and lint warnings inline as you type, and provides hover docs and
  context-aware completions
  ([Editing comparator files](../design/declarative-comparators.md#editing-comparator-files)).
  With the YAML extension installed, it also validates comparator files and
  `*.comparator.test.yaml` files offline against bundled schemas and lists your
  tests in the Testing view. In other editors, add
  `# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator/v0.json`
  at the top of the file.
- **Load-time checking:** Comparator files are type-checked when loaded, so
  unknown fields, unknown functions, bad arguments, and type mismatches are all
  reported at once with line and column numbers. Running
  `projections check -p <id>` reports the same diagnostics.
- **Inputs and standard library:** Every expression can read `before`, `after`,
  `options`, and `baseline` (the default comparison), and individual sections
  expose extra bindings like `change` in `steps` and `classify`. Define shared
  values in `variables` (referenced as `variables.<name>`) and reusable typed
  helpers in `functions`. The built-in standard library covers graph traversal
  (`graph.parents`, `graph.entity`), ID sorting (`ids.sort`), maps, findings,
  and formatting code in prose (`prose.code`).
- **Step ordering:** Steps keep their default order unless you adjust them.
  `rank` stably sorts steps by their highest-ranked change, while `add` pulls
  changes matching a predicate into a new step (removing them from earlier steps
  and dropping any step left empty).
- **Sandboxed and semantic:** Evaluation runs in a memory-capped sandbox under a
  machine-independent cost budget. A comparator's identity hashes its meaning
  rather than its formatting, so editing a comment never changes its digest.

See the [comparator file schema](../reference/schemas/comparator.md) for every
field, and [Custom comparators](../design/declarative-comparators.md) for the
full reference on sections, inputs, types, standard library helpers, and the
cost budget.

### Test a custom comparator

Write tests in a sibling file right next to your comparator—for example,
`priority.comparator.test.yaml` beside `priority.comparator.yaml`. Each case
supplies two extractions and states what the resulting comparison should look
like, with no test code to write and only the `projections` CLI required:

```yaml
# .github/projections/dependencies/priority.comparator.test.yaml
format: projections.comparator-tests
version: 0
options: {priority: ['workspace:@acme/core']}

cases:
  - name: core changes are reviewed first
    before: fixtures/before.json # extractions saved beside the test file
    after: fixtures/after.json
    expect:
      order: ['workspace:@acme/core', 'workspace:@acme/docs']
      changes:
        - {item: 'workspace:@acme/core', status: modified}
      count: {steps: 3}
    snapshot: snapshots/core-first.json

  - name: this branch, against main
    before: {revision: main}
    after: {revision: working-tree}
    expect:
      order: ['workspace:@acme/core', 'workspace:@acme/web']
```

- `before` and `after` can point to a fixture file (either a raw extraction or a
  document saved by `projections show --json`), embed an extraction inline
  (`{extraction: {...}}`), or extract the projection at a Git revision
  (`{revision: main}`, `{revision: working-tree}`) using the working tree's
  definition.
- Expectations are partial, so you only assert what matters: `order` (each item
  or change appears in an earlier step than the next), `steps` (exact step
  sequence with only the fields you list), `changes` (individual changes matched
  by `item` or `id`), `count`, a subset of `metadata`, or an expected `error`.
  Case-level `options` override file-level options; if neither is set, the
  projection's own options apply.
- `snapshot` saves the full comparison to a JSON file. Prefer targeted
  expectations to document intent, and use snapshots as a safety net for
  everything else.

Run `projections check -p dependencies --no-render` to execute your test cases
inside the same sandbox viewers use; any failure points to the exact line and
column along with the expected value and a diff. When you intentionally change
behavior, `projections check --update` creates or refreshes snapshots without
ever touching your written expectations.

Run `projections check -p dependencies --no-render --coverage` to inspect
[rule coverage](../contracts/comparisons.md#rule-coverage): it lists every
function, expression, and branch outcome your test cases never hit, by line
number, so you can add a missing case or trim dead branches. Editors can also
discover and run cases through `projections serve --stdio`
([the API](../runner/stdio-backend.md#comparator-tests)). Test files never
affect a comparator's identity, and hosts never read them.

### Where heavy logic goes

Comparator files handle everything built into this repository, from tracking
moved components to checking API compatibility across four ecosystems. When
logic genuinely needs a compiler, parser, or dependency resolver, put it where
that toolchain lives:

- **In the extractor**, computed per revision and saved in `data` using your own
  toolchain—for example, whether one type is assignable to another, or a
  package's resolved version. The comparator then simply compares those facts.
- **In the engine**, as a standard library operation, when the logic is generic
  and useful across multiple comparators. See
  [Contributing an operation](../../packages/comparators/rules/README.md#contributing-an-operation).

The `dag` renderer doesn't know anything about your platform packages. It simply
walks through the steps in the order your comparator chose—and every other
renderer, including the text summary, does the exact same thing.

## Rules every comparison must follow

Before rendering any comparison, Projections validates it against both
extractions:

- Every entity or relationship referenced by a change must exist in the
  extraction it names.
- Every change must belong to exactly one step, except a change that consists
  solely of [volatile](how-it-works.md#volatile-data) variation within
  tolerance, which belongs to no step.
- Each change's status must match the underlying extractions—an entity can't be
  marked unchanged if its data differs beyond declared variation, and any
  variation within tolerance must still be recorded.

When a viewer plays a comparison backward, Projections reverses the steps;
comparisons from custom comparators always play backward as the mirror of their
steps.

Finally, a comparison only describes and orders changes. Layout positions,
colors, and timing belong strictly to renderers.

---

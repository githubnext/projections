# Control the order of changes

Suppose your monorepo's _Package dependencies_ projection uses the built-in
`workspace-dependencies` extractor and the generic `dag` renderer. When a pull
request touches many packages, you want the most widely used package to appear
first.

## Use configuration first

Common ordering needs don't require code. Configure the default comparator in
the projection definition:

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

[Custom comparators: what they make possible](comparators.md) shows what else a
comparator can do with real examples: domain verdicts, compatibility levels and
recognizing moved items.

When the order depends on knowledge only your team has—for example, a list of
platform packages that should always be reviewed first—write a custom
comparator.

A custom comparator is a comparator file, `<name>.comparator.yaml`: YAML
declarations, its comparator rules, over the default comparator. The default
comparator always runs first; the comparator file adds what only your domain
knows:

- **`identity`** pairs items the default matching left unmatched: renames,
  moves, splits and merges;
- **`classify`** writes a sentence, and any annotation, per change;
- **`steps`** orders the changes, with declarative operations: rank them, or
  gather some into a new step;
- **`metadata`** adds verdicts and counts a renderer or a workflow reads.

Expressions are [CEL](https://cel.dev), the expression language of Kubernetes
admission policies: small, side-effect free and always terminating. Comparator
files are data, not code, so they run sandboxed wherever comparisons are viewed,
the same everywhere, and never need `--trust`.

### Write a custom comparator

This comparator file moves steps that change platform packages to the front:

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

Without options, name the file alone:
`"comparator": ".github/projections/dependencies/priority.comparator.yaml"`.
Comparator files must end in `.comparator.yaml` (or `.yml`); an object without
`file` is the default comparator. `projections init <id> --comparator custom`
scaffolds a commented starter, `<id>.comparator.yaml`, and its tests. There is
nothing to build or install:

- In VS Code, the Projections extension highlights the CEL in
  `*.comparator.yaml` files by what each name is, reports the checker's errors
  and lint warnings as you type, at their line and column, and shows signatures,
  types and documentation on hover and completions in context
  ([Editing comparator files](../design/declarative-comparators.md#editing-comparator-files)).
  It validates comparator files and their `*.comparator.test.yaml` tests offline
  against its bundled schemas (with the YAML extension installed), and lists the
  tests in the Testing view. In other editors, put
  `# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator/v0.json`
  at the top.
- Comparator files are checked when they load: an unknown field or function, a
  call with the wrong arguments, or operands of the wrong type are reported with
  their line and column, all at once. `projections check -p <id>` reports them
  too.
- Expressions see `before` and `after`, the two extractions, `options` and
  `baseline`, the default comparison; each section adds its own, such as
  `change` in `steps` and `classify`. `variables` name values once
  (`variables.<name>`), and `functions` name typed, reusable expressions. A
  standard library covers graph navigation (`graph.parents`, `graph.entity`), ID
  order (`ids.sort`), maps, findings and quoting text as code (`prose.code`).
- Steps keep the default order unless the comparator changes it: `rank` sorts
  steps by their best-ranked change, stably, and `add` gathers the changes a
  predicate selects into a new step. The engine moves them out of other steps
  and drops steps left empty.
- Evaluation is bounded by a cost budget that is the same on every machine, and
  runs in a sandbox with memory limits. The comparator's identity covers the
  file's meaning, not its layout: editing a comment doesn't change it.

The [comparator file schema](../reference/schemas/comparator.md) lists every
field, and [Custom comparators](../design/declarative-comparators.md) is the
full reference: sections, inputs, types, the standard library and how the cost
budget works.

### Test a custom comparator

Say what the comparator must do in a test file beside it:
`priority.comparator.test.yaml` for `priority.comparator.yaml`. Each case gives
two extractions and what the comparison of them must be. There is no code to
write, and nothing but the `projections` CLI to run:

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

- `before` and `after` are a fixture file (an extraction, or a document
  `projections show --json` saved), an extraction written inline
  (`{extraction: {...}}`), or the projection extracted at a revision
  (`{revision: main}`, `{revision: working-tree}`) with the working tree's
  definition.
- Expectations are partial: `order` (each item or change is in an earlier step
  than the next), `steps` (every step, in order, with the fields you list),
  `changes` (one change each, selected by `item` or `id`), `count`, a subset of
  `metadata`, or the `error` the comparator must fail with. A case's `options`
  replace the file's; without either, the projection's own.
- `snapshot` keeps the whole comparison in a JSON file. Prefer expectations that
  say what you mean; a snapshot catches everything else.

`projections check -p dependencies --no-render` runs the cases with the other
checks, in the sandbox viewers use, and fails when one fails, with its line and
column, the expectation and a diff. `projections check --update` writes
snapshots, or rewrites them after a change you meant; it never edits
expectations. `projections check -p dependencies --no-render --coverage` also
reports [rule coverage](../contracts/comparisons.md#rule-coverage): the
functions, expressions and each outcome of each decision the cases never ran, by
line, so you can see which rules no case pins. Add a case for each, or remove a
branch nothing can take. Editors list and run the cases through
`projections serve --stdio`
([the API](../runner/stdio-backend.md#comparator-tests)), for a test view. Tests
never change the comparator's identity, and hosts never read them.

### Where heavy logic goes

Comparator files can do what every comparator in this repository does, from
moved components to API compatibility across four ecosystems. Logic that needs a
compiler, a parser or a resolver belongs elsewhere:

- **In the extractor**, computed per revision into `data`, in your own
  toolchain: whether a type is assignable to another, a package's resolved
  version. The comparator then compares facts.
- **In the engine**, as a standard library operation, when it is generic and
  more than one comparator needs it.
  [Contributing an operation](../../packages/comparators/rules/README.md#contributing-an-operation)
  explains how.

The `dag` renderer knows nothing about your platform packages. It simply
presents the comparison's steps in the order your comparator chose, and so does
every other renderer, including the text summary.

## Rules every comparison must follow

Projections validates each comparison against both extractions before rendering
it:

- every entity or relationship a change refers to must exist in the extraction
  it names;
- every change must appear in exactly one step, except a change that is only
  [volatile](how-it-works.md#volatile-data) variation within tolerance, which
  appears in none;
- a change's status must be consistent with the extractions—an entity can't be
  reported as unchanged if its data differs beyond its declared variation, and
  variation within tolerance must still be listed.

When a comparison is played backward, Projections presents its steps in reverse
order. Comparisons made by custom comparators always play backward as the mirror
of their steps.

A comparison describes and orders changes. It never contains positions, colors
or timing; those belong to renderers.

---

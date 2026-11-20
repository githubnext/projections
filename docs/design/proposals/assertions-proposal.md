# Proposal: assertions

Status: **Proposal, shelved; not planned for implementation.** New users already
have three concepts to learn (extractor, comparator, renderer), and adding a
fourth would cost more in mental overhead than it pays back today. Still, the
idea is strong enough to keep on record for when that balance shifts.

An assertion states a rule that must hold for a codebase as a whole, not just
for a diff. Rules like "renderers do no I/O" or "the open-source product never
depends on the hosted site" are true or false of a single revision regardless of
whether a pull request touched those files. Because of that, assertions evaluate
a single revision's extraction document rather than a comparison, and they don't
belong inside comparators.

This proposal narrows one piece of the broader
[structural verification](verification-proposal.md) proposal and supersedes an
earlier comparator-bound draft.

## The model

| Part       | Judges                      | Example                                 |
| ---------- | --------------------------- | --------------------------------------- |
| Extractor  | Nothing: produces facts     | `npm-package` entities and dependencies |
| Assertion  | One state                   | "This is never allowed."                |
| Comparator | A change between two states | "This change introduces that."          |
| Renderer   | Nothing: shows either       | A graph, a schema, a table              |

Assertions sit cleanly between extraction and comparison. The extractor gathers
facts about a single state, assertions check whether that state obeys the rules,
the comparator explains what changed between two states, and the renderer draws
either one.

Our earlier draft tucked assertions into the comparator file simply because
comparators already had a rule engine. That blurred the layers: a rule about one
revision had to be disguised as a rule about a change, and it couldn't run
unless there was a change to compare.

## Motivation

This repository projects itself via the self-topology projection
(`.github/projections/self-topology*` and its comparator
`self-topology.comparator.yaml`). Its rules fall into two groups:

- **Ratchets** ("don't introduce"). These already work as a comparator
  `classify` step: anything that breaks a rule on the After side but not the
  Before side is flagged as introduced, and CI can gate on
  `metadata.topologyRules.counts.introduced` with `jq`.
- **Invariants** ("never"). Today there is no single-revision check.
  `projections check` compares `HEAD` against the working tree, so a clean
  working tree runs no rules at all. Putting comparator `checks:` on `after`
  fails the entire comparison with an error instead of reporting a finding on a
  specific item.

The comparator works around this by stuffing a `violations` list over `after`
into its metadata, but that still only runs during a comparison and has to be
written in terms of before/after sides rather than state.

## Sketch

### A part of its own

Assertions would live in their own `*.assertions.yaml` file alongside the
extractor, comparator, and renderer.

One open question is ownership: should an assertions file belong to a single
projection, or bind to a domain model (like `architecture/v0`) so any projection
sharing that shape can reuse it?

### Rule language

Assertions would reuse the same sandboxed CEL rules engine that comparators run
(`rules.wasm`), keeping evaluation deterministic and cost-metered. Each rule
specifies:

- an `id`
- a `description`
- `over`: `entities`, `relationships`, or the whole `document`
- `where`: which items the rule applies to
- `assert`: the condition that must hold for each matched item
- a `level`: `error` or `warning`
- a `message` evaluated for each violating item

Here is how "renderers stay pure" would look:

```yaml
format: projections.assertions
version: 0
assertions:
  - id: renderers-stay-pure
    description: Renderers do no filesystem, process or network I/O.
    over: entities
    where: >-
      item.kind == 'npm-package' &&
      item.data.?path.orValue('').startsWith('packages/renderers/')
    assert: >-
      !item.data.?capabilities.orValue([]).exists(c, c in ['fs', 'network',
      'process'])
    level: error
    message: >-
      'renderer ' + prose.code(item.id) + ' uses ' +
      item.data.capabilities.filter(c, c in ['fs', 'network',
      'process']).join(', ')
```

### Facts come from the extractor

Anything that requires a parser or compiler stays in the extractor; assertions
only inspect the extracted document. Facts are keyed by modules or logical
units, never by file lines. Files and line numbers belong in evidence, which
comparisons ignore, so moving code around doesn't spuriously create or clear a
violation.

### Graph assertions

Checking one item at a time isn't enough for every rule. Whole-document
assertions need graph helpers like reachability and cycle detection ("no path
from A to B", "no cycles among crates"), and their violations won't always point
to a single item.

### Existing debt

When a team adopts a new invariant, it usually starts with existing violations.
Rather than falling back to a `warning` level that everyone learns to ignore, we
could follow considered's model (`.considered.yaml`): strict standards paired
with recorded exceptions. Each exception names the item, explains why it exists,
and caps it at its current value so debt can shrink but never grow.

## Worked examples

These concrete rules help stress-test the design:

- **Renderers never depend on the CLI.** Evaluated over relationships: no
  non-`contains` relationship from a `renderers` area entity to a `cli` entity
  (per item).
- **Renderers do no I/O.** Evaluated over entities, as shown above (per item).
- **No `serde_json` outside the engine's boundary modules.** Evaluated over the
  engine crate's modules. Today this has real debt (5 modules), making it a good
  test for recorded exceptions.
- **No dependency cycles between crates.** Evaluated over the whole document
  using a cycle function; the violation is the cycle itself rather than one
  item.
- **Every public HTTP route has auth.** From the t3code exploration: evaluated
  over route entities, requiring an auth relationship or attribute. This
  illustrates the split in responsibility — the extractor emits whether a route
  is authenticated, and the assertion judges it.

## Surfaces

### In the picture

Violations reach the renderer as item annotations. The protocol already supports
annotations with tones, and the shared kit renders them consistently alongside
change badges, so renderers don't have to invent anything new.

Because violations describe the final state rather than a diff, they remain
visible after a comparison animation finishes and don't compete with diff
emphasis.

### Around the picture

Hosts surface violations in three places:

- a count in the summary bar ("2 rule violations") that filters the view to
  violating items
- the rules broken by the selected item, with their messages, inside the detail
  card
- a dedicated list for whole-document violations that don't belong to a single
  item, like a dependency cycle or a missing requirement

### Outside the view

- `projections check` output and exit status for CI
- the GitHub Action as a merge gate
- in VS Code, the sidebar's Checks section and possibly the Problems panel,
  linking back to the item
- the agent tools (`check`, `current_view`)

### Comparisons

Evaluating assertions on both sides of a comparison gives us introduced and
resolved violations for free. In a comparison view, only newly introduced
violations are emphasized while pre-existing ones stay muted — replacing the
hand-rolled ratchet logic in today's self-topology comparator.

## Open questions

- **Ownership.** Should an assertions file belong to one projection, or to a
  domain model that any matching projection can reuse?
- **A fourth concept.** Should assertions be a fourth top-level concept next to
  extractor, comparator, and renderer, or live inside an existing one? That
  extra conceptual weight is the main trade-off we are weighing.
- **Exceptions.** What format should record existing debt, and where should it
  live?
- **Performance.** Graph assertions on large extractions need bounds, much like
  the cost metering that bounds comparator rules today.
- **Authoring and testing.** How should agents write and test assertions? A
  `*.assertions.test.yaml` format, mirroring comparator tests, is the natural
  starting point.

## Not in scope

Implementation and code changes. This document simply records the design;
nothing here is scheduled.

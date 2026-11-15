# Proposal: assertions

Status: **Proposal, shelved; not planned for implementation.** The current
concepts (extractor, comparator, renderer) are enough for new users to learn,
and a fourth would cost more than it returns today. Assertions still look
promising, so this document records the idea for when that balance changes.

An assertion is a necessary fact about the state of the code base, not
necessarily a fact about a change to it. "Renderers do no I/O" and "the open
source product never depends on the hosted site" are true or false of one
revision, whether or not a pull request touched them. Assertions are therefore
evaluated over the extraction document of one revision, not over a comparison,
and they aren't tied to comparators.

This narrows one part of the broader
[structural verification](verification-proposal.md) proposal. It supersedes an
earlier, comparator-bound draft.

## The model

| Part       | Judges                      | Example                                 |
| ---------- | --------------------------- | --------------------------------------- |
| Extractor  | Nothing: produces facts     | `npm-package` entities and dependencies |
| Assertion  | One state                   | "This is never allowed."                |
| Comparator | A change between two states | "This change introduces that."          |
| Renderer   | Nothing: shows either       | A graph, a schema, a table              |

Assertions sit between extraction and comparison. The extractor produces facts
about one state; assertions judge that state; the comparator judges a change
between two states; the renderer shows either.

The earlier draft put assertions in the comparator file only because the
comparator already had the rule engine. That mixed the layers: a rule about one
revision had to be phrased as a rule about a change, and it could only run when
there was a change to compare.

## Motivation

The repository projects itself. The self-topology projection
(`.github/projections/self-topology*`, with its comparator
`self-topology.comparator.yaml`) has rules of two kinds:

- **Ratchets** ("don't introduce"). These work today as a comparator `classify`
  step: an item that breaks a rule on the After side but not on the Before side
  is introduced. CI can gate on `metadata.topologyRules.counts.introduced` with
  `jq`.
- **Invariants** ("never"). No single-revision check exists. `projections check`
  compares `HEAD` with the working tree, so with no changes it runs no rules.
  Comparator `checks:` on `after` fail the whole comparison with an error rather
  than reporting a finding about an item.

The comparator works around this by computing a `violations` list over `after`
in its metadata, but that is still evaluated only when there is a comparison,
and it is phrased in terms of sides rather than state.

## Sketch

### A part of its own

Assertions are their own part of a projection, alongside the extractor,
comparator and renderer: an `*.assertions.yaml` file.

An open question is ownership. A file could belong to one projection, or bind to
a domain model (for example `architecture/v0`) so that any projection of that
shape can reuse it.

### Rule language

Assertions use the same sandboxed CEL rules engine as the comparators
(`rules.wasm`): deterministic and cost-metered. Each assertion has:

- an `id`;
- a `description`;
- `over`: `entities`, `relationships` or the whole `document`;
- `where`: which items it applies to;
- `assert`: what must hold for each of them;
- a `level`: `error` or `warning`;
- a `message`, evaluated for each violating item.

For example, renderers stay pure:

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

Anything that needs a parser or a compiler stays in the extractor. Assertions
only read the document. Facts are keyed by modules or units, not lines: files
and lines live in evidence, which comparisons ignore, so moving code doesn't
create or resolve a violation.

### Graph assertions

Per-item checks aren't enough. Assertions over the whole document need graph
functions such as reachability and cycle detection ("no path from A to B", "no
cycles among crates"), and their violations may have no single item.

### Existing debt

A new invariant usually starts with existing violations. Rather than a vague
`warning` level that everyone learns to ignore, borrow the model of considered
(`.considered.yaml`): standards plus recorded exceptions. Each exception names
the item, gives a reason and is limited to its current value, so it can shrink
but not grow.

## Worked examples

These test the model against real rules:

- **Renderers never depend on the CLI.** Over relationships: no non-`contains`
  relationship from a `renderers` area entity to a `cli` one. Per item.
- **Renderers do no I/O.** Over entities, as in the example above. Per item.
- **No `serde_json` outside the engine's boundary modules.** Over the engine
  crate's modules. Today this has real debt (5 modules), which is where recorded
  exceptions earn their place.
- **No dependency cycles between crates.** Over the document, with a cycle
  function. The violation is a cycle, not an item.
- **Every public HTTP route has auth.** From the t3code exploration: over route
  entities, requiring an auth relationship or attribute. It shows that the
  extractor must emit the fact (whether a route is authenticated); the assertion
  only judges it.

## Surfaces

### In the picture

Violations reach the renderer as annotations on items. The protocol already
carries annotations with tones, and the shared kit draws them uniformly, as it
draws change badges; renderers invent nothing.

They are final-state warnings, not change kinds. They stay visible after an
animated comparison ends and never compete with diff emphasis.

### Around the picture

Hosts show:

- a count in the summary bar ("2 rule violations") that filters to the violating
  items;
- in the detail card, the rules a selected item breaks, with their messages;
- a list for violations with no single item, such as a cycle or something
  missing.

### Outside the view

- `projections check` output and exit status, for CI.
- The GitHub Action as a gate.
- In VS Code, the sidebar's Checks section and possibly the Problems panel,
  linking to the item.
- The agent tools (`check`, `current_view`).

### Comparisons

Comparisons get introduced and resolved violations for free, by evaluating the
assertions on both sides. In a comparison only introduced violations are
emphasized; pre-existing ones are muted. That replaces the ratchet logic the
self-topology comparator carries today.

## Open questions

- **Ownership.** Does an assertions file belong to a projection, or to a domain
  model that any projection of that shape can reuse?
- **A fourth concept.** Are assertions a fourth part next to extractor,
  comparator and renderer, or folded under an existing one? This is the cost
  being weighed: every concept is one more thing a new user must learn.
- **Exceptions.** What format records existing debt, and where does it live?
- **Performance.** Graph assertions on large extractions need bounds, as the
  comparator's cost metering bounds rules today.
- **Authoring and testing.** How do agents write and test assertions? Probably a
  `*.assertions.test.yaml` like the comparator tests.

## Not in scope

Implementation and any code changes. This document records the design; nothing
here is planned.

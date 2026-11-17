# Comparisons

A comparator is a pure function of two extractions of one projection definition.

```json
{
  "protocolVersion": 0,
  "changes": [
    {"id": "package:auth", "collection": "entities", "before": ["package:auth"],
     "after": ["package:auth"], "status": "modified", "correspondence": "exact",
     "summary": "optional human-readable text",
     "context": {"before": ["contains:app:auth", "workspace:app"],
                 "after": ["contains:app:auth", "workspace:app"]}},
    {"id": "test:parse", "collection": "entities", "before": ["test:parse"],
     "after": ["test:parse"], "status": "unchanged", "correspondence": "exact",
     "varied": [{"path": "/data/durationMs", "within": true}]}
  ],
  "steps": [{"changes": ["package:auth"], "kind": "restructure", "summary": "optional"}],
  "order": {"reverse": "mirror"},
  "variation": {"within": 1, "beyond": 0},
  "metadata": {}
}
```

`changes` lists every entity and relationship whose status is `added`, `removed`
or `modified`, plus identity-only changes (`unchanged` with `declared`, `split`
or `merge` correspondence) and pairs whose only differences are
[volatile](extractions.md#volatile-data) values within tolerance (`unchanged`
with `varied`). Shapes: `added` has no before ID and one after ID; `removed` the
reverse; `exact` pairs one ID with itself; `declared` pairs two different IDs;
`split` has one before ID and two or more after IDs; `merge` has two or more
before IDs and one after ID. A change ID is unique within the comparison; by
convention it is the first after ID, or the before ID for a removal.

An `exact` or `declared` change has `varied` exactly when a volatile value
differs between its items: each `{path, within, reason?, generated?, because?}`,
sorted by path, as the engine's volatility rules judge it (`reason` only when a
spread bound was unavailable and no other bound held, or a generated value is on
one side only; `generated: true` for a
[generated value](extractions.md#generated-values), with `because` naming the
basis parts that moved when its bases differ). Its status is `unchanged` when
the content is equal modulo variation within tolerance, so a change whose
differences are all within is `unchanged` with `varied`; a `modified` change may
carry `varied` with `within: false` entries, and `within: true` ones beside
them. Splits, merges, additions and removals never have `varied`. Unchanged
pairs without volatile differences are omitted as before, but pairs with them
must be listed, so no comparator hides variation. When any change has `varied`,
the comparison has `variation`: `within` counts the `unchanged` changes with
`varied`, `beyond` the `modified` changes with at least one `within: false`
entry; it is absent otherwise.

A change whose status or identity changed may have `context`: the other items a
person needs to read it, by ID in each revision (`before` and `after`, each in
UTF-16 order, at most 1,000; a removal's context is in `before`), and `rules`,
the comparator `context` rules that added to it. The Engine's **core context**
is structural: a changed relationship's endpoints, and the items containing a
changed or context entity, with the containment relationships that place them,
in that revision. Containment (`from` contains `to`) is a `contains`
relationship in every domain schema, plus a database table's `constraint` and
`index` and, in the dependency-injection vocabulary, any relationship from a
`service` to a `registration` or from a `registration` to an `implementation`,
by the kinds of the entities at its ends. The core's context is bounded: taking
the changes in order, each keeps its nearest items first (endpoints, then
containers level by level), at most 1,000 per revision, from a budget of 250,000
for the comparison, so it always fits the limits below and a change past the
budget has none. Every comparator gives each change the core's context, and a
comparator file's [`context` rules](#comparator-files) add to it; context is
only ever added, and context never hides a change. A viewer's Changes scope
shows the changes and their context, folding the rest; its `current_view` lists
each change's context. `context` is absent when it would name nothing, on
expected variation and on unchanged changes, and in comparisons saved before
comparisons had context, for which presentation derives the same structural
context (`changeContext` in the renderer SDK).

`steps` groups change IDs in presentation order, with an optional `kind`
(`remove`, `restructure` or `add`). Steps hold changes that matter: an `exact`
change that is `unchanged` with `varied` is expected variation and appears in no
step. A `declared` change with only variation within tolerance is still a rename
and belongs to a step like any other. With `order.reverse: "mirror"` (the
default) playing backward presents the steps in reverse; `explicit` requires
`reverseSteps`. A comparison never contains positions, colors or timing.

The Engine's `validate-comparison` operation checks a comparison against both
extractions: every referenced ID exists in the named extraction and collection
and belongs to at most one change; every change except expected variation
appears in exactly one step (and exactly once in `reverseSteps` when explicit),
and expected variation in none (`variation-in-step`); change IDs are unique;
shapes match status and correspondence; an `exact` or `declared` change has the
`varied` the volatility rules compute (`inconsistent-variation`, or
`unexpected-varied` on another correspondence) and is `modified` exactly when
its canonical content differs modulo variation within tolerance, with
relationship endpoints compared through one-to-one entity correspondence;
`variation` is present exactly when a change has `varied` and holds its counts
(`missing-variation`, `unexpected-variation`, `inconsistent-variation`); and
every item that differs, even only within tolerance, or is added or removed is
covered by a change; and a change's `context` names other items of that revision
(`unknown-reference`, or `invalid-context` for the change's own items, unsorted
or duplicate IDs, or an empty context), only on a change whose status or
identity changed (`unexpected-context`), holds at least the core's context
(`missing-context`), and stays within 1,000 IDs per change and revision and
250,000 across the comparison (`context-limit`). A comparator cannot hide a
change. Comparisons across different domain schemas are rejected.

## The default comparator

`packages/comparators/default` is written in Rust and runs as a WebAssembly
module, `default-comparator.wasm`, in every host: the CLI runs it in the same
sandboxed runtime and under the same limits as the rules interpreter. It matches
exact IDs first, then explicit `previousIds` claims in either direction, so a
reversed pair recognizes the same connection. One-to-one claims are `declared`;
a claim group with one before item is a `split` and one with one after item a
`merge`; any other group is an `ambiguous-correspondence` error. The default
order groups changes connected through the change itself, changes peers at the
same depth together, removes leaves first and adds roots first as exact mirror
images, bounds the number of waves by merging adjacent layers, and places other
changes in one `restructure` step between them. `order.by` (`dependents`, the
number of incoming relationships in the after extraction or the before
extraction for removals, or a numeric `data.<key>`) sorts steps within each
phase by the largest value of their members, `descending` by default; ties keep
the default order and steps without values go last. One-to-one pairs are judged
through the extractions' volatile declarations: a pair that varied only within
tolerance is listed as `unchanged` with `varied` in no step, one beyond
tolerance is `modified` with `varied`, and the comparison counts its
`variation`. Each change has the core's `context`.

## Comparator files

A custom comparator is a comparator file, `<name>.comparator.yaml` (or `.yml`):
YAML in a restricted subset (one document, at most 1 MiB and 32 levels; no
anchors, aliases, tags, merge keys or duplicate keys; plain scalars resolve as
YAML 1.2's core schema, narrowed to `null`, booleans and decimal numbers), valid
against
[`comparator/v0.json`](../../packages/schemas/schemas/comparator/v0.json) once
parsed (`format: projections.comparator`, `version: 0`). It layers over the
default comparator: its matching runs first, then the file's `identity` passes
over what it left unmatched; `classify` adds a summary and an annotation per
change; `context` rules add to each change's context; `steps` reorders or adds
steps from the default order; `metadata` adds values. Expressions are
[CEL](https://github.com/google/cel-spec) with the standard library listed in
[Custom comparators](../design/declarative-comparators.md#the-standard-library),
checked against declared types when the file loads; a file with any problem is
rejected with every diagnostic (`{code, path, message}`, the message carrying
the YAML line and column). Evaluation is bounded by a deterministic cost budget
of 2×10⁸ units (`cost-limit`). The core enforces the comparison rules above, so
a comparator cannot hide or invent a change.

Every host runs comparator files in the rules interpreter, `rules.wasm`,
sandboxed: the CLI and servers in wasmi, browsers in a dedicated Worker (see
[the interpreter module](#the-interpreter-module)), which computes the default
baseline itself. The Engine validates the comparator's comparison against both
extractions before anyone presents it. Any failure, from an invalid file to an
exceeded bound, is explicit; hosts never fall back to the default comparison.

The interpreter's identity is the `sha256:<hex>` digest of the rules language's
manifest (`packages/comparators/rules/language.json`: the format and its
behaviour revision, the macros, the standard library's signatures and cost
classes, the declared types and the cost budget), which its build records in a
`projections.interpreter` custom section; a module without that section is
identified by the digest of its bytes. Builds on different hosts, and refactors
of the interpreter, keep the identity; changes to the language don't. A custom
comparator's digest is `sha256:` over `projections-rules-comparator\n`, the
interpreter's identity, `\n` and the canonical file (the RFC 8785 JSON of the
parsed YAML), so it changes with the file's meaning or the interpreter, not with
comments or layout.

## Comparator tests

A comparator file's tests are the file beside it with `.test` before the
extension: `X.comparator.test.yaml` for `X.comparator.yaml` (`.yml` likewise).
They are YAML in the same restricted subset (one document, at most 1 MiB; no
anchors, aliases, tags, merge keys or duplicate keys), valid against
[`comparator-tests/v0.json`](../../packages/schemas/schemas/comparator-tests/v0.json):
`format: projections.comparator-tests`, `version: 0`, optional `description` and
`options`, and `cases`, a non-empty list. Unknown fields, duplicate case names
and malformed sources are rejected with their line and column, all at once.

A case has a `name`, unique in the file and its ID, `before` and `after`
sources, optional `options` (replacing the file's; without either, the options
of the projection whose tests run, else `{}`), and `expect`, a `snapshot` or
both; a case with neither asserts nothing and is rejected. A source is a fixture
path (shorthand for `{file}`), `{extraction}` inline or `{revision}`. Fixture
and snapshot paths are relative to the test file, use `/`, and must stay inside
the repository, lexically and after resolving links. A fixture is an extraction
or a `projections.extraction` document (its `extraction` is used);
`{revision: R}` is the projection extracted at `R`, or the working tree for
`working-tree`, with the working tree's definition, under the usual trust
policy. The Engine normalizes every extraction, and the comparator runs exactly
as everywhere else: in the sandboxed interpreter, with the comparison validated
by the Engine.

Expectations are partial. Objects match on the keys they list (an expected
`null` also matches an absent key); arrays, strings and numbers match exactly.
An empty object expects nothing; assert emptiness with `count`.

<!-- prettier-ignore -->
| Field | Passes when |
|---|---|
| `order: [a, b, ...]` | Each entry names changes (a change ID, or an item ID in a change's `before` or `after`), and every step holding the earlier entry's changes comes before every step holding the next one's |
| `steps: [{kind?, summary?, changes?}]` | The comparison has exactly this many steps, and each matches the fields listed; `changes` (change or item IDs) names exactly the step's changes |
| `changes: [{item \| id, collection?, status?, correspondence?, summary?, before?, after?, context?}]` | `item` (the changes whose `before` or `after` include it) or `id` selects exactly one change, narrowed by `collection`, and the listed fields match |
| `count: {changes?, steps?}` | The comparison has that many |
| `metadata: {...}` | The comparison's metadata contains it |
| `error: text` | The comparator fails, with `text` in its message. Such a case lists no other expectation or snapshot |

A change's `context: {before?, after?, rules?}` matches its context field by
field, each list exactly (IDs in UTF-16 order, rules in the file's order);
`context: null` expects none.

A failure records the expectation's JSON pointer in the test file (for example
`/cases/0/expect/steps/1/changes`), a one-line message, its line and column, and
for mismatches the `expected` and `actual` values and a line diff of their JSON.

A snapshot holds the whole validated comparison as JSON with keys sorted by
UTF-16 code units, two-space indentation and a trailing newline. It is compared
by value, so reformatting it changes nothing. A missing or different snapshot
fails until `projections check --update` writes it; updating writes only
snapshots, never expectations.

**Why a sibling file, not a `tests:` section.** A custom comparator's digest
covers the canonical comparator file, so tests inside it would change the
comparator's identity with every test edit, invalidating saved comparisons and
showing the comparator as changed in a pull request in a hosted view. Hosts
fetch only the comparator file at a revision (up to 1 MiB) and must not fetch
tests or fixtures, and tests name files relative to themselves, which pure
comparator data shouldn't. Test files are never part of a definition's digest
and never read by hosts.

`projections check` runs the tests beside each projection's comparator file,
once per projection (a case without options takes that projection's, and a
revision case extracts with its definition); see
[the runner](../runner/stdio-backend.md#comparator-tests) for the step and the
API.

### Rule coverage

`projections check --coverage` (and `coverage: true` in the API and
`run_comparator_tests`) also reports which parts of the comparator file the
cases ran. The interpreter counts, in a comparator read for coverage only:

- **functions**: each function in `functions`, when its body runs;
- **expressions**: every other expression (checks, variables, identity passes,
  classify, steps, metadata) when it is evaluated; a check's `message` and
  `path` run only when the check fails;
- **branches**: each outcome of every decision: a conditional's condition true
  and false (and so each `match` case and its default, and each `cond` and
  `collect` entry), each operand of `&&` and `||` true and false, the predicate
  of `exists`, `all`, `exists_one` and `filter` true and false, and a `map`
  running its body. A conditional whose else branch is another conditional
  doesn't list its false outcome separately: reaching the next one is the same
  thing.

A covered comparison is the comparison an uncovered one gives, at the same cost
in units; the probes are calls CEL can't spell, the counts are sums, so they
don't depend on threads or timing, and nothing leaves the sandbox but the
report. The report, `projections.rules-coverage` version 0, lists every entry
with its comparator-file `path` (JSON pointer), `line`, `column` and `count`:
`functions` by `name`, `expressions`, and `branches` with their `kind`
(`conditional`, `match`, `cond`, `and`, `or`, `exists`, `all`, `exists_one`,
`filter`, `map`), `condition` as written (shortened) and `outcome`. The cases'
reports are summed per test file, and the step reports covered and total entries
of each kind, the percentage, and every uncovered entry by line, for example
``uncovered X.comparator.yaml:74:12 `value == null` was never true``.

A branch no input can take is better removed. One that stays (a defensive
default, say) is excluded with a comment on its line, or alone on the line
before it: `# coverage-ignore: <reason>` in YAML, or
`// coverage-ignore: <reason>` inside a block of CEL. Excluded entries are
listed with their reason and don't count; a comment without a reason excludes
nothing.

The built-in rules comparators are held to rule coverage gates
(`npm run test:rust:rules-coverage`, part of `npm run test:rust`): their
comparator tests and the rules interpreter's own suites together must cover
every function, expression and branch (`packages/cli/tests/rules_coverage.rs`).

## The interpreter module

The rules interpreter and the default comparator are Projections' own
WebAssembly modules, and their interface is internal to hosts: users never
supply modules. Each is a core module with **zero imports** that exports
`memory`, `projections_alloc(len: i32) -> i32` and
`projections_compare(ptr: i32, len: i32) -> i64`. Its input is UTF-8 JSON
`{"protocolVersion": 0, "before", "after", "baseline", "options"}` and its
output, packed as `(ptr << 32) | len`, is a comparison or
`{"error": "message"}`. Hosts instantiate it afresh for every run, bound memory
(256 MiB by default) and execution (fuel in wasmi: 10¹¹ units for the default
comparator, 10¹² for rules; a wall-clock deadline in browsers), and treat any
trap, exceeded bound, invalid JSON or failed validation as an explicit failure.
The default comparator module ignores `baseline` (hosts pass it an empty one,
since its result is the baseline), declares a 256 MiB memory maximum, and is
published as `default-comparator.wasm`.

The interpreter also exports `projections_rules_inspect(ptr, len) -> i64`
(input: the comparator file's UTF-8 text; output: `{"canonical"}`, the RFC 8785
JSON of the parsed file, with `{"warnings"}` when the check found lint warnings,
or `{"diagnostics"}`). Its comparison input carries `options` =
`{"rules": "<UTF-8 text>", "options": <the definition's options>}`; it computes
the default baseline itself and ignores `baseline`. Its
`projections_rules_cover(ptr, len) -> i64` takes the same input and returns
`{"comparison"}` or `{"error"}` with `"coverage"`, the comparison's rule
coverage report ([Rule coverage](#rule-coverage)), which a failed comparison has
too; `null` when the rules don't load.

Editors' language service is a separate module, `rules-editor.wasm`, which only
the VS Code extension ships. It has zero imports and exports `memory`,
`projections_alloc` and `projections_rules_editor(ptr, len) -> i64`. Its input
is the UTF-8 JSON
`{"op": "tokens" | "diagnostics" | "hover" | "complete", "source", "kind"?: "rules" | "tests", "line"?, "column"?}`,
and its output is JSON: semantic tokens, diagnostics with their positions, a
hover, or completions and the range they replace, with 1-based lines and
code-point columns
([Editing comparator files](../design/declarative-comparators.md#editing-comparator-files)).
It reads the language manifest but doesn't change it, so it isn't part of the
interpreter's identity, and `rules.wasm` doesn't carry it.

## Saved comparisons

```json
{
  "format": "projections.comparison", "version": 0,
  "before": {}, "after": {}, "comparison": {},
  "comparator": {"id": "default", "digest": "sha256:<module hex>"},
  "notices": ["The head revision changes the definition of projection `dependencies`. ..."]
}
```

`notices` is optional: at most 20 nonempty strings of at most 4,096 characters,
omitted when there are none. They explain how the compared revisions define the
projection differently: the other revision changes the definition or its
component code (declared sources), or doesn't define the projection. They are
informational, never verified or used for comparison, and viewers display them.

A custom comparator's `id` is its comparator file's path (as the definition
names it), and its `digest` is the comparator digest defined above.

A comparison whose changes have `context` is a valid `comparison/v0` document,
as the schema only gained an optional field, but CLIs and viewers from before
context reject it: their comparisons are closed objects that don't know the
field. Viewers rerun the comparator anyway, and saved comparisons without
`context` stay valid; presentation derives their context from the structure.

Extractions are compared only when their `definitionDigest` values match;
otherwise the mismatch is reported, explaining whether the definition or its
declared sources differ. By default a comparison applies the base revision's
definition, with one version of its component code, to both revisions;
`--definition head` uses the head revision's definition. A projection missing at
the definition revision is an explicit error naming an option that works: the
other revision's definition when it has one, else `--definition-revision` with
the working tree (or `HEAD`).

Viewers rerun the comparator, which is deterministic, rather than trusting a
saved comparison; the default comparator is always available. A comparison made
by a custom comparator is verified with the comparator file its definition
names, from a source the viewer trusts (a hosted view fetches it from the
repository at the merge base and head), whose digest must equal the comparison's
comparator digest, and which must reproduce it. Comparisons whose comparator
digest differs from the available default comparator module, or whose comparator
file isn't available, are not verified and are rejected.

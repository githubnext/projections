# Comparisons

A comparator is a pure function that takes two extractions from the same
projection definition and describes what changed between them.

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

`changes` lists every entity and relationship whose status is `added`,
`removed`, or `modified`, along with identity-only changes (`unchanged` with
`declared`, `split`, or `merge` correspondence) and pairs whose only differences
are [volatile](extractions.md#volatile-data) values within tolerance
(`unchanged` with `varied`). Each correspondence kind has a fixed shape: `added`
has no before ID and one after ID; `removed` is the reverse; `exact` pairs one
ID with itself; `declared` pairs two different IDs; `split` maps one before ID
to two or more after IDs; and `merge` maps two or more before IDs to one after
ID. Every change ID is unique within the comparison—by convention, the first
after ID, or the before ID for a removal.

An `exact` or `declared` change includes `varied` whenever a volatile value
differs between its items. Each entry is
`{path, within, reason?, generated?, because?}`, sorted by path, as judged by
the engine's volatility rules (`reason` appears only when a spread bound was
unavailable and no other bound held, or when a generated value exists on one
side only; `generated: true` marks a
[generated value](extractions.md#generated-values), with `because` listing the
basis parts that changed when its bases differ). A pair's status is `unchanged`
when its content is equal modulo variation within tolerance, so an item whose
differences are all within tolerance is `unchanged` with `varied`. A `modified`
change may also carry `varied` entries with `within: false` alongside
`within: true` entries. Splits, merges, additions, and removals never carry
`varied`. Unchanged pairs with no volatile differences are still omitted, while
pairs with volatile differences must be listed so no comparator can hide
variation. Whenever any change has `varied`, the comparison includes
`variation`, where `within` counts `unchanged` changes with `varied` and
`beyond` counts `modified` changes with at least one `within: false` entry;
otherwise `variation` is omitted.

Any change whose status or identity changed may carry `context`: the IDs of
surrounding items someone needs to understand it in each revision (`before` and
`after`, each sorted in UTF-16 order and capped at 1,000, with a removal's
context in `before`), plus `rules` listing any comparator `context` rules that
contributed to it. The Engine computes a structural **core context**
automatically: a changed relationship's endpoints, and the items containing a
changed or context entity along with the containment relationships linking them
in that revision. Containment (`from` contains `to`) covers `contains`
relationships in every domain schema, a database table's `constraint` and
`index`, and in the dependency-injection vocabulary any relationship from a
`service` to a `registration` or from a `registration` to an `implementation`
based on the endpoint entity kinds.

Core context stays bounded: walking changes in order, each change keeps its
nearest items first (endpoints, then containers level by level), up to 1,000 per
revision, drawing from a comparison-wide budget of 250,000 IDs and 16 MiB of ID
bytes so it always fits within validation limits (changes past the budget
receive none). Every comparator provides the core context, and a comparator
file's [`context` rules](#comparator-files) can only add to it—never hide a
change. In viewers, the Changes scope displays changed items together with their
context and folds everything else, and `current_view` lists each change's
context. `context` is omitted when empty, on expected variation and unchanged
changes, and in older saved comparisons written before context existed (where
presentation derives the same structural context via `changeContext` in the
renderer SDK).

`steps` organizes change IDs into presentation order, with an optional `kind`
(`remove`, `restructure`, or `add`). Steps only contain changes that matter: an
`exact` change that is `unchanged` with `varied` is expected variation and does
not belong in any step, whereas a `declared` change with only within-tolerance
variation is still a rename and belongs in a step like any other change. With
`order.reverse: "mirror"` (the default), playing backward runs the steps in
reverse; setting `explicit` requires `reverseSteps`. Comparisons never store
layout positions, colors, or animation timing.

The Engine's `validate-comparison` operation verifies a comparison against both
extractions:

- Every referenced ID exists in the named extraction and collection and belongs
  to at most one change, and all change IDs are unique.
- Every change except expected variation appears in exactly one step (and once
  in `reverseSteps` when explicit), while expected variation appears in none
  (`variation-in-step`).
- Shapes match each change's status and correspondence.
- Every `exact` or `declared` change carries the exact `varied` entries computed
  by the volatility rules (`inconsistent-variation`, or `unexpected-varied` on
  other correspondences) and is `modified` if and only if its canonical content
  differs modulo variation within tolerance (comparing relationship endpoints
  through one-to-one entity correspondence).
- `variation` is present if and only if a change has `varied`, with matching
  counts (`missing-variation`, `unexpected-variation`,
  `inconsistent-variation`).
- Every item that differs—even only within tolerance—or is added or removed is
  covered by a change, so no comparator can hide a change.
- Each change's `context` references only other items in that revision
  (`unknown-reference`, or `invalid-context` for the change's own items,
  unsorted or duplicate IDs, or an empty context), appears only on changes whose
  status or identity changed (`unexpected-context`), includes at least the core
  context (`missing-context`), and stays within 1,000 IDs per change and
  revision and 250,000 IDs / 16 MiB of ID and rule-name bytes overall
  (`context-limit`).

Comparisons across different domain schemas are rejected.

## The default comparator

`packages/comparators/default` is written in Rust and runs everywhere as a
WebAssembly module, `default-comparator.wasm`. The CLI executes it inside the
same sandboxed runtime and under the same resource limits as the rules
interpreter.

It matches exact IDs first, then follows explicit `previousIds` claims in either
direction so a reversed comparison recognizes the same continuity. One-to-one
claims become `declared` changes; a claim group with one before item becomes a
`split`; a group with one after item becomes a `merge`; and any other grouping
fails with `ambiguous-correspondence`. For presentation order, the default
comparator groups connected changes together, updates peers at the same depth
together, removes leaves first and adds roots first as exact mirror images,
merges adjacent layers to bound the number of waves, and places remaining
changes in a single `restructure` step in between.

Setting `order.by` (either `dependents`—the count of incoming relationships in
the after extraction, or in the before extraction for removals—or a numeric
`data.<key>`) sorts steps within each phase by the largest value among their
members, `descending` by default; ties preserve the default order and steps
without values go last. One-to-one pairs are evaluated against both extractions'
volatile declarations: pairs that varied only within tolerance are recorded as
`unchanged` with `varied` and omitted from steps, pairs beyond tolerance become
`modified` with `varied`, the comparison tallies `variation`, and every change
receives the core `context`.

## Comparator files

A custom comparator is a YAML file named `<name>.comparator.yaml` (or `.yml`)
using a restricted YAML subset: one document, at most 1 MiB and 32 nesting
levels, no anchors, aliases, tags, merge keys, or duplicate keys, with plain
scalars resolved via YAML 1.2's core schema narrowed to `null`, booleans, and
decimal numbers. Once parsed, it must validate against
[`comparator/v0.json`](../../packages/schemas/schemas/comparator/v0.json)
(`format: projections.comparator`, `version: 0`).

A comparator file layers cleanly on top of the default comparator:

- Default matching runs first, and the file's `identity` passes run over
  whatever remains unmatched.
- `classify` attaches a summary and annotation per change.
- `context` rules add extra items to each change's context.
- `steps` reorders or inserts steps relative to the default order.
- `metadata` attaches comparison-level values.

Expressions use [CEL](https://github.com/google/cel-spec) with the standard
library documented in
[Custom comparators](../design/declarative-comparators.md#the-standard-library),
type-checked against declared types when the file loads. Any invalid file is
rejected with all diagnostics at once (`{code, path, message}`, including YAML
line and column numbers). Evaluation is bounded by a deterministic cost budget
of 2×10⁸ units (`cost-limit`). Because the Engine enforces all comparison
invariants above, a comparator file can never hide or fabricate a change.

Every host executes comparator files inside the sandboxed rules interpreter,
`rules.wasm`—using wasmi in the CLI and servers, and a dedicated Worker in
browsers (see [the interpreter module](#the-interpreter-module))—which computes
the default baseline itself. The Engine always validates the resulting
comparison against both extractions before anything displays it. Any error, from
a malformed file to an exceeded budget, fails explicitly; hosts never silently
fall back to the default comparison.

The interpreter's identity is the `sha256:<hex>` digest of the rules language
manifest (`packages/comparators/rules/language.json`, covering the format and
behavior revision, macros, standard library signatures and cost classes,
declared types, and cost budget), embedded at build time in a
`projections.interpreter` custom section (a module without that section falls
back to the digest of its bytes). That means cross-host builds and internal
refactors keep the same identity, while language changes get a new one. A custom
comparator's digest is `sha256:` over `projections-rules-comparator\n`, the
interpreter's identity, `\n`, and the canonical file (RFC 8785 JSON of the
parsed YAML), so it changes only when the file's semantics or the interpreter
change—never on comments or formatting.

## Comparator tests

Tests for a comparator file live right next to it with `.test` before the
extension: `X.comparator.test.yaml` for `X.comparator.yaml` (and `.yml`
likewise). They use the same restricted YAML subset (one document, up to 1 MiB,
no anchors, aliases, tags, merge keys, or duplicate keys) and validate against
[`comparator-tests/v0.json`](../../packages/schemas/schemas/comparator-tests/v0.json):
`format: projections.comparator-tests`, `version: 0`, optional `description` and
`options`, and a non-empty `cases` list. Unknown fields, duplicate case names,
and malformed sources are all reported together with their line and column
numbers.

Each case has a unique `name` (its ID), `before` and `after` sources, optional
`options` (overriding the file's options; if neither is set, it inherits the
tested projection's options or defaults to `{}`), and `expect`, a `snapshot`, or
both (a case with neither asserts nothing and is rejected). A source can be a
fixture path (shorthand for `{file}`), an inline `{extraction}`, or
`{revision}`. Fixture and snapshot paths are relative to the test file, use `/`,
and must remain inside the repository both lexically and after symlink
resolution. Fixtures can be raw extractions or `projections.extraction`
documents (using their `extraction` field), while `{revision: R}` extracts the
projection at `R` (or the working tree for `working-tree`) using the working
tree's definition under the usual trust policy. The Engine normalizes every
extraction, and the comparator runs identically to production—inside the
sandboxed interpreter, validated by the Engine.

Expectations are partial: objects match on the keys they specify (an expected
`null` also matches an absent key), while arrays, strings, and numbers match
exactly. An empty object asserts nothing; use `count` to assert emptiness.

<!-- prettier-ignore -->
| Field | Passes when |
|---|---|
| `order: [a, b, ...]` | Each entry names changes (a change ID, or an item ID in a change's `before` or `after`), and every step holding the earlier entry's changes comes before every step holding the next one's |
| `steps: [{kind?, summary?, changes?}]` | The comparison has exactly this many steps, and each matches the fields listed; `changes` (change or item IDs) names exactly the step's changes |
| `changes: [{item \| id, collection?, status?, correspondence?, summary?, before?, after?, context?}]` | `item` (the changes whose `before` or `after` include it) or `id` selects exactly one change, narrowed by `collection`, and the listed fields match |
| `count: {changes?, steps?}` | The comparison has that many |
| `metadata: {...}` | The comparison's metadata contains it |
| `error: text` | The comparator fails, with `text` in its message. Such a case lists no other expectation or snapshot |

A change's `context: {before?, after?, rules?}` checks each listed field as an
exact list (IDs in UTF-16 order, rules in file order), while `context: null`
expects no context.

When an expectation fails, the failure report includes its JSON pointer in the
test file (such as `/cases/0/expect/steps/1/changes`), a one-line message, its
line and column, and—for value mismatches—the `expected` and `actual` values
along with a line diff of their JSON.

A snapshot stores the entire validated comparison as JSON with keys sorted by
UTF-16 code units, two-space indentation, and a trailing newline. Snapshots are
compared by value so formatting tweaks don't cause spurious failures. A missing
or mismatched snapshot fails until you run `projections check --update`, which
only updates snapshots and never alters expectations.

**Why a sibling file, not a `tests:` section.** Because a custom comparator's
digest hashes the canonical comparator file, embedding tests inside it would
change the comparator's identity every time you edited a test—invalidating saved
comparisons and making the comparator look modified in pull requests on hosted
views. Hosts also fetch only the comparator file at a revision (up to 1 MiB) and
shouldn't need to fetch tests or fixtures, and tests reference relative files
that don't belong in pure comparator data. Test files are never included in a
definition's digest and are never read by hosts.

`projections check` runs the sibling test file beside each projection's
comparator file once per projection (supplying that projection's options to
cases without their own, and using its definition for revision cases). See
[the runner](../runner/stdio-backend.md#comparator-tests) for the check step and
API.

### Rule coverage

Running `projections check --coverage` (or setting `coverage: true` in the API
and `run_comparator_tests`) reports which parts of a comparator file your test
cases actually exercised. In coverage mode, the interpreter tracks:

- **functions** — each entry in `functions` whenever its body runs.
- **expressions** — every other expression (checks, variables, identity passes,
  classify, steps, metadata) when evaluated; a check's `message` and `path` only
  execute when the check fails.
- **branches** — both outcomes of every decision: a conditional's true and false
  paths (including each `match` case and default, and each `cond` and `collect`
  entry), each operand of `&&` and `||` being true and false, the predicates of
  `exists`, `all`, `exists_one`, and `filter` returning true and false, and a
  `map` running its body. When a conditional's else branch is another
  conditional, its false outcome is not listed separately because reaching the
  next condition already proves it.

Coverage instrumentation produces the exact same comparison at the exact same
cost-unit budget: probes use internal calls CEL cannot express, counts are
deterministic sums independent of threads or timing, and nothing leaves the
sandbox except the report. The report (`projections.rules-coverage`, version 0)
lists every entry with its comparator-file `path` (JSON pointer), `line`,
`column`, and `count`: `functions` by `name`, `expressions`, and `branches` with
their `kind` (`conditional`, `match`, `cond`, `and`, `or`, `exists`, `all`,
`exists_one`, `filter`, `map`), shortened source `condition`, and `outcome`.
Case reports are summed per test file, and the check step reports covered and
total counts per kind, the percentage, and every uncovered entry by line—for
example, ``uncovered X.comparator.yaml:74:12 `value == null` was never true``.

If a branch can never be taken, it is usually best to remove it. When a branch
needs to stay (such as a defensive default), exclude it with a comment on the
same line or alone on the line immediately above: `# coverage-ignore: <reason>`
in YAML, or `// coverage-ignore: <reason>` inside a CEL block. Excluded entries
are listed with their reason and omitted from totals; a comment without a reason
excludes nothing.

Built-in rules comparators are held to strict coverage gates via
`npm run test:rust:rules-coverage` (part of `npm run test:rust`): together,
their comparator tests and the interpreter's own test suites must cover every
function, expression, and branch (`packages/cli/tests/rules_coverage.rs`).

## The interpreter module

Both the rules interpreter and the default comparator are Projections' own
internal WebAssembly modules—users never supply WebAssembly modules. Each is a
core module with **zero imports** that exports `memory`,
`projections_alloc(len: i32) -> i32`, and
`projections_compare(ptr: i32, len: i32) -> i64`. It reads UTF-8 JSON shaped as
`{"protocolVersion": 0, "before", "after", "baseline", "options"}` and returns a
pointer/length packed as `(ptr << 32) | len` pointing to either a comparison or
`{"error": "message"}`. Hosts create a fresh instance per run, enforce memory
limits (256 MiB by default) and execution limits (wasmi fuel: 10¹¹ units for the
default comparator and 10¹² for rules; a wall-clock deadline in browsers), and
treat any trap, exceeded limit, malformed JSON, or validation failure as an
explicit error. The default comparator ignores `baseline` (hosts pass an empty
object since it computes the baseline itself), declares a 256 MiB memory
ceiling, and ships as `default-comparator.wasm`.

The rules interpreter exposes two additional exports:

- `projections_rules_inspect(ptr, len) -> i64` takes a comparator file's UTF-8
  text and returns either `{"canonical"}` (the RFC 8785 JSON of the parsed file,
  plus `{"warnings"}` if linting found warnings) or `{"diagnostics"}`. Its
  comparison input passes `options` as
  `{"rules": "<UTF-8 text>", "options": <the definition's options>}`, computing
  the default baseline internally and ignoring `baseline`.
- `projections_rules_cover(ptr, len) -> i64` takes the same comparison input and
  returns `{"comparison"}` or `{"error"}` alongside `"coverage"`, the run's rule
  coverage report ([Rule coverage](#rule-coverage))—included even when the
  comparison fails, or `null` if the rules fail to load.

Editor support lives in a separate module, `rules-editor.wasm`, shipped only
with the VS Code extension. It also has zero imports and exports `memory`,
`projections_alloc`, and `projections_rules_editor(ptr, len) -> i64`. It accepts
UTF-8 JSON
`{"op": "tokens" | "diagnostics" | "hover" | "complete", "source", "kind"?: "rules" | "tests", "line"?, "column"?}`
and returns JSON with semantic tokens, positioned diagnostics, hover content, or
completions with replacement ranges using 1-based lines and code-point columns
(see
[Editing comparator files](../design/declarative-comparators.md#editing-comparator-files)).
Because it only reads the language manifest without altering it, it is not part
of the interpreter's identity and is not bundled into `rules.wasm`.

## Saved comparisons

```json
{
  "format": "projections.comparison", "version": 0,
  "before": {}, "after": {}, "comparison": {},
  "comparator": {"id": "default", "digest": "sha256:<module hex>"},
  "notices": ["The head revision changes the definition of projection `dependencies`. ..."]
}
```

`notices` is optional (at most 20 nonempty strings of up to 4,096 characters,
omitted when empty). Notices inform viewers when the compared revisions define
the projection differently—for example, when the other revision edits the
definition or its declared sources, or doesn't define the projection at all.
They are informational only, never verified or used during comparison.

For a custom comparator, `id` is the comparator file path as written in the
definition, and `digest` is the custom comparator digest defined above.

A comparison whose changes include `context` is still a valid `comparison/v0`
document because the field is optional, though older CLIs and viewers written
before context existed will reject it because they validate comparisons as
closed objects. Viewers rerun the comparator anyway, and older saved comparisons
without `context` remain valid because presentation derives structural context
automatically.

Two extractions can only be compared when the engine pairs them (`pair`, see
[One implementation](../contracts.md#one-implementation-native-and-browser)):
they must belong to the same projection, have recorded definitions that agree
outside `presentation`, and share equal `definitionDigest` values. Otherwise
Projections reports the mismatch and tells you whether the definition or its
declared sources differ. By default, a comparison applies the base revision's
definition and component code to both revisions, while `--definition head` uses
the head revision's definition instead. If the projection is missing at the
chosen definition revision, Projections fails explicitly and suggests a working
option: the other revision's definition if it exists, or `--definition-revision`
pointing to the working tree or `HEAD`.

Because comparators are deterministic, viewers rerun the comparator rather than
trusting a saved comparison's claims. The default comparator is always built in.
For a custom comparator, the viewer loads the comparator file named by the
definition from a trusted source (hosted views fetch it from the repository at
the merge base and head), checks that its digest matches the comparison's
comparator digest, and confirms that rerunning it reproduces the comparison. Any
saved comparison whose comparator digest doesn't match the available default
module, or whose comparator file cannot be retrieved and verified, is rejected.

# Extractions

An extraction is the snapshot an extractor produces for a single revision. Every
extraction includes `protocolVersion: 0`, a domain `schema`, `entities`, and
`relationships`, along with optional `volatile`, `missingInputs`, and `metadata`
fields. The seven domain schemas are `graph/v0`, `dag/v0`, `treemap/v0`,
`metrics/v0`, `api/v0`, `database/v0`, and `architecture/v0`. Extractor IDs are
just names—they are not an engine-owned catalog or extension boundary.

`missingInputs` records any declared inputs (repository-relative files, folders,
or globs) that do not exist at the examined revision—for instance, an older
commit from before a config file was introduced. The extraction simply describes
the revision without them. The engine requires distinct, nonblank strings of at
most 1024 characters with no NULs, up to 256 entries (`duplicate-missing-input`,
`invalid-missing-input`, `missing-inputs-limit`), sorts them, and drops the
field if the list is empty. Runners surface missing inputs as comparison
notices, and they are included in the extraction's canonical bytes.

An extraction can also declare `vocabularies`—typed conventions layered on top
of its domain schema, such as `dependency-injection/v0`, `infrastructure/v0`,
and `runtime-policy/v0` over `architecture/v0`, or `scenarios/v0` over
`graph/v0`. The engine rejects unknown vocabularies, vocabularies that don't
apply to the extraction's schema (`unsupported-vocabulary`), and duplicate
entries (`duplicate-vocabulary`). It validates each declared vocabulary's typed
`data` fields just like the schema's own fields, and sorts the list in the
normalized extraction. If an extraction declares no vocabularies, it remains
valid and its `data` stays open. Domain schemas and vocabularies only type the
`data` fields that built-in renderers and comparators inspect; see the
[schema reference](../reference/schemas/README.md) for the full list.

Every entity carries `id`, `kind`, and `label`, plus optional `data`,
`previousIds`, `evidence`, and `confidence` (`authoritative`, `derived`, or
`inferred`). Every relationship carries `id`, `kind`, `from`, and `to`, plus
optional `label`, `data`, `previousIds`, `evidence`, and `confidence`. An
evidence entry has a `kind`, a `source` (such as a file path), and an optional
`location` (`line` and `column`, 1-based). Because the default comparator
ignores evidence, line numbers belong in `evidence` rather than in
`data`—otherwise moving code around in a file would falsely mark an item as
modified.

IDs must be nonempty Unicode strings that are globally unique across both
entities and relationships, and every relationship endpoint must point to an
existing entity. `previousIds` declares identity continuity across renames or
restructures, and never authorizes fuzzy or label-based matching. Multiple items
in the same collection may claim the same previous ID to represent a split, but
a claim can never name a current ID or span across collections.

Domain schemas add structural rules for their item kinds:

- Trees and treemaps must form acyclic forests where each entity has at most one
  incoming parent, and DAGs must be acyclic.
- Treemap leaves require a nonnegative `data.value`; if an internal node
  specifies an explicit weight, that weight is authoritative.
- Metrics require a numeric `data.value` and accept an optional string
  `data.unit`.
- API declarations require string signatures.
- Database columns require a nonempty type and accept an optional boolean
  nullable flag.
- Timeline events require a finite time and accept an optional nonnegative
  duration.

An `api/v0` declaration can also carry `data.contract`, which captures the
cross-ecosystem facts that compatibility rules inspect (declaration kind,
visibility, modifiers, signatures, supertypes, and so on). The Engine validates
those shared fields, while ecosystem-specific facts live under
`contract.native`. Every contract specifies its kind (`declaration` and the
ecosystem's `term`) and `visibility`, and every signature parameter specifies
`passing` (by `value` unless by reference); any omitted boolean is treated as
false. The extraction's `metadata.ecosystem` (`dotnet`, `typescript`, `rust`, or
`go`) selects which rule set runs. Using those facts, the `api-compatibility`
comparator classifies each change as `breaking`, `additive`, `compatible`, or
`unknown` under the comparison's `metadata.compatibility` (see
[API compatibility](../models/api-compatibility.md)).

`architecture/v0` imposes no extra constraints on kinds on its own, leaving room
for domain vocabularies:

- Dependency-injection containers use the shared `service`, `registration`, and
  `implementation` vocabulary described in
  [one model for dependency injection](../models/dependency-injection-model.md),
  produced by the `dotnet-di`, `nestjs-di`, and `spring-di` extractors and read
  by the `dependency-injection` renderer.
- Infrastructure uses the `resource`, `data-source`, `module`, and
  `resource-group` vocabulary along with the planned `action` field described in
  [one model for infrastructure](../models/infrastructure-model.md), produced by
  the `terraform-infrastructure` and `azure-what-if` extractors and read by the
  graph renderer's `infrastructure` presentation.
- Runtime security policies use the `policy`, `probe`, `hook`, `selector`, and
  `subject` vocabulary described in
  [one model for runtime security policies](../models/runtime-policy-model.md),
  produced by the `tetragon-policies` extractor.
- Agentic workflows use the `workflow` and `group` vocabulary described in
  [one model for agentic workflows](../models/agentic-workflow-model.md),
  produced by the `github-agentic-workflows` extractor.
- Renderer fixture scenarios use the `scenarios` and `scenario` vocabulary
  described in [one model for renderer scenarios](../models/scenarios-model.md),
  produced by the `renderer-scenarios` extractor and read by the `gallery`
  renderer.

The Engine strictly rejects invalid Unicode, duplicate JSON object keys,
nonfinite numbers, and integers outside the JavaScript safe-integer range,
without normalizing Unicode text. Extractions are bounded to 10,000 entities,
50,000 relationships, 50 JSON nesting levels, and 8 MiB. Unsupported versions
and unknown fields are rejected outright rather than silently dropped—any custom
extension belongs in explicit `data` or `metadata` objects.

## Volatile data

Extractions behave much like test results: determinism is the goal, but some
measurements—such as timings, sample counts, or measured means—naturally
fluctuate between runs on the same revision. Rather than blocking those
projections, an extraction can declare up to 256 volatile paths in `volatile`:

```json
"volatile": [
  {"collection": "entities", "kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50, "relative": 0.2}},
  {"collection": "relationships", "path": "/data/samples/*/count"},
  {"kinds": ["benchmark"], "path": "/data/meanMs", "tolerance": {"spread": "/data/stdevMs", "factor": 2}}
]
```

- `path` is a JSON pointer that must begin with `/data/`. IDs, kinds, labels,
  and relationship endpoints can never be volatile, so identity and matching
  stay unaffected. Standard RFC 6901 escapes (`~0`, `~1`) apply, and a `*`
  segment matches any object key or array index (meaning a literal `*` key
  cannot be addressed). A declaration covers only the value at that path, not
  the surrounding structure like an array growing or a sibling key appearing.
- `collection` is `entities` (the default) or `relationships`, and `kinds` is an
  optional nonempty list of unique kinds that narrows which items the rule
  applies to (when omitted, it applies to every kind).
- `tolerance` is optional. If you omit it, any difference at that
  path—regardless of JSON type, including presence on only one side—counts as
  expected variation. When present, `tolerance` applies to numbers only and must
  declare at least one bound, each a finite number ≥ 0:

  | Bound                               | Within when `\|after − before\|` ≤           |
  | ----------------------------------- | -------------------------------------------- |
  | `absolute`                          | `absolute`                                   |
  | `relative`                          | `relative × max(\|before\|, \|after\|)`      |
  | `spread` (with `factor`, default 1) | `factor × √(spread_before² + spread_after²)` |

  A difference is within tolerance whenever **any** declared bound holds—in
  other words, `≤ max(...)` of the bounds that can be evaluated. `spread` is a
  `/data/` pointer into the same item naming a spread recorded by the extractor
  (such as a standard deviation), and combines both runs' spreads via root sum
  of squares. A `spread` pointer may only use `*` segments that also appear in
  `path`: its first `*` takes the key matched by the path's first `*`, and so on
  (for example, `/data/benchmarks/*/meanMs` paired with
  `/data/benchmarks/*/stdevMs`). If the spread is missing on either side or is
  not a finite nonnegative number, that bound cannot be satisfied; if no other
  bound holds, the difference is reported as beyond tolerance with a `reason`.
  Whenever a tolerance is set, a non-number on either side, a type change, or a
  value present on only one side is beyond tolerance. All arithmetic uses IEEE
  754 double precision.

The engine rejects invalid pointers or pointers outside `/data/`
(`invalid-volatile-path`), invalid or empty tolerances or a `factor` without
`spread` (`invalid-tolerance`), duplicate kinds (`duplicate-kind`), duplicate
declarations sharing the same collection, kinds, and path
(`duplicate-volatile`), and more than 256 declarations (`volatile-limit`),
reporting paths like `/volatile/0/path`. In the normalized extraction, each
declaration explicitly includes its `collection`, sorts its `kinds`, and is
sorted by collection, path, and kinds; an empty list is dropped.

When comparing a matched pair, both sides' declarations apply, each filtered by
its own item's kind. If multiple declarations match the same concrete path, the
tighter bound wins bound by bound so variation never hides more than either side
permits: no tolerance is the loosest; between two tolerances, the smaller
`absolute` wins, the smaller `relative` wins, and every `spread` from both sides
applies (using the smaller `factor` when both name the same spread), while any
bound declared on only one side does not apply. This combination is symmetric—it
never depends on which side or declaration stated what, so reversing a
comparison produces the exact same judgment for every value. A pair's varied
paths are all concrete paths matched by a declaration on either item whose
values differ, sorted by UTF-16 code units. The pair's content is considered
equal modulo variation when nothing differs outside those paths and every varied
path is within tolerance.

Comparators remain deterministic because the engine's `volatility` module is the
single source of truth shared by the default comparator, rules comparators,
comparison validation, and the `vary` operation. Official results are always
what CI publishes.

### Generated values

A declaration with `"generated": true` and a `basis` marks a **generated
value**—something an extractor produced from an identifiable input, such as an
LLM-written summary. Instead of comparing wording, Projections judges a
generated value strictly by its basis (see
[design](../design/generated-values.md)):

```json
{"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
```

- `basis` is required when `generated` is set (`true` is its only valid value)
  and disallowed otherwise (`invalid-generated`). It is a `/data/` pointer into
  the same item following the same `*` matching rule as `spread`
  (`invalid-volatile-path`). A generated declaration cannot also specify
  `tolerance` (`invalid-tolerance`), because the basis serves as its tolerance.
- A basis cannot itself be volatile: no declaration with an overlapping
  collection and kinds may point to, inside, or above the basis path, including
  the generated declaration's own path (`volatile-basis`, reported at
  `/volatile/N/basis`).
- On every item matched by a generated declaration, the basis must be an object
  with 1 to 16 parts. Each part name starts with a letter followed by up to 63
  letters, digits, `_`, or `-`, and each value is a nonempty string of at most
  256 UTF-8 bytes (`invalid-basis`)—typically a `sha256:` hash or a verbatim
  model ID. An item must have a basis if and only if it has the generated value
  (`missing-basis` at the value, `orphan-basis` at the basis).
- For a matched pair, equal bases make any difference in the generated value
  within tolerance (`{path, within: true, generated: true}`). If the bases
  differ—even if the generated text happens to match—the value is beyond
  tolerance and lists the differing basis parts (including parts present on only
  one side) in UTF-16 order under `because`. If the value exists on only one
  side, it is beyond tolerance with a `reason` (`Generated only before` or
  `Generated only after`). The basis path belongs to its value, so basis
  differences are reported exclusively through the value's entry and never as
  separate data differences or varied paths.
- When multiple declarations match one concrete path, a generated declaration is
  tighter than any non-generated one. If multiple generated declarations with
  different basis pointers apply, every basis counts: the value is beyond
  tolerance if any of them differs, and `because` lists the differing parts from
  all of them.

Normalized declarations preserve `generated` and `basis`, while extractions
without them keep identical bytes and digests. The **basis digest** is `sha256:`
followed by the lowercase hex SHA-256 of the basis's RFC 8785 canonical JSON;
paired with the declaration's `path`, it keys the runner's
[generation store](../runner/caches.md#generation-store).

## Canonical bytes

Canonical bytes are produced by sorting `entities` and `relationships` by UTF-16
code-unit ID order and serializing with RFC 8785 JSON canonicalization. Omitted
item `data` becomes `{}`. Evidence, previous IDs, and extraction metadata are
excluded, while kind, label, data, confidence, relationship endpoints, IDs,
normalized `volatile` declarations, and `missingInputs` are included. Because
volatile values are still ordinary data, two runs that differ within tolerance
produce different digests. Negative zero canonicalizes to zero, and object keys
and numeric formatting follow RFC 8785 rather than locale sorting or host
insertion order. The extraction digest is the lowercase SHA-256 of these UTF-8
bytes.

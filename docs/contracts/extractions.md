# Extractions

An extraction contains `protocolVersion: 0`, a domain `schema`, `entities`,
`relationships` and optional `volatile`, `missingInputs` and `metadata`. The
seven domain schemas are `graph/v0`, `dag/v0`, `treemap/v0`, `metrics/v0`,
`api/v0`, `database/v0` and `architecture/v0`. Extractor IDs are arbitrary
names, not an engine-owned catalog or extension boundary.

`missingInputs` lists the declared inputs (repository-relative files, folders or
globs) the examined revision doesn't have, for example one from before the input
was added: the extraction describes the revision without them. The engine
requires distinct nonblank strings of at most 1024 characters without NULs, at
most 256 (`duplicate-missing-input`, `invalid-missing-input`,
`missing-inputs-limit`), sorts them and drops an empty list. Runners turn them
into comparison notices; they are part of the canonical bytes.

An extraction may also declare `vocabularies`: typed conventions over its schema
that it follows, such as `dependency-injection/v0`, `infrastructure/v0` and
`runtime-policy/v0` over `architecture/v0`. The engine rejects an unknown
vocabulary, one that doesn't apply to the extraction's schema
(`unsupported-vocabulary`) or one declared twice (`duplicate-vocabulary`),
checks each declared vocabulary's typed `data` like the schema's, and sorts them
in the normalized extraction. An extraction without vocabularies stays valid and
its `data` open. Domain schemas and vocabularies type only the `data` fields
built-in renderers and comparators read; the
[schema reference](../reference/schemas/README.md) lists them.

An entity has `id`, `kind`, `label` and optional `data`, `previousIds`,
`evidence` and `confidence` (`authoritative`, `derived` or `inferred`). A
relationship has `id`, `kind`, `from`, `to` and optional `label`, `data`,
`previousIds`, `evidence` and `confidence`. Each evidence entry has a `kind`, a
`source` (the file, say) and an optional `location` (`line` and `column`, from
1); the default comparator ignores evidence, so a line number belongs there
rather than in `data`, where moving code would make the item modified. IDs are
nonempty Unicode strings and globally unique across entities and relationships.
Relationship endpoints must name existing entities. `previousIds` declares
identity continuity; it never authorizes fuzzy or label-based matching. Several
items of one collection may claim the same previous ID, which declares a split.
A claim may not name a current ID or be shared across collections.

Trees and treemaps are acyclic forests with at most one incoming parent per
entity. DAGs are acyclic. Treemap leaves require nonnegative `data.value`; an
explicit internal weight is authoritative. Metrics require numeric `data.value`
and optional string `data.unit`. API declaration kinds require string
signatures. Database columns require a nonempty type and optional boolean
nullable flag. Timeline events require finite time and optional nonnegative
duration.

An `api/v0` declaration may carry `data.contract`, the facts compatibility rules
inspect (its kind of declaration, visibility, modifiers, signatures, supertypes
and so on) in terms every ecosystem shares; the Engine checks them, and facts
only one ecosystem's rules read are in `contract.native`. Every contract states
its kind (`declaration` and the ecosystem's `term`) and its `visibility`, and
every parameter of a signature its `passing` (by `value` unless by reference);
other booleans that are absent are false. The extraction's `metadata.ecosystem`
(`dotnet`, `typescript`, `rust` or `go`) names those rules. The
`api-compatibility` comparator classifies each change from them as `breaking`,
`additive`, `compatible` or `unknown` in the comparison's
`metadata.compatibility`; see
[API compatibility](../models/api-compatibility.md).

`architecture/v0` places no further constraints on kinds. Dependency-injection
containers use the shared `service`, `registration` and `implementation`
vocabulary described in
[one model for dependency injection](../models/dependency-injection-model.md),
which the `dotnet-di`, `nestjs-di` and `spring-di` extractors write and the
`dependency-injection` renderer reads. Infrastructure uses the `resource`,
`data-source`, `module` and `resource-group` vocabulary and the planned `action`
field described in
[one model for infrastructure](../models/infrastructure-model.md), which the
`terraform-infrastructure` and `azure-what-if` extractors write and the graph
renderer's `infrastructure` presentation reads.

Runtime security policies use the `policy`, `probe`, `hook`, `selector` and
`subject` vocabulary described in
[one model for runtime security policies](../models/runtime-policy-model.md),
which the `tetragon-policies` extractor writes.

Agentic workflows use the `workflow` and `group` vocabulary described in
[one model for agentic workflows](../models/agentic-workflow-model.md), which
the `github-agentic-workflows` extractor writes.

Reject invalid Unicode, duplicate JSON object keys, nonfinite numbers, and
integer values outside the JavaScript safe-integer range. Do not normalize
Unicode text. Extractions are limited to 10,000 entities, 50,000 relationships,
50 nested JSON levels and 8 MiB. Reject an unsupported version or unknown field
rather than silently dropping it. Extensions belong in explicit
`data`/`metadata` objects.

## Volatile data

Extractions are like test results: determinism is desirable, but some data
varies between runs at one revision (durations, sample counts, measured means),
and that variation mustn't be blocked. An extraction declares such data in
`volatile`, at most 256 declarations:

```json
"volatile": [
  {"collection": "entities", "kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50, "relative": 0.2}},
  {"collection": "relationships", "path": "/data/samples/*/count"},
  {"kinds": ["benchmark"], "path": "/data/meanMs", "tolerance": {"spread": "/data/stdevMs", "factor": 2}}
]
```

- `path` is a JSON pointer that starts with `/data/`: IDs, kinds, labels and
  endpoints are never volatile, so identity and matching are unaffected. RFC
  6901 escapes apply (`~0`, `~1`); a `*` segment matches any object key or array
  index, so a key that is literally `*` can't be addressed. A declared path
  covers the whole value there; the structure around it (an array growing, a
  sibling key) is not volatile.
- `collection` is `entities` (the default) or `relationships`; `kinds`, a
  nonempty list of unique kinds, restricts it (absent: every kind).
- `tolerance` is optional. Without one, any difference of the value, of any JSON
  type and including its absence on one side, is expected variation. A tolerance
  declares at least one bound, each a finite number ≥ 0, and applies to numbers
  only:

  | Bound                               | Within when `\|after − before\|` ≤           |
  | ----------------------------------- | -------------------------------------------- |
  | `absolute`                          | `absolute`                                   |
  | `relative`                          | `relative × max(\|before\|, \|after\|)`      |
  | `spread` (with `factor`, default 1) | `factor × √(spread_before² + spread_after²)` |

  A difference is within when **any** declared bound is satisfied, that is
  `≤ max(...)` of the bounds that can be evaluated. `spread` is a pointer under
  `/data/` into the same item naming the spread the extractor recorded, such as
  a standard deviation; the bound combines both runs' spreads as a root sum of
  squares. A `spread` may only use `*` segments its `path` has: its first `*`
  takes the key the path's first `*` matched, and so on
  (`/data/benchmarks/*/meanMs` with `/data/benchmarks/*/stdevMs`). A spread
  missing on either side, or not a finite nonnegative number, can't be
  satisfied; when no other bound holds the difference is beyond, with a
  `reason`. With a tolerance, a non-number on either side, a type change, or a
  value present on one side only is beyond. Arithmetic is IEEE 754 double
  precision.

The engine rejects an invalid pointer or one outside `/data/`
(`invalid-volatile-path`), an invalid or empty tolerance or a `factor` without
`spread` (`invalid-tolerance`), duplicate kinds (`duplicate-kind`), two
declarations with the same collection, kinds and path (`duplicate-volatile`) and
more than 256 (`volatile-limit`), at paths like `/volatile/0/path`. The
normalized extraction states each declaration's `collection`, sorts its `kinds`
and sorts the declarations by collection, path and kinds; an empty list is
dropped.

Both sides' declarations apply to a matched pair, each side's by its own item's
kind. Where several apply at one concrete path, the tighter wins, bound by
bound, so variation never hides more than either side allows: no tolerance is
the loosest; between tolerances, the smaller `absolute`, the smaller `relative`,
and every `spread` of both, each of which must hold (of the same spread, so the
smaller `factor`), while a bound only one of them declares doesn't apply. The
combination is symmetric: it doesn't matter which side, or which declaration on
one side, declared what, so a reversed comparison judges every value the same
way. A pair's varied paths are every concrete path a declaration matches in
either item whose values differ, sorted by UTF-16 code units; its content is
equal modulo variation when nothing differs outside those paths and every varied
path is within.

Comparators stay deterministic: the engine's `volatility` module is the one
definition of these rules, which the default comparator, rules comparators,
comparison validation and the `vary` operation share. Official results are what
CI publishes.

### Generated values

A declaration with `"generated": true` and a `basis` declares a **generated
value**: one an extractor generated from an identifiable input, such as a
summary a language model wrote. It is judged by its basis, never by its wording
([design](../design/generated-values.md)):

```json
{"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
```

- `basis` is required with `generated` (`true`, its only value) and allowed only
  with it (`invalid-generated`). It is a pointer under `/data/` into the same
  item, with a spread's `*` rule (`invalid-volatile-path`). A generated
  declaration has no `tolerance` (`invalid-tolerance`): its basis is its
  tolerance.
- The basis can't be volatile: no declaration whose collection and kinds overlap
  may have a path equal to, inside or containing the basis path, including the
  generated value's own (`volatile-basis`, at `/volatile/N/basis`).
- In every item a generated declaration matches, the basis is an object of 1 to
  16 parts, each named by a letter then up to 63 letters, digits, `_` or `-`,
  each a nonempty string of at most 256 UTF-8 bytes (`invalid-basis`); usually a
  `sha256:` hash, or a verbatim model ID. An item has a basis exactly when it
  has the value (`missing-basis` at the value, `orphan-basis` at the basis).
- A matched pair's concrete generated value is judged by its bases: equal bases
  make any difference of the value within
  (`{path, within: true, generated: true}`); bases that differ, even with equal
  values, are beyond, and name the parts that differ, including parts on one
  side only, in UTF-16 order (`because`); a value on one side only is beyond,
  with a `reason` (`Generated only before`, `Generated only after`). The basis
  path belongs to its value: a basis difference is reported only through the
  value's entry, never as a data difference or a varied path of its own.
- Where several declarations apply at one concrete path, a generated one is
  tighter than any other; between generated ones with different basis pointers,
  every basis counts: the value is beyond when any of them differs, and
  `because` names the parts that differ in any of them.

The normalized declaration keeps `generated` and `basis`; extractions without
them keep their bytes and digests. The **basis digest** is `sha256:` and the
lowercase hex SHA-256 of the basis's RFC 8785 canonical JSON; with the
declaration's `path` it keys the runner's
[generation store](../runner/caches.md#generation-store).

## Canonical bytes

Canonical bytes use RFC 8785 JSON canonicalization after sorting entities and
relationships by UTF-16 code-unit ID order. Omitted item data becomes `{}`.
Evidence, previous IDs and extraction metadata are excluded; kind, label, data,
confidence, relationship endpoints, IDs, the normalized `volatile` declarations
and `missingInputs` are included. Volatile values are data like any other, so
two runs that varied within tolerance have different digests. Negative zero
canonicalizes as zero. Object keys and numeric spelling follow RFC 8785, not
locale sorting or host default insertion order. The extraction digest is the
lowercase SHA-256 of those UTF-8 bytes.

# Extraction and comparison schemas

## Extraction schema

Every extraction shares the same top-level envelope, and its `schema` field
selects the domain-specific rules that apply to its entities and relationships.

Both the protocol and domain schemas are currently at version 0
(`protocolVersion: 0`, `graph/v0`, and so on). They are pre-stable and may still
change incompatibly until version 1.

<!-- prettier-ignore -->
| Field | Description |
|---|---|
| `protocolVersion` | Always `0`. |
| `schema` | The domain schema the extraction follows, such as `graph/v0`, `api/v0` or `metrics/v0`. |
| `entities` | Things in the code, each with a stable `id`, a `kind` and a `label`. |
| `relationships` | Directed connections between entities, each with its own stable `id` and `from` and `to` entity IDs. |
| `vocabularies` | Optional typed conventions the extraction follows over its schema, such as `dependency-injection/v0` over `architecture/v0` (below). |
| `volatile` | Optional `data` that may vary between runs at the same revision, and how much: see [Volatile data](how-it-works.md#volatile-data). |
| `metadata` | Optional information about how the extraction was produced. |

Entities and relationships can also include `data` (domain-specific properties),
`evidence` (where a fact came from), `confidence`, and `previousIds` (to declare
a rename).

<!-- prettier-ignore -->
| Domain schema | Use it for | Additional rules |
|---|---|---|
| `graph/v0` | General entities and relationships | Relationships must reference existing entities |
| `dag/v0` | Pipelines and build graphs | No cycles |
| `treemap/v0` | Containment, such as files in directories | A forest (at most one parent each, no cycles); leaves carry a nonnegative `data.value` |
| `api/v0` | Public interfaces | Declarations carry `data.signature`, and optionally `data.contract` for [compatibility](../models/api-compatibility.md) |
| `database/v0` | Databases and data models | Columns carry `data.type`, and optionally `data.databaseType` (below) |
| `metrics/v0` | Measurements | Every entity carries numeric `data.value`, and optionally a `data.unit` |
| `architecture/v0` | Components, services and infrastructure | As `graph/v0` |

In `database/v0`, a column's `data.type` holds the type as declared in the
framework or source code (like Prisma's `String`, Django's `CharField`, or EF
Core's store type). When an extractor knows the underlying database's native
type—including arguments like `varchar(200)`, `decimal(10,2)`, or
`nvarchar(max)`—it puts that in `data.databaseType`. Because it's more specific,
viewers display it in place of `data.type`, making changes such as
`varchar(120)` to `varchar(200)` immediately visible. Omit `data.databaseType`
or set it to `null` when it isn't known.

Database columns can also set boolean `data.nullable` and `data.primaryKey`
fields. Meanwhile, `constraint` and `primary-key` entities can name their table
and columns by label (`data.table`, `data.columns`), and `foreign-key` or
`relation` relationships between tables can list their columns (`data.columns`,
`data.principalColumns`).

Domain schemas only type the `data` fields that viewers depend on; everything
else in `data` is free-form. The engine validates every typed field and
pinpoints any violation by path, such as `/entities/3/data/nullable`. Each
domain schema is also published as a JSON Schema (for example,
`https://schemas.projections.githubnext.com/database/v0.json`), and the
extraction schema automatically applies whichever one `schema` names. See the
[schema reference](../reference/schemas/README.md) for the complete list of
typed fields.

A **vocabulary** adds typed conventions on top of a domain schema for a specific
kind of system; an extraction opts in by listing it in `vocabularies`.
`architecture/v0` currently defines three: `dependency-injection/v0`
([model](../models/dependency-injection-model.md)), `infrastructure/v0`
([model](../models/infrastructure-model.md)), and `runtime-policy/v0`
([model](../models/runtime-policy-model.md)). The engine validates a
vocabulary's typed fields the same way it validates a domain schema, and
renderers tailored to that vocabulary accept extractions declaring it. An
`architecture/v0` extraction without any vocabulary remains valid with open
`data`.

The machine-readable JSON Schema lives at
[`packages/schemas/schemas/extraction/v0.json`](../../packages/schemas/schemas/extraction/v0.json)
and is published at
`https://schemas.projections.githubnext.com/extraction/v0.json`.

### What Projections adds

Your extractor only writes the extraction itself. When Projections saves it, the
runner wraps it with a `provenance` section recording the revision, the
extractor and its configuration, and a content digest. Because extractors never
write provenance themselves, a saved extraction can't falsely claim to come from
a different revision.

Provenance also distinguishes commits from working trees. A working-tree
extraction includes uncommitted changes, so it records the base commit it
started from and flags the tree as modified. Since it can't be reproduced from
Git alone, hosted views that require verifiable commits won't accept it.

---

## Comparison schema

A comparison relates two extractions produced by the same projection.

<!-- prettier-ignore -->
| Field | Description |
|---|---|
| `protocolVersion` | Always `0`. |
| `changes` | One entry for each entity or relationship that was added, removed or modified, whose identity changed, or whose [volatile](how-it-works.md#volatile-data) data varied within tolerance. Other unchanged items are omitted. |
| `steps` | Ordered groups of change IDs. Changes in the same step are presented together. |
| `order` | Optional. `{"reverse": "mirror"}` (the default) plays `steps` backward when the comparison is reversed; `{"reverse": "explicit"}` supplies a separate `reverseSteps` order. |
| `variation` | Present when a change has `varied`: `within` counts the unchanged changes that only varied within tolerance, `beyond` the modified changes with a value beyond it. |
| `metadata` | Optional information about how the comparison was made. |

Each entry in `changes` has the following fields:

<!-- prettier-ignore -->
| Field | Description |
|---|---|
| `id` | Identifies the change within the comparison. By convention, the entity's ID after the change, or before it if the entity was removed. |
| `collection` | `entities` or `relationships`. |
| `before` | The item's IDs in the before extraction: empty when it was added, several when items were merged. |
| `after` | The item's IDs in the after extraction: empty when it was removed, several when an item was split. |
| `status` | `added`, `removed`, `modified` or `unchanged` (for a rename that didn't change content). |
| `correspondence` | How the before and after items were matched: `exact`, `declared` (a rename), `split`, `merge` or `none`. |
| `varied` | Present when volatile values differ: each `{path, within}` (and a `reason` when a spread bound couldn't apply). |
| `summary` | Optional human-readable description, such as "Now depends on @acme/crypto". |

```json
{
  "protocolVersion": 0,
  "changes": [
    {
      "id": "package:@acme/auth",
      "collection": "entities",
      "before": ["package:@acme/auth"],
      "after": ["package:@acme/auth"],
      "status": "modified",
      "correspondence": "exact",
      "summary": "Now depends on @acme/crypto"
    },
    {
      "id": "package:@acme/crypto",
      "collection": "entities",
      "before": [],
      "after": ["package:@acme/crypto"],
      "status": "added",
      "correspondence": "none"
    }
  ],
  "steps": [
    { "changes": ["package:@acme/crypto", "package:@acme/auth"] }
  ]
}
```

The machine-readable JSON Schema lives at
[`packages/schemas/schemas/comparison/v0.json`](../../packages/schemas/schemas/comparison/v0.json)
and is published at
`https://schemas.projections.githubnext.com/comparison/v0.json`.

A saved comparison bundles both extractions, the comparator that produced it,
and any `notices` explaining differences between the two revisions—such as when
the head revision modifies or removes the projection definition, or when a
declared input is absent on one side (see each extraction's `missingInputs`).
Because comparators are deterministic, any viewer can rerun the comparator to
verify a saved comparison instead of taking it on faith. Notices are
informational and aren't verified.

---

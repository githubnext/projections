# Extraction and comparison schemas

## Extraction schema

Every extraction has the same envelope. The `schema` field selects the
additional rules that apply to its entities and relationships.

The protocol and domain schemas are at version 0 (`protocolVersion: 0`,
`graph/v0` and so on): they are pre-stable and may still change incompatibly.
Version 1 will be the first stable version.

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

Entities and relationships can also carry `data` (domain properties), `evidence`
(where the fact came from), `confidence`, and `previousIds` (to declare a
rename).

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

A `database/v0` column's `data.type` is the type as the framework or source
declares it (Prisma's `String`, Django's `CharField`, or EF Core's store type).
`data.databaseType`, when an extractor knows it, is the column's native type in
the database, as the database or its provider names it, with its arguments, such
as `varchar(200)`, `decimal(10,2)` or `nvarchar(max)`. It is the most specific
type available, so viewers show it in place of `data.type` and a change like
`varchar(120)` to `varchar(200)` is visible. Omit it, or write `null`, when the
extractor doesn't know the database type. Columns may also carry booleans
`data.nullable` and `data.primaryKey`; `constraint` and `primary-key` entities
may name their table and columns by label (`data.table`, `data.columns`), and
`foreign-key` or `relation` relationships between tables their columns
(`data.columns`, `data.principalColumns`).

Each domain schema types only the `data` fields that viewers rely on; any other
`data` is yours. The engine checks every typed field and reports a violation at
its path, such as `/entities/3/data/nullable`. Each domain schema is also
published as a JSON Schema, such as
`https://schemas.projections.githubnext.com/database/v0.json`, and the
extraction schema applies the one an extraction's `schema` names. The
[schema reference](../reference/schemas/README.md) lists every typed field.

A **vocabulary** types conventions over a domain schema for one kind of system,
which an extraction opts into by naming it in `vocabularies`. `architecture/v0`
has three: `dependency-injection/v0`
([model](../models/dependency-injection-model.md)), `infrastructure/v0`
([model](../models/infrastructure-model.md)) and `runtime-policy/v0`
([model](../models/runtime-policy-model.md)). The engine checks a declared
vocabulary's typed fields as it does a schema's, and renderers that present a
vocabulary accept extractions that declare it. An `architecture/v0` extraction
without one stays valid, with open `data`.

The machine-readable JSON Schema is
[`packages/schemas/schemas/extraction/v0.json`](../../packages/schemas/schemas/extraction/v0.json),
published at `https://schemas.projections.githubnext.com/extraction/v0.json`.

### What Projections adds

Your extractor writes only the extraction. When Projections saves one, it adds a
`provenance` section recording the revision, the extractor and its
configuration, and a digest of the extraction's content. Extractors never write
provenance themselves, so a saved extraction can't claim to come from a revision
it wasn't extracted from.

Provenance also records whether the revision was a commit or a working tree. An
extraction from a working tree includes uncommitted changes, so it identifies
the commit it was based on and is marked as modified. It can't be reproduced
from Git alone, and hosted views that require a verifiable commit don't accept
it.

---

## Comparison schema

A comparison relates two extractions from the same projection.

<!-- prettier-ignore -->
| Field | Description |
|---|---|
| `protocolVersion` | Always `0`. |
| `changes` | One entry for each entity or relationship that was added, removed or modified, whose identity changed, or whose [volatile](how-it-works.md#volatile-data) data varied within tolerance. Other unchanged items are omitted. |
| `steps` | Ordered groups of change IDs. Changes in the same step are presented together. |
| `order` | Optional. `{"reverse": "mirror"}` (the default) plays `steps` backward when the comparison is reversed; `{"reverse": "explicit"}` supplies a separate `reverseSteps` order. |
| `variation` | Present when a change has `varied`: `within` counts the unchanged changes that only varied within tolerance, `beyond` the modified changes with a value beyond it. |
| `metadata` | Optional information about how the comparison was made. |

Each change has:

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

The machine-readable JSON Schema is
[`packages/schemas/schemas/comparison/v0.json`](../../packages/schemas/schemas/comparison/v0.json),
published at `https://schemas.projections.githubnext.com/comparison/v0.json`. A
saved comparison records both extractions and the comparator that produced it,
and any `notices` explaining how the two revisions define the projection
differently—for example, that the head revision changes the definition or
doesn't define the projection—or that a declared input doesn't exist at one of
them (see each extraction's `missingInputs`). Because comparators are
deterministic, any viewer can rerun the comparator to check a saved comparison
rather than trusting it. Notices are informational and aren't verified.

---

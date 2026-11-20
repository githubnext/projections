# Prisma schema

This extractor parses `.prisma` schema files directly to capture your data
model—tables, views, columns with their types, keys, indexes, foreign keys, and
enums. Compared across a pull request, it shows which models, fields, relations,
and enum values were added or removed, and how types, defaults, and nullability
changed.

<!-- generated: facts -->

- ID: `prisma-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `*.prisma`, `**/*.prisma`

<!-- end generated: facts -->

## When to use it

Use this extractor in any repository with a Prisma schema when you want to
review data model changes as an entity-relationship diagram instead of a raw
schema file diff. Because Projections parses Prisma Schema Language directly, it
needs no Node.js, no Prisma installation, no database, and no `--trust`. It runs
fast and is safe on any pull request, including forks. Moving or reformatting
schema files, editing comments, or renaming a model or field while keeping its
`@map` or `@@map` produces no diff.

Keep in mind that this models what your schema files declare, not a live
database. It never connects, reads migrations, or detects drift against
production. For EF Core use [`efcore-schema`](efcore-schema.md), and for Django
use [`django-schema`](django-schema.md).

## What it reads

- Schema files selected by `schema` (a single file or folder) or `schemas` (a
  list of files or folders, taking precedence over `schema`). A folder includes
  every `.prisma` file inside it, matching Prisma's multi-file schema support.
  If neither option is set, every `.prisma` file in the repository is merged
  into one schema—so specify explicit paths if your repository contains multiple
  independent schemas.
- `datasource` (its `provider`), `model`, `view`, `enum`, and composite `type`
  blocks, along with field types, modifiers, and database-shaping attributes:
  `@id`, `@unique`, `@default`, `@relation`, `@map`, `@updatedAt`, `@ignore`,
  `@db.*` native types, `@@id`, `@@unique`, `@@index`, `@@fulltext`, `@@map`,
  `@@schema`, and `@@ignore`.

It never runs generators or config scripts and never reads datasource URLs or
environment variables. Rather than guessing on broken input, a malformed or
inconsistent schema fails with the exact file and line (for example, an unknown
type or attribute, a relation without exactly one opposite field, or a model
lacking a unique criterion).

Each model becomes a `table` (and each `view` block becomes a `view`),
identified by its database name and `@@schema` namespace. Each field becomes a
`column`, with `data.type` holding the Prisma scalar or enum and `databaseType`
holding any `@db.*` native type formatted as the database names it (for example,
`@db.VarChar(200)` becomes `varchar(200)`), along with nullability, list
modifiers, and defaults (`autoincrement()`, `uuid()`, `now()`). Keys, indexes,
and foreign keys become `constraint` entities with their `data.type`, with
foreign keys recording their target, columns, and referential actions. Each
`enum` lists its values using their mapped names.

If you prefer, pass `snapshot` to read a previously exported `database/v0`
extraction instead. Snapshot files are read from each revision being extracted,
so every compared revision needs its own.

## Options

<!-- generated: inputs -->

| Input      | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| `schema`   | Prisma schema file or folder; otherwise discovers .prisma files. |
| `schemas`  | Multiple schema files or folders.                                |
| `snapshot` | Pre-exported effective schema.                                   |

<!-- end generated: inputs -->

## What a comparison shows

The [`database`](../renderers/database.md) renderer draws each table as a card
with its columns, keys, and indexes, each view as a dashed card, each enum as a
card listing its values, and each foreign key as a link from the dependent row
to the principal one. Columns typed by an enum connect to that enum card with a
dotted line.

- **Tables, views, and enums** highlight additions, removals, and modifications,
  along with columns added or removed inside them.
- **Column changes** call out native type changes (`varchar(120)` to
  `varchar(200)`, or the Prisma type like `String` to `Int` when no `@db.*`
  attribute is present) and nullability shifts—adding or removing `?` appears as
  made optional or made required.
- **Keys, indexes, and foreign keys** track additions, removals, and edits, such
  as an index becoming `@@fulltext`, a changed sort order, or a relation's
  `onDelete` switching from `Cascade` to `Restrict`.
- **Enum values** highlight values added or removed.

The summary bar tallies tables, columns, constraints, foreign keys, and enums
with their deltas (`5 tables +1 · 24 columns +8 ~2`), then summarizes
higher-level shifts: changed column types, columns made required or optional,
renames, and enum value counts with additions and removals (`5 enum values +2`).
Clicking any count filters down to the affected rows.

Because IDs come from database names, changing a table's or column's mapped name
(`@@map`, `@map`) appears as a removal and an addition. Declare the old ID in
`correspondence` in your definition to track it as a rename instead.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "prisma-schema",
  "id": "prisma-schema",
  "renderer": "database",
  "title": "Prisma schema"
}
```

<!-- end generated: definition -->

## Limitations

- Implicit many-to-many relations are modeled as relationships between the two
  tables (named after the relation) rather than as Prisma's generated join
  tables; the `database` renderer links the two table headers without an
  arrowhead.
- Fields marked `@ignore` or typed `Unsupported(...)`, models marked `@@ignore`,
  and composite types do not appear as columns.
- Unnamed constraints are identified by their columns rather than
  database-generated names, and neither `relationMode` nor implicit
  referential-action defaults are inferred.
- Provider-specific validation (such as whether a database supports a given
  native type or index algorithm) is left to `prisma validate`.
- Syntax introduced in newer Prisma releases may require a Projections update;
  until then, unrecognized syntax fails rather than being misread.
- Large schemas open at a readable scale (text at least 8 px) and scroll instead
  of shrinking to fit the viewport.

## Related

- [`database`](../renderers/database.md) is the renderer that draws these
  schemas.
- [`efcore-schema`](efcore-schema.md) and [`django-schema`](django-schema.md)
  provide the same model for EF Core and Django.
- [The default comparator](../comparators/default.md) determines what changed
  between revisions.

## How it works

See the [package README](../../../packages/extractors/prisma-schema/README.md)
for details on the parser, supported syntax, and extraction model.

## Build your own

Consider writing a custom extractor when a Prisma schema is not the model you
want to review:

- **Another TypeScript data layer**, such as Drizzle, TypeORM, Sequelize,
  MikroORM, or hand-written SQL migrations.
- **The live database instead of the schema**, including deployed state, schema
  drift, or the migration files added under `prisma/migrations`.
- **Facts the schema does not track**, like model ownership by team, fields
  holding personal data, or row counts from an internal inventory.

Try the lighter options first: `schema` or `schemas` picks one schema out of
several, and `snapshot` reads a schema exported by your own tooling. To change
the visual layout, keep this extractor and write a custom renderer; to flag
destructive changes (such as a dropped column or a field made required without a
default), add a comparator file.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language to scaffold
the definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. Emit a `database/v0` extraction and set the definition's renderer to
`database` to get the same diagram view. You can also choose **Ask an agent to
write it** and describe what you want to see.

**With the CLI**, scaffold a new extractor while keeping the `database`
renderer:

```sh
projections init <id> --language node --renderer database
```

An extractor is any program that prints an extraction. Run
`projections show -p <id> --trust` while you iterate—an open projection tab
picks up your uncommitted edits ("Your edits") and flags stale results, and the
Testing view runs your projection's checks. Walk through
[Write your first extractor](../../guides/first-extractor.md) to get started,
check [Extraction schema](../../guides/schemas.md#extraction-schema) for the
output format, and see the
[`database/v0` schema](../../reference/schemas/database.md) for the fields the
`database` renderer expects.

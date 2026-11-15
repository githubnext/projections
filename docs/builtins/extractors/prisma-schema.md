# Prisma schema

The data model a Prisma schema declares: its tables and views, columns with
their types, keys, indexes, foreign keys and enums, read from the `.prisma`
files themselves. Compared across a pull request, it answers "what does this
change do to the schema: which models, fields, relations and enum values arrive
or leave, and which types, defaults and nullability change?"

<!-- generated: facts -->

- ID: `prisma-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `*.prisma`, `**/*.prisma`

<!-- end generated: facts -->

## When to use it

Use it in any repository with a Prisma schema, to review data model changes as
an entity-relationship diagram rather than a schema file diff. Projections
parses the Prisma Schema Language itself, so it needs no Node.js, no Prisma
installation, no database and no `--trust`: it is safe to run on any pull
request, including one from a fork, and it is quick. Moving or reformatting
schema files, editing comments, and renaming a model or field while keeping its
`@map` or `@@map` change nothing.

It describes the schema, not a live database: it doesn't connect, read
migrations or detect drift. For EF Core use [`efcore-schema`](efcore-schema.md),
for Django [`django-schema`](django-schema.md).

## What it reads

- The schema files: `schema` (one file or a schema folder) or `schemas` (a list
  of them, which wins over `schema`). A folder contributes every `.prisma` file
  beneath it, as Prisma's multi-file schemas do. With neither, every `.prisma`
  file in the repository forms one schema, so name the files when the repository
  holds independent schemas.
- `datasource` (its `provider`), `model`, `view`, `enum` and composite `type`
  blocks, field types and modifiers, and the attributes that shape the database:
  `@id`, `@unique`, `@default`, `@relation`, `@map`, `@updatedAt`, `@ignore`,
  `@db.*` native types, `@@id`, `@@unique`, `@@index`, `@@fulltext`, `@@map`,
  `@@schema` and `@@ignore`.

It never runs generators or configuration programs and never reads datasource
URLs or environment variables. A malformed or inconsistent schema fails with the
file and line (an unknown type or attribute, a relation without exactly one
opposite field, a model without a unique criterion), rather than being
approximated.

Each model is a `table` (a `view` block a `view`), identified by its database
name and `@@schema` namespace. Each field is a `column`: `data.type` is the
Prisma scalar or enum, and `databaseType` the `@db.*` native type as the
database names it (`@db.VarChar(200)` is `varchar(200)`), with nullability,
lists and defaults (`autoincrement()`, `uuid()`, `now()`). Keys, indexes and
foreign keys are `constraint` entities with their `data.type`; foreign keys
record their target, columns and referential actions. Each `enum` lists its
values, using mapped names.

`snapshot` reads a `database/v0` extraction exported earlier instead; it is read
from the revision being extracted, so each revision you compare needs its own.

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
with its columns, keys and indexes, each view as a dashed card, each enum as a
card of its values, and each foreign key as a link from the dependent row to the
principal one; a column typed by an enum links to it with a dotted line.

- **Tables, views and enums** added, removed or modified, and **columns** added
  or removed within them.
- **Column changes**: a new native type reads as a type change (`varchar(120)`
  to `varchar(200)`; without `@db.*`, the Prisma type, such as `String` to
  `Int`), and adding or removing `?` as made optional or made required.
- **Keys, indexes and foreign keys** added, removed or modified: an index that
  becomes `@@fulltext`, a sort order, a relation's `onDelete` from `Cascade` to
  `Restrict`.
- **Enum values** added or removed.

The summary bar counts tables, columns, constraints, foreign keys and enums,
each with its changes (`5 tables +1 · 24 columns +8 ~2`), then states what the
counts can't: column types changed, columns made required or optional, anything
renamed, and the enums' values with those added and removed
(`5 enum values +2`), each filtering to its rows.

Changing a table's or column's database name (`@@map`, `@map`) gives it a new
ID, so it reads as a removal and an addition; declare the old ID in the
definition's `correspondence` to show it as a rename.

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

- Implicit many-to-many relations are relationships between the two tables,
  named by the relation, not the join tables Prisma creates; the `database`
  renderer links the two tables' headers, with no arrowhead.
- Fields marked `@ignore` or typed `Unsupported(...)`, models marked `@@ignore`,
  and composite types are not columns.
- Unnamed constraints are identified by their columns, not the names the
  database would generate, and `relationMode` and implicit referential-action
  defaults aren't inferred.
- Database-specific checks (whether a provider supports a native type or an
  index algorithm) are left to `prisma validate`.
- New schema syntax from a newer Prisma release may need a Projections update;
  until then such a schema fails rather than being misread.
- A large schema opens at a readable size (text no smaller than 8 px) and
  scrolls, rather than shrinking to fit.

## Related

- [`database`](../renderers/database.md), the renderer that draws it.
- [`efcore-schema`](efcore-schema.md) and [`django-schema`](django-schema.md),
  the same model for EF Core and Django.
- [The default comparator](../comparators/default.md), which decides what
  changed.

## How it works

The [package README](../../../packages/extractors/prisma-schema/README.md)
details the parser, what it covers and the extraction's model.

## Build your own

Write your own extractor when the Prisma schema isn't the model you want to
review:

- **Another TypeScript data layer**: Drizzle, TypeORM, Sequelize or MikroORM, or
  SQL migrations written by hand.
- **The live database, not the schema**: what is deployed, drift from the
  schema, or the migrations a change adds under `prisma/migrations`.
- **Facts the schema doesn't have**: which team owns each model, which fields
  hold personal data, row counts from your own inventory.

Try the lighter options first: `schema` or `schemas` selects one schema among
several, and `snapshot` reads a schema your own tooling exported. To draw the
schema differently, keep this extractor and write a renderer; to say which
changes are destructive (a dropped column, a field made required without a
default), add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer; print a
`database/v0` extraction and set the definition's renderer to `database` to draw
it as this one is. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep this schema's renderer:

```sh
projections init <id> --language node --renderer database
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it; an open projection tab uses
your uncommitted edits ("Your edits") and says when its results are out of date,
and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints; the [`database/v0` schema](../../reference/schemas/database.md)
lists the fields the `database` renderer reads.

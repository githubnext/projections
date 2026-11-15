---
description: A Prisma data model as a database schema (database/v0)
---

# Prisma schema — `database/v0`

`prisma-schema` describes a Prisma data model as `table`, `view`, `column`,
`constraint` and `enum` entities. `contains`, `constrains`, `references`,
`foreign-key`, `enum-type` and `many-to-many` relationships connect them. Every
column has a string `data.type`. The extraction is the schema's **desired
model**, not the actual database, migrations, drift or generated SQL.

```json
{
  "id": "database",
  "extractor": "prisma-schema",
  "inputs": { "schema": "prisma/schema" }
}
```

- `inputs.schema`: one repository-relative schema file, or a schema folder.
- `inputs.schemas`: a nonempty array of schema files or folders; takes
  precedence over `schema`.
- A folder contributes every `.prisma` file beneath it, including nested
  folders, as Prisma's multi-file schemas (`prismaSchemaFolder`, and the
  `prisma/schema` folder convention) do. Files are combined into one schema in
  sorted path order; the order doesn't affect the result.
- Without either input, all of the repository's `.prisma` files form one schema.
  Select explicitly when a repository contains independent schemas.
- `inputs.snapshot`: a pre-exported `database/v0` extraction; see below.

## How schemas are read

Projections parses Prisma Schema Language itself, in Rust. Extraction needs no
Node.js, no Prisma installation, no database and no trust, and runs no
generators or configuration programs. Datasource URLs and environment variables
are never read or included.

This is a deliberate exception to the rule that extractors use the examined
project's own installed tools. Prisma has no stable public API for its schema:
the schema engine WebAssembly inside the `prisma` package is internal, and its
calling convention has changed between releases without notice. The schema
language, by contrast, is Prisma's documented, stable format. Prisma releases
that add new schema syntax may need a Projections update; until then such
schemas fail explicitly rather than being approximated.

The parser covers:

- `datasource` (its `provider`; `postgres` is read as `postgresql`) and
  `generator` blocks, whose other properties are accepted and ignored.
- `model`, `view`, composite `type` and `enum` blocks; `//` and `///` comments.
- Field types, `?` optional and `[]` list modifiers, `Unsupported("...")`.
- `@id`, `@unique`, `@default`, `@relation`, `@map`, `@updatedAt`, `@ignore`,
  `@db.*` native types, `@@id`, `@@unique`, `@@index`, `@@fulltext`, `@@map`,
  `@@schema` and `@@ignore`, with their arguments: `map`, `name`, `fields`,
  `references`, `onDelete`, `onUpdate`, `sort`, `length`, `ops`, `type` and
  `clustered`.
- One-to-one, one-to-many, self and many-to-many relations, named or unnamed.

Malformed or inconsistent schemas fail with the file and line: syntax errors,
unknown types, attributes or arguments, duplicate names, relations without
exactly one opposite field, relation or index fields that don't exist, invalid
default values, models without a unique criterion, more than one datasource and
unknown providers. Connector-specific capability checks, such as whether a
database supports a native type or index algorithm, are left to Prisma; run
`prisma validate` for them.

## What the extraction contains

- `table`: identified by database namespace (`@@schema`) and table name
  (`@@map`, otherwise the model name). Data: `namespace`, `provider`.
- `view`: a `view` block, identified by its database namespace and name, as for
  tables. Its columns and constraints belong to it as a table's do. Data:
  `namespace`, `provider`.
- `column`: identified by table and column name (`@map`, otherwise the field
  name). Data: `type` (scalar or enum ID), `nativeType` (`[name, [args]]`),
  `databaseType` (the `@db.*` native type as the database names it:
  `@db.VarChar(200)` is `varchar(200)`, `@db.DoublePrecision` is
  `double precision`, MySQL's `@db.UnsignedInt` is `int unsigned`; `null`
  without one), `nullable`, `list`, `hasDefault`, `default`, `updatedAt`.
- `constraint`: identified by table, kind and database name (`map`), or ordered
  columns when unnamed; foreign keys also name their target table. Data: `type`
  (`primary-key`, `unique`, `index` or `foreign-key`); `fields` with
  `sortOrder`, `length` and `operatorClass`; `indexType` (`normal` or
  `fulltext`), `algorithm`, `clustered`, `databaseName`; foreign keys'
  `columns`, `target`, `references`, `onDelete`, `onUpdate`.
- `enum`: identified by database name (`@@map`), within its database namespace
  when multiSchema's `@@schema` names one (`enum:<schema>/<name>`). Data:
  `values`, using mapped value names; `namespace`.

Defaults are literals, or `{name, args}` for functions such as
`autoincrement()`, `uuid()` (`args: [4]`), `cuid()` (`args: [1]`), `nanoid()`,
`now()` and `dbgenerated(...)`. `BigInt` defaults are strings, `DateTime`
defaults are normalized RFC 3339 strings, and enum defaults use mapped value
names.

Implicit many-to-many relations are `many-to-many` relationships between the two
tables, named by the relation, not invented join tables. Fields marked `@ignore`
or typed `Unsupported(...)`, models marked `@@ignore`, composite types and their
fields are not columns; an index over an `Unsupported` column keeps the column
name without a `constrains` relationship. Indexes over composite-type paths fail
explicitly.

These semantics match those of Prisma's own schema engine (`get_dmmf`), which an
earlier version of this extractor ran: the fixtures in `tests/fixtures/expected`
were produced by Prisma 6.19.3 and the tests require the parser to reproduce
them. Two departures are deliberate, because DMMF loses information the database
has: views are `view` entities rather than tables, and enums carry their
`@@schema` namespace. Changing an index's kind, a native type, a sort order, a
default or the datasource provider is a semantic change; moving or reformatting
schema files, comments, and renaming a model or field while keeping its
`@map`/`@@map` are not.

Each item's evidence names its schema file and line. Metadata records the schema
files and the extraction's limitations.

## Pre-exported extractions

`inputs.snapshot` names a repository-relative, pre-exported `database/v0`
extraction JSON file. It is read natively, requires no trust, validates graph
structure and column types, and labels its authority
`pre-exported database schema`. A pre-exported file's freshness and claims are
its producer's responsibility.

## Tests

```sh
cargo test -p projections-extractor-prisma-schema
```

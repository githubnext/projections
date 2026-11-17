# Rails schema

The schema a Rails application's `db/schema.rb` declares: its tables and columns
with their types, keys, indexes, check constraints, foreign keys and PostgreSQL
enums, read from the file itself. Compared across a pull request, it answers
"what does this migration do to the schema: which tables, columns, indexes and
foreign keys arrive or leave, and which types, defaults and nullability change?"

<!-- generated: facts -->

- ID: `rails-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `db/schema.rb`, `**/db/schema.rb`,
  `db/*_schema.rb`, `**/db/*_schema.rb`

<!-- end generated: facts -->

## When to use it

Use it in any Rails application that keeps `db/schema.rb` (Active Record's
default `schema_format`), to review migrations as an entity-relationship diagram
rather than as a migration file and a regenerated dump. Projections reads the
file itself, so it needs no Ruby, no Bundler or gems, no database and no
`--trust`: it is quick, safe to run on any pull request, including one from a
fork, and it works on every revision in your history, even ones whose gems you
no longer have installed.

It describes the schema, not a live database: it doesn't connect, read
migrations or detect drift. For Prisma use [`prisma-schema`](prisma-schema.md),
for Django [`django-schema`](django-schema.md), for EF Core
[`efcore-schema`](efcore-schema.md). Pair it with
[`rails-routes`](rails-routes.md) to see a change's routes beside its schema.

## What it reads

- The schema files: `schema` (one file) or `schemas` (a list, which wins over
  `schema`). With neither, the application's `db/schema.rb` and each
  `db/<database>_schema.rb` beside it (Rails' multiple databases, such as
  `db/queue_schema.rb`), wherever the application is in the repository; an
  engine's dummy app under `test/` or `spec/` is ignored. A repository with more
  than one application asks you to choose with `schema`.
- `create_table` blocks: each column (`t.string`, `t.jsonb`, `t.virtual`,
  `t.enum`, `t.references`, `t.timestamps`, `t.column` and any adapter's type)
  with `null:`, `default:`, `limit:`, `precision:`, `scale:`, `array:` and its
  other options; the implicit or declared primary key (`id:`, `primary_key:`,
  composite keys); `t.index`, `t.check_constraint`, `t.unique_constraint` and
  `t.exclusion_constraint`.
- `add_foreign_key`, `add_index`, `add_check_constraint`, `create_enum`,
  `enable_extension`, and Scenic's `create_view`.
- `config/initializers/inflections.rb` beside `db/` (or `inflections`), whose
  `irregular`, `uncountable`, `plural` and `singular` rules decide a foreign
  key's default column (`add_foreign_key "pots", "cacti"` is `cactus_id`), as
  Rails decides it.

Each table is a `table` and each column a `column`, whose `data.type` is its
Rails type with its size as the schema file states it: `string(100)`,
`decimal(10,2)`, `datetime(6)`, `string[]` for an array, the enum's name for a
PostgreSQL enum column. Keys, indexes and foreign keys are `constraint`
entities; foreign keys record their target, columns and `on_delete` and
`on_update`.

Any statement that isn't one of Active Record's schema declarations (`execute`,
a plugin's `create_function`, a conditional) is listed in the extraction's
`metadata.skipped` and reported as a diagnostic, not interpreted. A file without
an `ActiveRecord::Schema.define` block, or with unbalanced Ruby, fails with the
file and line.

`snapshot` reads a `database/v0` extraction exported earlier instead; it is read
from the revision being extracted, so each revision you compare needs its own.

## Options

<!-- generated: inputs -->

| Input         | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `inflections` | Inflections initializer; default config/initializers/inflections.rb beside db/.                            |
| `schema`      | Schema file (db/schema.rb or db/<database>_schema.rb); otherwise discovers the application's schema files. |
| `schemas`     | Multiple schema files.                                                                                     |
| `snapshot`    | Pre-exported effective schema.                                                                             |

<!-- end generated: inputs -->

## What a comparison shows

The [`database`](../renderers/database.md) renderer draws each table as a card
with its columns, keys and indexes, each PostgreSQL enum as a card of its
values, and each foreign key as a link from the dependent row to the principal
one.

- **Tables, enums and views** added, removed or modified, and **columns** added
  or removed within them.
- **Column changes**: a new type or size reads as a type change (`string(100)`
  to `string(200)`, `integer` to `bigint`), and `null: false` added or removed
  as made required or made optional.
- **Keys, indexes and foreign keys** added, removed or modified: an index made
  unique, a partial index's `where:`, a foreign key's `on_delete:`.

The summary bar counts tables, columns, constraints, foreign keys and enums,
each with its changes (`5 tables +2 · 40 columns +18 ~1`), then the column types
changed and the columns made required or optional.

The schema version line (`define(version: ...)`) changes on every migration; it
is metadata, so a migration that changes nothing else shows no change. So does
upgrading Rails: a Rails 7 schema's timestamps without `precision:` and a Rails
6 schema's `precision: 6` are both `datetime(6)`. Renaming a table or column
(`rename_column`) gives it a new ID, so it reads as a removal and an addition;
declare the old ID in the definition's `correspondence` to show it as a rename.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "rails-schema",
  "id": "rails-schema",
  "renderer": "database",
  "title": "Rails schema"
}
```

<!-- end generated: definition -->

## Screenshot

A migration that adds user accounts to a license server: `users` and
`license_purchases` arrive, and `licenses` gains a `user_id` foreign key and
makes `email` optional
([`docs/images/sources/account-recovery`](../../images/sources/account-recovery/README.md)).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../images/readme/rails-schema-dark.png">
  <img width="760" alt="The database renderer comparing two Rails schemas: the users and license_purchases tables added in green, licenses with a new user_id column and an email column made optional, and foreign keys from licenses and license_purchases to users" src="../../images/readme/rails-schema-light.png">
</picture>

## Limitations

- `db/structure.sql` (`config.active_record.schema_format = :sql`) isn't read.
  Export a `database/v0` snapshot from it, or write your own extractor.
- Column types are Rails types with their sizes, not the adapter's SQL types
  (`string` is `character varying` on PostgreSQL and `varchar(255)` on MySQL).
- Statements outside Active Record's schema DSL are listed, not interpreted:
  functions, triggers and policies a plugin dumps aren't drawn.
- Enabled extensions (`enable_extension`) are recorded in the extraction's
  metadata, not drawn, so enabling one shows no change.
- An application's inflections are read when they are declared literally in the
  initializer; computed or regular-expression rules Rust's regex engine can't
  compile are reported and left out.
- A large schema opens at a readable size and scrolls, rather than shrinking to
  fit.

## Related

- [`database`](../renderers/database.md), the renderer that draws it.
- [`rails-routes`](rails-routes.md), the application's routes.
- [`prisma-schema`](prisma-schema.md), [`django-schema`](django-schema.md) and
  [`efcore-schema`](efcore-schema.md), the same model for other frameworks.
- [The default comparator](../comparators/default.md), which decides what
  changed.

## How it works

The [package README](../../../packages/extractors/rails-schema/README.md)
details what the reader covers and the extraction's model.

## Build your own

Write your own extractor when `db/schema.rb` isn't the model you want to review:

- **`db/structure.sql`**, or the live database: what is deployed, drift from the
  schema.
- **Models, not tables**: Active Record associations, validations and callbacks,
  which need the application loaded (`bin/rails runner`, with `--trust`).
- **Facts the schema doesn't have**: which team owns each table, which columns
  hold personal data.

Try the lighter options first: `schema` or `schemas` selects one application or
database, and `snapshot` reads a schema your own tooling exported. To say which
changes are destructive (a dropped column, a column made required without a
default), add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor**, and
pick its language. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep this schema's renderer:

```sh
projections init <id> --language node --renderer database
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and the [`database/v0` schema](../../reference/schemas/database.md) lists the
fields the `database` renderer reads.

---
description: A Rails application's db/schema.rb as a database schema (database/v0)
---

# Rails schema — `database/v0`

`rails-schema` describes the schema a Rails application's `db/schema.rb`
declares as `table`, `view`, `column`, `constraint` and `enum` entities.
`contains`, `constrains`, `references`, `foreign-key` and `enum-type`
relationships connect them, as [`prisma-schema`](../prisma-schema/README.md)'s
do. Every column has a string `data.type`.

```json
{
  "id": "database",
  "extractor": "rails-schema",
  "inputs": { "schema": "web/db/schema.rb" }
}
```

- `inputs.schema`: one schema file; `inputs.schemas`: a list of them, which wins
  over `schema`.
- Without either, the application's schema files: `db/schema.rb` and each
  `db/<database>_schema.rb` (Rails' multiple databases, such as Solid Queue's
  `db/queue_schema.rb`) beside it, at any depth. Files under `test/`, `spec/`,
  `vendor/`, `tmp/` and the like (an engine's dummy app) are ignored. More than
  one application fails and asks for `schema`.
- `inputs.inflections`: the initializer whose inflections decide default
  foreign-key columns; default `config/initializers/inflections.rb` beside
  `db/`.
- `inputs.snapshot`: a pre-exported `database/v0` extraction, read as
  `prisma-schema` reads one.

## How schemas are read

Projections reads `db/schema.rb` itself, with
[`ruby-support`](../ruby-support/README.md)'s reader: no Ruby, Bundler, gems,
Rails boot or database, and no trust. The file is Active Record's schema
dumper's output, so it is a small, regular part of Ruby, and reading it
statically works on every revision, including those whose gems are no longer
installed. Evaluating it against a stub of Active Record's DSL in Ruby would
need Ruby on every machine and every revision for no more information.

It reads `ActiveRecord::Schema.define` and `ActiveRecord::Schema[7.1].define`,
and inside them:

- `create_table` with `id:` (`false`, a type or `{type:}`), `primary_key:` (a
  name or a composite key), `default:`, `limit:`, `comment:`, `options:`,
  `charset:` and `collation:`.
- Columns: `t.<type> "name", ...` for any type (`string`, `jsonb`, `citext`,
  `st_point`, ...), `t.column "name", :type`, `t.virtual` (with `type:`),
  `t.enum` (with `enum_type:`), `t.references`/`t.belongs_to` and
  `t.timestamps`, with `null:`, `default:` (literals, or `-> { "sql" }`),
  `limit:`, `precision:`, `scale:`, `array:`, `comment:`, `collation:` and any
  other option, kept as written.
- `t.index` and `add_index` (column lists or an expression, with `unique:`,
  `where:`, `using:`, `order:`, `length:`, `opclass:`, `include:`, `type:` and
  `nulls_not_distinct:`), `t.check_constraint` and `add_check_constraint`,
  `t.unique_constraint`, `t.exclusion_constraint`.
- `add_foreign_key` (and `t.foreign_key`) with `column:`, `primary_key:`,
  `name:`, `on_delete:`, `on_update:`, `validate:` and `deferrable:`; the
  default column is the target table's singular name with `_id`, by
  ActiveSupport's inflections and the application's own.
- `create_enum`, `enable_extension` and Scenic's `create_view` (with
  `sql_definition:` and `materialized:`).

Any other statement (`execute`, a plugin's `create_function`, a conditional) is
listed in `metadata.skipped` with its file and line, and reported as a
diagnostic, rather than interpreted. A file without a `define` block, a foreign
key from a table the schema doesn't create, and unbalanced Ruby fail with the
file and line.

## What the extraction contains

- `table`: identified by database and name (`table:/<name>` for the primary
  database, `table:<database>/<name>` for `db/<database>_schema.rb`). Data:
  `database`, `comment`, `options`, `charset`, `collation`.
- `column`: identified by table and name. Data: `type`, the Rails type with its
  size as `bin/rails db:schema:dump` writes it (`string(100)`, `decimal(10,2)`,
  `datetime(6)`, `[]` for an array, a PostgreSQL enum's name); `railsType`;
  `nullable`, `primaryKey`, `hasDefault`, `default`; and each option as written
  (`limit`, `precision`, `scale`, `array`, `comment`, `virtual`, ...).
  `databaseType` is absent: the SQL type depends on the adapter.
- `constraint`: primary keys, indexes (`index` or `unique`), checks, unique and
  exclusion constraints, identified by table, kind and name (an unnamed key by
  its columns), and foreign keys, identified by their columns and target table.
  Data: `type`, `columns`, `databaseName` and the options above; foreign keys'
  `target`, `references`, `onDelete` and `onUpdate`.
- `enum`: `create_enum`, with its `values`.

Defaults that Rails 7.0 changed are read as the file's own format declares:
under `ActiveRecord::Schema[7.0]` and later a `datetime` without `precision:`
has precision 6 (`datetime(6)`) and `precision: nil` has none; in an older
`ActiveRecord::Schema.define` file a missing precision means none. Upgrading
Rails, which rewrites every timestamp's options, therefore changes nothing. The
implicit primary key is `bigint`, Rails 5.1's default.

Each item's evidence names its schema file and line. Metadata records the files,
the extensions they enable, each one's format and migration version
(`schemaVersions`, which change on every migration without changing the schema),
skipped statements and the extraction's limitations.

## Tests

```sh
cargo test -p projections-extractor-rails-schema
```

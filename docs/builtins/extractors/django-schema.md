# Django schema

The database schema a Django project's models describe: its tables, columns with
their database types, keys, indexes, constraints and foreign keys, read from
Django's own initialized model registry rather than from the source of
`models.py`. Compared across a pull request, it answers "what does this change
do to the schema the application expects: which tables and columns arrive or
leave, which types, nullability, constraints and relations change?"

<!-- generated: facts -->

- ID: `django-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/models.py`, `**/models/__init__.py`

<!-- end generated: facts -->

## When to use it

Use it in a Django project to review model changes as an entity-relationship
diagram rather than a migration file. Because it asks Django itself, it sees
what the models actually amount to: implicit primary keys, automatic
many-to-many tables, inherited fields, `Meta` indexes and constraints, and
fields contributed by third-party apps, so moving or reformatting model files
changes nothing.

It describes the models, not a live database: it doesn't run migrations,
connect, or detect drift between the two. For EF Core use
[`efcore-schema`](efcore-schema.md), for Prisma
[`prisma-schema`](prisma-schema.md).

## What it reads

It runs a small Python helper with **your** interpreter (`python`, by default
`python3`, which on Windows also finds `python` or `py -3`), so the project's
own Django (4.2 or 5) and its database backend must be installed there, ideally
the project's locked virtual environment. The helper imports the settings module
(`settings`, or a granted `DJANGO_SETTINGS_MODULE`), calls `django.setup()` and
reads every model's `_meta`. That imports and runs the project's code (settings,
apps and their `AppConfig.ready()`), which is why it needs `--trust`. Database
connections and cursors are blocked before setup, so startup code that queries
the database fails the extraction rather than reaching a database; other side
effects aren't blocked.

The `database` input names the alias whose backend decides the database types
(default `default`). It only selects type metadata; it never connects.

It writes a `table` per concrete model, including unmanaged models (marked
`managed: false`) and the automatic through tables of many-to-many fields;
abstract, proxy and swapped-out models add no table. Each `column` has Django's
field type as `data.type` (`CharField`) and the backend's type as `databaseType`
(`varchar(200)`), with nullability, length, precision, defaults and comments.
Primary keys, uniqueness, indexes, check and unique constraints, and foreign
keys are `constraint` entities, each with its `data.type`; a foreign key also
links its columns to the target table's. Defaults are never evaluated: a
callable default is recorded by its import path. IDs come from database names
(`db_table`, `db_column`), so renaming a model or field while keeping its
mapping changes nothing.

`snapshot` reads a `database/v0` extraction exported earlier instead, with no
Python and no trust; it is read from the revision being extracted, so each
revision you compare needs its own.

## Options

<!-- generated: inputs -->

| Input      | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `database` | Database alias whose backend gives column types; default default. |
| `python`   | Python interpreter; default python3.                              |
| `settings` | Django settings module.                                           |
| `snapshot` | Pre-exported effective schema.                                    |

<!-- end generated: inputs -->

Environment variables reach the helper only when listed in the definition's
`execution.environment` (for example the variable your settings module reads to
choose its configuration); `inputs.env` is rejected so values never land in a
definition.

## What a comparison shows

The [`database`](../renderers/database.md) renderer draws each table as a card
with its columns, keys and indexes, and each foreign key as a link from the
dependent row to the principal one.

- **Tables** added, removed or modified, and **columns** added or removed within
  them.
- **Column changes**: a new database type reads as a type change (`varchar(120)`
  to `varchar(200)`, with the Django field type in the column's tooltip), and
  `null=True` added or removed as made optional or made required.
- **Keys, indexes, constraints and foreign keys** added, removed or modified: a
  new `UniqueConstraint`, an index that gains a field, a foreign key whose
  `on_delete` changed.

The summary bar counts tables, columns, constraints and foreign keys, each with
its changes (`5 tables +1 · 24 columns +8 ~2`), then states what the counts
can't: column types changed, columns made required or optional, and anything
renamed, each filtering to its rows.

Changing a table's or column's database name (`db_table`, `db_column`) gives it
a new ID, so it reads as a removal and an addition; declare the old ID in the
definition's `correspondence` to show it as a rename.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "django-schema",
  "id": "django-schema",
  "inputs": {
    "settings": "app.settings"
  },
  "renderer": "database",
  "title": "Django schema"
}
```

<!-- end generated: definition -->

## Limitations

- It is the model registry, not the database: routers, migration-only
  operations, database-generated constraint names and whether the backend
  enforces each declared constraint aren't known.
- `on_delete` is the ORM's behavior (`django.db.models.deletion.CASCADE`), not a
  SQL `ON DELETE` clause.
- Generic relations create no foreign keys.
- A default it can't serialize stably (an object without a stable
  representation, a lambda or local function) fails the extraction.
- Importing the project runs its code with your user's privileges; blocking ORM
  access is not a sandbox. Use a settings module with safe startup behavior, and
  trust only repositories you have reviewed.
- A large schema opens at a readable size (text no smaller than 8 px) and
  scrolls, rather than shrinking to fit.

## Related

- [`database`](../renderers/database.md), the renderer that draws it.
- [`efcore-schema`](efcore-schema.md) and [`prisma-schema`](prisma-schema.md),
  the same model for EF Core and Prisma.
- [The default comparator](../comparators/default.md), which decides what
  changed.

## How it works

The [package README](../../../packages/extractors/django-schema/README.md)
covers the helper, identities and how values are serialized.

## Build your own

Write your own extractor when Django's model registry isn't the schema you want
to review:

- **Another Python data layer**: SQLAlchemy or SQLModel models, Alembic
  migrations, or raw SQL.
- **The live database, not the models**: what is deployed, drift from the
  models, or the migration graph and which migrations a change adds.
- **Facts Django doesn't have**: which app or team owns each table, which
  columns hold personal data, row counts from your own inventory.

Try the lighter options first: `settings` and a granted environment variable
select an inspection configuration whose startup is safe, `database` picks the
backend whose types you want to see, and `snapshot` reads a schema your own
tooling exported. To draw the schema differently, keep this extractor and write
a renderer; to say which changes are destructive (a dropped column, a field made
required without a default), add a comparator file.

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
projections init <id> --language python --renderer database
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it; an open projection tab uses
your uncommitted edits ("Your edits") and says when its results are out of date,
and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints; the [`database/v0` schema](../../reference/schemas/database.md)
lists the fields the `database` renderer reads.

# Django schema

This extractor captures the database schema your Django models describe—tables,
columns with their database types, keys, indexes, constraints, and foreign
keys—by reading Django's initialized model registry rather than parsing
`models.py` by hand. Compared across a pull request, it shows how a change
affects the schema your application expects: which tables and columns are added
or removed, and how types, nullability, constraints, and relations shift.

<!-- generated: facts -->

- ID: `django-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/models.py`, `**/models/__init__.py`

<!-- end generated: facts -->

## When to use it

Use this extractor in a Django project when you want to review model changes as
an entity-relationship diagram instead of reading migration files. Because it
queries Django directly, it sees the effective schema your models
produce—implicit primary keys, automatic many-to-many join tables, inherited
fields, `Meta` indexes and constraints, and fields added by third-party apps.
Moving or reformatting model files produces no noise.

Keep in mind that this models what your code expects, not a live database. It
never runs migrations, opens a database connection, or detects drift against
production. For EF Core use [`efcore-schema`](efcore-schema.md), and for Prisma
use [`prisma-schema`](prisma-schema.md).

## What it reads

The extractor runs a small Python helper using **your** interpreter (`python`,
which defaults to `python3` and also checks `python` or `py -3` on Windows).
Your project's version of Django (4.2 or 5) and its database backend need to be
installed in that environment—ideally the project's locked virtual environment.
The helper imports your settings module (`settings`, or a granted
`DJANGO_SETTINGS_MODULE`), calls `django.setup()`, and inspects every model's
`_meta`. Because that imports and runs project code (settings, apps, and
`AppConfig.ready()`), it requires `--trust`. Database connections and cursors
are blocked before setup, so startup code that queries the database will fail
the extraction rather than hitting a live server, though other side effects are
not blocked.

The `database` option selects which configured database alias determines column
types (default `default`). It only looks up backend type metadata and never
connects.

Each concrete model becomes a `table`, including unmanaged models (marked
`managed: false`) and automatic through tables created for many-to-many fields;
abstract, proxy, and swapped-out models do not produce tables. Each `column`
records Django's field type as `data.type` (`CharField`) and the backend type as
`databaseType` (`varchar(200)`), along with nullability, length, precision,
defaults, and comments. Primary keys, uniqueness rules, indexes, check and
unique constraints, and foreign keys become `constraint` entities with their
`data.type`, and foreign keys also connect their columns to the target table.
Defaults are never called—a callable default is recorded by its import path.
Because IDs are built from database names (`db_table`, `db_column`), renaming a
Python model or field without changing its database mapping shows no change.

If you prefer not to run Python, pass `snapshot` to read a previously exported
`database/v0` extraction with no `--trust` required. Snapshot files are read
from each revision being extracted, so every compared revision needs its own.

## Options

<!-- generated: inputs -->

| Input      | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `database` | Database alias whose backend gives column types; default default. |
| `python`   | Python interpreter; default python3.                              |
| `settings` | Django settings module.                                           |
| `snapshot` | Pre-exported effective schema.                                    |

<!-- end generated: inputs -->

Environment variables are passed to the helper only if you explicitly allow them
in `execution.environment` (such as a variable your settings module reads to
select a configuration). `inputs.env` is rejected so secret values never end up
committed in a definition.

## What a comparison shows

The [`database`](../renderers/database.md) renderer draws each table as a card
listing its columns, keys, and indexes, with foreign keys drawn as links from
the dependent row to the principal one.

- **Tables and columns** highlight any tables added, removed, or modified, along
  with columns added or removed inside them.
- **Column changes** call out database type changes (such as `varchar(120)` to
  `varchar(200)`, with the Django field type shown in the tooltip) and
  nullability changes—adding or removing `null=True` appears as made optional or
  made required.
- **Keys, indexes, constraints, and foreign keys** track additions, removals,
  and modifications, such as a new `UniqueConstraint`, an index gaining a field,
  or a foreign key changing its `on_delete` behavior.

The summary bar counts tables, columns, constraints, and foreign keys along with
their deltas (`5 tables +1 · 24 columns +8 ~2`), then calls out higher-level
shifts: changed column types, columns made required or optional, and renames.
Clicking any item filters down to the affected rows.

Because IDs come from database names (`db_table`, `db_column`), changing a
table's or column's database name looks like a removal and an addition. Declare
the old ID in `correspondence` in your definition to show it as a rename
instead.

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

- This reflects the model registry rather than the live database, so routers,
  migration-only operations, database-generated constraint names, and whether
  the backend actually enforces a declared constraint are not captured.
- `on_delete` reflects Django ORM behavior (`django.db.models.deletion.CASCADE`)
  rather than a SQL `ON DELETE` clause.
- Generic relations do not produce foreign keys.
- Defaults that cannot be serialized stably (objects without a stable
  representation, lambdas, or local functions) cause the extraction to fail.
- Importing your project executes its code with your user's privileges—blocking
  ORM queries is not a sandbox. Use a settings module with safe startup behavior
  and only trust repositories you have reviewed.
- Large schemas open at a readable scale (text at least 8 px) and scroll instead
  of shrinking to fit the viewport.

## Related

- [`database`](../renderers/database.md) is the renderer that draws these
  schemas.
- [`efcore-schema`](efcore-schema.md) and [`prisma-schema`](prisma-schema.md)
  provide the same model for EF Core and Prisma.
- [The default comparator](../comparators/default.md) determines what changed
  between revisions.

## How it works

See the [package README](../../../packages/extractors/django-schema/README.md)
for details on the Python helper, entity IDs, and how values are serialized.

## Build your own

Consider writing a custom extractor when Django's model registry is not the
schema you want to review:

- **Another Python data layer**, such as SQLAlchemy or SQLModel models, Alembic
  migrations, or raw SQL.
- **The live database instead of models**, including deployed state, schema
  drift, or the migration graph and which migrations a pull request adds.
- **Facts Django does not track**, like which app or team owns each table, which
  columns hold personal data, or row counts from an internal inventory.

Try the lighter options first: `settings` paired with a granted environment
variable lets you pick a safe inspection configuration, `database` chooses which
backend's column types to show, and `snapshot` reads a schema exported by your
own tooling. To change the visual layout, keep this extractor and write a custom
renderer; to flag destructive changes (such as a dropped column or a field made
required without a default), add a comparator file.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language to scaffold
the definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. Emit a `database/v0` extraction and set the definition's renderer to
`database` to get the same diagram view. You can also choose **Ask an agent to
write it** and describe what you want to see.

**With the CLI**, scaffold a Python extractor while keeping the `database`
renderer:

```sh
projections init <id> --language python --renderer database
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

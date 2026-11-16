---
description: "A Django project's database schema (database/v0)"
---

# Django schema — `database/v0`

Both built-ins return normalized `database/v0` with `table`, `column`,
`constraint` and, for Prisma, `enum` entities. `contains`, `constrains`,
`references`, `foreign-key`, `enum-type`, and `many-to-many` relationships
connect them. Every column has a string `data.type`. These extractors inspect
the frameworks' **desired model**, not the actual database, migrations, drift,
or generated SQL. They do not run migrations, generation, introspection,
queries, or schema writes.

## Django

Install the target project's Django and database-backend dependencies into a
compatible Python environment. `helper/requirements.txt` declares the helper's
Django range (`>=4.2,<6`). Prefer the project's locked environment for
reproducibility; the requirements range alone is not a lockfile.

```json
{
  "id": "database",
  "extractor": "django-schema",
  "renderer": "schema",
  "inputs": {
    "python": "/absolute/path/to/project/.venv/bin/python",
    "settings": "myproject.settings",
    "database": "default"
  },
  "execution": { "timeoutMs": 30000, "environment": ["MYPROJECT_ENV"] }
}
```

- `python`: interpreter executable or path, default `python3` (a bare `python3`
  or `python` runs the machine's Python 3, found as `python` or `py -3` on
  Windows). Choose the interpreter/environment matching the project and its
  Python version.
- `settings`: dotted Django settings module. Explicitly overrides an environment
  variable forwarded using `execution.environment`.
- Environment values come only from the per-invocation source through the
  declared allowlist. `inputs.env` is rejected so values are never embedded in
  artifact configuration. Ambient environment and `HOME` are not automatically
  inherited; explicitly forward required project variables.
- `database`: configured database alias, default `default`. Selects backend
  **type metadata only**, never connects.
- `--trust` is mandatory for native Django, even when network is disabled.
  Missing settings, missing packages, import/setup errors, unsupported metadata,
  and database access attempted during startup are explicit errors.

The helper `helper/django_schema.py` receives one `ExtractorRequest` JSON object
on stdin and writes one extraction JSON object on stdout. It imports its sibling
modules (`projections_django_values.py`, stable values, and
`projections_django_graph.py`, the graph) before the target repository root is
inserted into `sys.path`, so the repository's modules cannot shadow them; the
helper need not be copied into the target project. The executable embeds the
helper directory and unpacks it to `helpers/python` in its per-user helper cache
on first use. Model initialization output is redirected to stderr to preserve
the protocol. Direct usage from a source checkout:

```sh
/path/to/project/.venv/bin/python /path/to/projections/extractors/django-schema/helper/django_schema.py < collector-input.json
```

The helper calls `django.setup()` and
`apps.get_models(include_auto_created=True)`, inspecting `_meta` rather than
source declarations. This includes actual implicit primary keys and automatic
many-to-many intermediary tables, local concrete/inherited-parent link fields,
field and compound uniqueness, explicit indexes, deconstructed check/unique
constraints, and foreign-key column pairs. Django 5.2 composite primary keys are
supported through their registry field names. Unmanaged models are included and
marked; abstract, proxy, and swapped-out models do not add tables.

Defaults are **never evaluated**. Importable functions are stored by qualified
name; partials, deconstructible expressions, decimals, UUIDs, dates, durations,
bytes, collections, and JSON values have stable serialization. Opaque objects
and anonymous/local callables fail instead of leaking nondeterministic
memory-address representations. Generated expressions and persistence are
recorded when exposed by Django.

### Django boundaries and safety

`data.type` is Django's internal field type; `databaseType` (the `database/v0`
column's native database type, which viewers prefer) and field checks come from
`db_parameters` for the selected backend. This does not prove that the backend
will create or enforce every declared index or constraint. Database-generated
SQL names, routers, migration-only objects, and actual database state are not
inferred. Generic relations do not create foreign keys. `onDelete` records the
**ORM callable**, not a SQL `ON DELETE` clause.

The helper blocks Django's base connection/cursor entry points before setup,
including queries attempted in startup hooks. It does not call schema editors or
migrations. This is not a sandbox: trusted settings, custom backends, fields, or
`AppConfig.ready()` can execute arbitrary code and non-ORM I/O. Use a trusted
inspection settings module with safe startup behavior; network capability
metadata alone does not sandbox Python.

## Identity, provenance, and pre-exported extractions

IDs use a kind prefix and percent-encoded database-semantic components:

- Prisma table: database namespace plus `@@map` name (otherwise model name).
- Django table: `_meta.db_table`; both extractors' columns use physical column
  names and parent table identity.
- Named constraints/indexes: parent table, constraint kind, database name.
  Unnamed constraints: kind plus ordered database columns; foreign keys also
  identify their target (Django groups by local columns).
- Prisma enums: database namespace (when multiSchema's `@@schema` names one)
  plus database name; mapped values are retained. Prisma views are `view`
  entities identified like tables.

Source locations are evidence, not IDs. Moving/reformatting model files does not
change semantics. Renaming a model/field while retaining its database mapping
preserves table/column IDs. No rename inference or `previousIds` is invented for
actual database renames. Django deconstructed expressions retain framework
lookup names, so changing those references may change expression metadata even
when mapped columns are unchanged. Callable import-path changes likewise change
default metadata. Ambiguous physical identities fail validation.

Nodes carry authoritative framework evidence; metadata states the authority,
framework version, and limitations. Django also records Python version and
backend. These are separate from the runtime's collection provenance/cache
policy.

Either extractor accepts `inputs.snapshot`, a repository-relative, pre-exported
`database/v0` extraction JSON file. This bypasses native execution, requires no
trust, validates graph structure and column types, and labels its authority
`pre-exported database schema`. A pre-exported file's freshness/claims are the
producer's responsibility; it is not relabeled as a fresh framework inspection.

## Tests and CI setup

`cargo test -p projections-cli --test collectors` reads the self-contained
Django extraction (`tests/fixtures/django.extraction.json`), which was exported
from the real Django fixture in `tests/fixtures/django`, not a custom
Python-source parser. `cargo test -p projections-extractor-django-schema` checks
that the helper is valid Python without importing Django. To additionally
execute the helper against the real fixture:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r packages/extractors/django-schema/helper/requirements.txt
PROJECTIONS_DJANGO_PYTHON="$PWD/.venv/bin/python" \
  cargo test -p projections-cli --test native_tools native_django
```

Do not commit the environment. CI must explicitly provision it and set
`PROJECTIONS_NATIVE_TESTS=1`; `PROJECTIONS_DJANGO_PYTHON` chooses the executable
(otherwise `python3`). Setting the executable variable also enables this suite
for targeted local runs. Selected native mode fails on missing executables or
dependencies; it never silently skips. Those tests cover file moves/formatting,
mapped field renames, changed semantics, safe default handling, setup failure,
and rejection of database access.

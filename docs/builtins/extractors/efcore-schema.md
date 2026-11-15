# EF Core schema

The relational model an EF Core `DbContext` builds: its tables, columns with
their store types, keys, indexes, check constraints and foreign keys, read from
the application's own EF Core rather than from entity classes or migrations.
Compared across a pull request, it answers "what does this change do to the
database schema the application expects: which tables and columns arrive or
leave, which types and nullability change, which keys and relationships move?"

<!-- generated: facts -->

- ID: `efcore-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*DbContext.cs`

<!-- end generated: facts -->

## When to use it

Use it in a .NET application that maps its data with EF Core 6 or later and a
relational provider, to review schema changes as an entity-relationship diagram
rather than a migration file or a model snapshot diff. It sees the model EF Core
actually builds, including conventions, `OnModelCreating` configuration, owned
types and table splitting, so a change to a convention or a fluent call shows up
even when no entity class changed.

It describes the model the code expects, not a live database: it doesn't connect
to one, apply migrations or detect drift. For a Django project use
[`django-schema`](django-schema.md), for Prisma
[`prisma-schema`](prisma-schema.md).

## What it reads

It builds the project with the repository's own .NET SDK (8.0.100 or later) and
loads the application's own EF Core by reflection, so it works with whichever
version the application references. It finds the `DbContext` the way `dotnet ef`
does:

1. an `IDesignTimeDbContextFactory<TContext>` in the application or a project it
   references (no host is built);
2. a context registered in the application's host (for example with
   `AddDbContext`), built but never started;
3. a `DbContext` type with a public parameterless constructor.

`context` picks one when a step finds several. `factoryType` and `factoryMethod`
name your own static factory instead, which can return a `DbContext` or its
design-time `IModel`. Finding the context runs the application's startup code
(its `Main`, host builder, `Startup` or a design-time factory), which is why it
needs `--trust`. It runs in the `Development` environment unless `environment`
says otherwise, and `Development` hosts read your user secrets, as they do under
`dotnet ef`. Nothing connects to a database merely to read the model.

From EF Core's relational model it writes a `table` per table (named
`schema.name` when it has a schema), a `column` per column with its store type
as `data.type` (`nvarchar(200)`), its nullability, length, precision, defaults,
computed SQL, collation and value generation; `primary-key`, `unique-key`,
`index` and `check-constraint` entities for the table's keys, indexes and
checks; and a `relation` relationship per foreign key, with its columns,
principal columns and delete behavior (`onDelete`). IDs come from the database
names (schema, table, column and constraint), not from CLR types or source
paths, so renaming an entity class or moving a file while keeping its mapping
changes nothing.

`snapshot` reads a `database/v0` extraction exported earlier instead, with no
build, no SDK and no trust; it is read from the revision being extracted, so
each revision you compare needs its own.

## Options

<!-- generated: inputs -->

| Input           | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `assembly`      | Assembly path; default the project's build output.                              |
| `context`       | DbContext type when there are several.                                          |
| `dotnet`        | The dotnet executable path, not a shell command; default dotnet on PATH.        |
| `environment`   | Context environment; default Development.                                       |
| `factoryMethod` | Optional static factory method.                                                 |
| `factoryType`   | Optional factory type; default design-time factories or the application's host. |
| `project`       | Application project path.                                                       |
| `snapshot`      | Pre-exported effective schema.                                                  |

<!-- end generated: inputs -->

Every compared revision builds its own version of `project`, so commit what that
build needs (`global.json`, NuGet configuration and lock files). Environment
variables reach the build and the application only when listed in the
definition's `execution.environment`, and a large solution may need a longer
`execution.timeoutMs`.

## What a comparison shows

The [`database`](../renderers/database.md) renderer draws each table as a card
with its columns, keys and indexes, and each foreign key as a link from the
dependent row to the principal one.

- **Tables** added, removed or modified, and **columns** added or removed within
  them.
- **Column changes**: a new store type reads as a type change (`nvarchar(120)`
  to `nvarchar(200)`), and a nullability change as made required or made
  optional.
- **Keys, indexes, check constraints and foreign keys** added, removed or
  modified: an index that becomes unique, a foreign key whose delete behavior
  changed from `Cascade` to `Restrict`.

The summary bar counts the schema by kind (tables, columns, primary keys,
foreign keys, indexes and so on), each with its changes
(`5 tables +1 · 24 columns +8 ~2`), then states what the counts can't: column
types changed, columns made required or optional, and anything renamed, each
filtering to its rows.

Renaming a table or column in the database (`ToTable`, `HasColumnName`) gives it
a new ID, so it reads as a removal and an addition; declare the old ID in the
definition's `correspondence` to show it as a rename.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "efcore-schema",
  "id": "efcore-schema",
  "inputs": {
    "project": "src/App/App.csproj"
  },
  "renderer": "database",
  "title": "EF Core schema"
}
```

<!-- end generated: definition -->

## Limitations

- Views, sequences and provider-specific annotations aren't represented.
- It needs a relational provider: the in-memory and Cosmos DB providers have no
  relational model to read.
- A custom factory that returns a trimmed runtime model (without design-time
  metadata) can fail for lack of index and check-constraint details; return
  `context.GetService<IDesignTimeModel>().Model` instead.
- Startup code runs with your user's privileges: it can read files, reach the
  network and use whatever credentials its configuration finds. Trust only
  repositories you have reviewed, and prefer an explicit factory or a
  non-`Development` environment in CI.
- A large schema opens at a readable size (text no smaller than 8 px) and
  scrolls, rather than shrinking to fit.

## Related

- [`database`](../renderers/database.md), the renderer that draws it.
- [`django-schema`](django-schema.md) and [`prisma-schema`](prisma-schema.md),
  the same model for Django and Prisma.
- [`dotnet-di`](dotnet-di.md) and [`dotnet-public-api`](dotnet-public-api.md),
  which build the same .NET project to read its services and its public API.
- [The default comparator](../comparators/default.md), which decides what
  changed.

## How it works

The [package README](../../../packages/extractors/efcore-schema/README.md) and
the [.NET support README](../../../packages/extractors/dotnet-support/README.md)
cover the helper, how the context is found and the adapter contract.

## Build your own

Write your own extractor when the model EF Core builds isn't the schema you want
to review:

- **Another data layer**: Dapper or raw SQL with hand-written migrations,
  NHibernate, or a database-first project whose truth is a `.sql` script or a
  `.dacpac`.
- **The live database, not the model**: what is deployed, drift between the two,
  or migration history.
- **Facts EF Core doesn't have**: which team owns each table, which columns hold
  personal data, row counts or table sizes from your own inventory.
- **Objects it leaves out**: views, sequences, stored procedures or triggers.

Try the lighter options first: `context`, `environment` and an explicit
`factoryType` and `factoryMethod` cover most applications whose startup can't
run as is, and `snapshot` reads a schema your own tooling exported. To draw the
schema differently, keep this extractor and write a renderer; to say which
changes are destructive (a dropped column, a narrowed type), add a comparator
file.

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

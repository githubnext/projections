# EF Core schema

This extractor captures the relational model an EF Core `DbContext`
builds—tables, columns with their store types, keys, indexes, check constraints,
and foreign keys—by reading directly from your application's EF Core runtime
rather than parsing entity classes or migrations. Compared across a pull
request, it shows how a change reshapes the database schema your app expects:
which tables and columns are added or removed, how types and nullability shift,
and which keys or relationships move.

<!-- generated: facts -->

- ID: `efcore-schema`
- Extraction schema: [`database/v0`](../../reference/schemas/database.md)
- Drawn by default with: [`database`](../renderers/database.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*DbContext.cs`

<!-- end generated: facts -->

## When to use it

Use this extractor in .NET applications backed by EF Core 6 or later and a
relational provider when you want to review schema changes as an
entity-relationship diagram instead of a migration or model snapshot diff.
Because it inspects the model EF Core actually builds—including conventions,
`OnModelCreating` configuration, owned types, and table splitting—a tweak to a
convention or fluent API call shows up even if no entity class was touched.

Keep in mind that this models what your code expects, not a live database. It
never opens a connection, runs migrations, or detects drift against production.
For Django use [`django-schema`](django-schema.md), and for Prisma use
[`prisma-schema`](prisma-schema.md).

## What it reads

The extractor builds your project with the repository's own .NET SDK (8.0.100 or
newer) and loads the application's EF Core version via reflection, so it works
with whichever EF Core version you reference. It discovers your `DbContext` in
the same order `dotnet ef` does:

1. An `IDesignTimeDbContextFactory<TContext>` in the application or a referenced
   project (without building a host).
2. A context registered in the application's host (for instance with
   `AddDbContext`), built without starting the host.
3. A `DbContext` type with a public parameterless constructor.

Use `context` to disambiguate when a step finds more than one context. You can
also point `factoryType` and `factoryMethod` at your own static factory that
returns either a `DbContext` or its design-time `IModel`. Because discovering
the context runs application startup code (`Main`, host builder, `Startup`, or a
design-time factory), extraction requires `--trust`. It defaults to the
`Development` environment unless `environment` overrides it—just like
`dotnet ef`, a `Development` host loads local user secrets. Reading the model
never connects to a database.

From EF Core's relational model, the extractor emits a `table` per table (named
`schema.name` when a schema is set), a `column` per column with its store type
as `data.type` (`nvarchar(200)`), nullability, length, precision, defaults,
computed SQL, collation, and value generation, plus `primary-key`, `unique-key`,
`index`, and `check-constraint` entities. Each foreign key becomes a `relation`
linking its columns to the principal columns along with its `onDelete` behavior.
Because IDs come from database names (schema, table, column, and constraint)
rather than CLR types or file paths, renaming an entity class or moving a file
without changing its mapping produces no diff.

If you prefer not to build the project during extraction, pass `snapshot` to
read a previously exported `database/v0` extraction with no build, SDK, or
`--trust` required. Snapshot files are read from each revision being extracted,
so every compared revision needs its own.

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

Each compared revision builds its own version of `project`, so make sure
everything the build needs—`global.json`, NuGet configuration, and lock files—is
committed. Environment variables are passed to the build and app only when
listed in `execution.environment`, and larger solutions may need a higher
`execution.timeoutMs`.

## What a comparison shows

The [`database`](../renderers/database.md) renderer draws each table as a card
with its columns, keys, and indexes, and connects each foreign key from the
dependent row to the principal one.

- **Tables and columns** highlight tables added, removed, or modified, as well
  as columns added or removed inside them.
- **Column changes** flag store type updates (such as `nvarchar(120)` to
  `nvarchar(200)`) and nullability changes (made required or made optional).
- **Keys, indexes, check constraints, and foreign keys** track additions,
  removals, and edits—for instance, an index becoming unique or a foreign key
  changing its delete behavior from `Cascade` to `Restrict`.

The summary bar tallies schema objects by kind (tables, columns, primary keys,
foreign keys, indexes, and so on) with their deltas
(`5 tables +1 · 24 columns +8 ~2`), then summarizes higher-level shifts: changed
column types, columns made required or optional, and renames. Clicking any count
filters to the matching rows.

Because IDs come from database names, renaming a table or column with `ToTable`
or `HasColumnName` appears as a removal and an addition. Declare the old ID in
`correspondence` in your definition to track it as a rename instead.

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

- Views, sequences, and provider-specific annotations are not represented.
- A relational provider is required—the in-memory and Cosmos DB providers have
  no relational model to inspect.
- A custom factory that returns a trimmed runtime model (lacking design-time
  metadata) can fail when index or check-constraint details are missing; return
  `context.GetService<IDesignTimeModel>().Model` instead.
- Startup code runs with your user's privileges, meaning it can read files,
  access the network, and use whatever credentials its configuration finds. Only
  trust repositories you have reviewed, and prefer an explicit factory or a
  non-`Development` environment in CI.
- Large schemas open at a readable scale (text at least 8 px) and scroll instead
  of shrinking to fit the viewport.

## Related

- [`database`](../renderers/database.md) is the renderer that draws these
  schemas.
- [`django-schema`](django-schema.md) and [`prisma-schema`](prisma-schema.md)
  provide the same model for Django and Prisma.
- [`dotnet-di`](dotnet-di.md) and [`dotnet-public-api`](dotnet-public-api.md)
  build the same .NET project to inspect its services and public API.
- [The default comparator](../comparators/default.md) determines what changed
  between revisions.

## How it works

See the [package README](../../../packages/extractors/efcore-schema/README.md)
and the
[.NET support README](../../../packages/extractors/dotnet-support/README.md) for
details on the helper, context discovery, and the adapter contract.

## Build your own

Consider writing a custom extractor when EF Core's model is not the schema you
want to review:

- **Another data layer**, such as Dapper or raw SQL with hand-written
  migrations, NHibernate, or a database-first project defined by `.sql` scripts
  or a `.dacpac`.
- **The live database instead of the model**, including deployed state, schema
  drift, or migration history.
- **Facts EF Core does not track**, like table ownership by team, columns
  holding personal data, or row counts and table sizes from an inventory.
- **Database objects it omits**, such as views, sequences, stored procedures, or
  triggers.

Try the lighter options first: `context`, `environment`, and an explicit
`factoryType` and `factoryMethod` cover most apps whose startup cannot run out
of the box, while `snapshot` imports a schema exported by your own tooling. To
change the visual layout, keep this extractor and write a custom renderer; to
flag destructive changes (such as a dropped column or narrowed type), add a
comparator file.

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

# NuGet dependencies

The .NET projects in a repository and the NuGet packages they resolve, for each
target framework: what each project references directly, the exact versions
restore chose, and what those packages pull in, transitively. Compared across a
pull request, it answers "which packages did this change add, remove, upgrade or
downgrade, for which framework, and what pulls them in?"

<!-- generated: facts -->

- ID: `nuget-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*.csproj`, `**/*.fsproj`, `**/*.vbproj`

<!-- end generated: facts -->

## When to use it

Use it in a C#, F# or Visual Basic repository to review package changes as a
graph rather than a project-file diff: a new `PackageReference` and the packages
it brings, a transitive upgrade from bumping one direct reference, a framework
added to `TargetFrameworks` and everything it resolves. It restores each
revision you compare with the repository's own `dotnet`, so it needs `--trust`,
or reads assets a revision already holds without it (below). It covers NuGet
packages only. For Node workspaces use
[`workspace-dependencies`](workspace-dependencies.md), for Rust
[`cargo-dependencies`](cargo-dependencies.md).

## What it reads

The `project.assets.json` file `dotnet restore` writes for each project (assets
format versions 3 and 4), from one of two places:

- **Restored for each revision** (the default, with `--trust`): it runs
  `dotnet restore` for every project file of the revision (`.csproj`, `.fsproj`,
  `.vbproj`), or those in `projects`, with `dotnet` (the `dotnet` input, default
  `dotnet` on `PATH`) and the repository's own NuGet configuration and feeds.
  Each restore covers just its project and writes its assets to a private
  folder, never into the project's `obj/`, so restoring doesn't touch your
  checkout's build output.
- **Imported from the revision**: the paths in `assetsPaths`, with no `--trust`.
  Only files of the revision are read, and Git-ignored files aren't: `obj/` is
  usually ignored, so this suits assets committed (or exported) somewhere in
  each revision. An `assetsPaths` file your checkout has but Git ignores fails
  with a message saying so, rather than reading as missing.

Assets that record a restore error are rejected.

Each project is a `project` entity, named by its restore project name, and each
of its target frameworks (with its runtime identifier, when it has one) a
`target-framework`. Each package resolved for a framework is a `package` entity
with its `version`, and each referenced project a `project-reference`. A
framework's direct references are `direct-dependency` relationships, and the
dependencies between packages `depends-on` relationships, both from the resolved
versions, never from version ranges. IDs are the project, the framework and the
package's lowercase name, never its version, so an upgrade is one modified
package.

## Options

<!-- generated: inputs -->

| Input         | Meaning                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `assetsPaths` | Explicit array of restored obj/project.assets.json paths, part of each revision; otherwise each revision is restored. |
| `dotnet`      | The dotnet executable that restores; default dotnet.                                                                  |
| `projects`    | Array of project files to restore; default every .csproj, .fsproj and .vbproj.                                        |

<!-- end generated: inputs -->

## What a comparison shows

- **Packages** added or removed, for each framework: a new reference and
  everything it brings in, or one that is no longer resolved.
- **Upgrades and downgrades** as modified packages, whose resolved version
  changed. The [`dependencies`](../renderers/graph.md) renderer words each by
  the part of the version that moved (`Major upgrade`, `Patch downgrade`), and
  its summary bar counts them (`2 major upgrades · 9 minor upgrades`), then how
  many changed packages a framework references directly, each filtering to its
  packages.
- **Frameworks** added or removed, with everything resolved for them.
- **Dependencies** added or removed: a direct reference added, or a package that
  no longer depends on another.

Projects and target frameworks are the graph's roots. Unchanged transitive
packages collapse into summary cards ("12 more packages") so the change stays
readable; the renderer's **All packages** control (`transitive`) shows them all,
and **Every dependency** (`paths`) draws every edge rather than the one path
that pulls each package in.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "nuget-dependencies",
  "id": "nuget-dependencies",
  "renderer": "dependencies",
  "title": "NuGet dependencies"
}
```

<!-- end generated: definition -->

## Limitations

- A package resolved for two frameworks is two packages, one per framework, so a
  multi-targeting project shows each change once for each framework.
- Restoring resolves floating versions (`1.*`) from what the feeds offer when
  each revision is extracted, and needs those feeds reachable.
- Imported assets that are stale, from a failed restore, or missing from a
  revision give a wrong or failed graph; nothing checks them against the project
  files.
- Project names must be unique across the assets files it reads.
- It reads the resolved graph, not the feed: it can't tell you about
  vulnerabilities, deprecations, licenses or package contents.

## Related

- [`graph`](../renderers/graph.md), whose `dependencies` presentation draws it.
- [`workspace-dependencies`](workspace-dependencies.md) and
  [`cargo-dependencies`](cargo-dependencies.md), the same graph for Node and
  Rust.
- [`dotnet-public-api`](dotnet-public-api.md) and [`dotnet-di`](dotnet-di.md),
  for what the projects export and compose.
- [The default comparator](../comparators/default.md), which can order steps by
  how many packages depend on each (`order.by: dependents`).

## How it works

The [package README](../../../packages/extractors/nuget-dependencies/README.md)
details the assets formats and how packages are identified.

## Build your own

Write your own extractor when the restored assets don't say what you need:

- **Another source of truth**: central package management
  (`Directory.Packages.props`) or `packages.lock.json` read directly, without
  restoring, or `packages.config` projects.
- **Facts restore doesn't have**: which team owns each project, which packages
  ship in which deployable, or vulnerability and license data from your own
  inventory.
- **Another grain**: project-to-project references alone, without packages.

Try the lighter options first: `assetsPaths` chooses which projects to read. To
draw the same graph differently, keep this extractor and write a renderer; to
say which upgrades matter, add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer dependencies
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it; an open projection tab uses
your uncommitted edits ("Your edits") and says when its results are out of date,
and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.

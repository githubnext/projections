# NuGet dependencies

This extractor maps the .NET projects in a repository and the NuGet packages
they resolve for each target framework—every direct reference, the exact
versions restore chose, and the transitive tree pulled in beneath them. Compared
across a pull request, it shows which packages were added, removed, upgraded, or
downgraded for each framework, and what pulls them in.

<!-- generated: facts -->

- ID: `nuget-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*.csproj`, `**/*.fsproj`, `**/*.vbproj`

<!-- end generated: facts -->

## When to use it

Use this extractor in any C#, F#, or Visual Basic repository to review NuGet
changes as a dependency graph instead of a project-file diff. It makes it easy
to see a new `PackageReference` and the transitive packages it brings along, a
downstream upgrade triggered by bumping a direct reference, or a new entry in
`TargetFrameworks` with everything it resolves. By default it restores each
revision with your repository's `dotnet` CLI (requiring `--trust`), or it can
read committed restore assets without `--trust` (see below). This extractor
covers NuGet packages only; for Node workspaces use
[`workspace-dependencies`](workspace-dependencies.md), and for Rust use
[`cargo-dependencies`](cargo-dependencies.md).

## What it reads

The extractor reads the `project.assets.json` file produced by `dotnet restore`
for each project (assets format versions 3 and 4), from one of two sources:

- **Restored per revision** (the default, requiring `--trust`): runs
  `dotnet restore` for every `.csproj`, `.fsproj`, and `.vbproj` in the revision
  (or just those listed in `projects`), using `dotnet` (via the `dotnet` input,
  defaulting to `dotnet` on `PATH`) and your repository's NuGet feeds and
  configuration. Each restore targets a single project and writes to an isolated
  folder rather than `obj/`, leaving your working tree's build output untouched.
- **Imported from the revision**: reads the paths listed in `assetsPaths`
  without requiring `--trust`. Only tracked files in each revision are
  read—never Git-ignored files. Since `obj/` is usually ignored, this mode is
  meant for assets committed or exported into each revision. If a path in
  `assetsPaths` exists locally but is ignored by Git, extraction fails with a
  clear message instead of treating it as missing.

Assets files that contain restore errors are rejected.

Each project becomes a `project` entity named by its restore project name, and
each target framework (including its runtime identifier, if present) becomes a
`target-framework`. Each resolved package becomes a `package` entity with its
`version`, and each project reference becomes a `project-reference`. A
framework's direct references become `direct-dependency` relationships, and
package-to-package edges become `depends-on` relationships—all reflecting
resolved versions rather than declared version ranges. Entity IDs combine the
project, framework, and lower-cased package name without the version, so an
upgrade appears as one modified package.

## Options

<!-- generated: inputs -->

| Input         | Meaning                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `assetsPaths` | Explicit array of restored obj/project.assets.json paths, part of each revision; otherwise each revision is restored. |
| `dotnet`      | The dotnet executable that restores; default dotnet.                                                                  |
| `projects`    | Array of project files to restore; default every .csproj, .fsproj and .vbproj.                                        |

<!-- end generated: inputs -->

## What a comparison shows

- **Added or removed packages** highlight new references and everything they
  pull in, as well as packages that dropped out of a framework's graph.
- **Upgrades and downgrades** appear as modified packages whose resolved version
  shifted. The [`dependencies`](../renderers/graph.md) renderer labels each by
  the version component that moved (`Major upgrade`, `Patch downgrade`). Its
  summary bar tallies those shifts (`2 major upgrades · 9 minor upgrades`) along
  with how many changed packages a framework references directly, and clicking
  any count filters the graph to those packages.
- **Added or removed frameworks** appear alongside everything resolved for them.
- **Added or removed dependencies** track structural changes such as a new
  direct reference or a package dropping a transitive dependency.

Projects and target frameworks sit at the root of the graph. To keep diffs easy
to read, unchanged transitive packages collapse into summary cards ("12 more
packages"). Turn on **All packages** (`transitive`) to expand them all, or
**Every dependency** (`paths`) to show every edge rather than a single path into
each package.

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

- A package resolved for two target frameworks appears as two separate package
  nodes—one per framework—so multi-targeted projects show each change once per
  framework.
- Restoring resolves floating versions (`1.*`) against whatever the configured
  feeds offer at extraction time, and requires those feeds to be reachable.
- Imported assets that are stale, incomplete from a failed restore, or missing
  in a revision produce an inaccurate or failed graph, since they are not
  cross-checked against project files.
- Project names must be unique across all assets files read together.
- Because it inspects the resolved graph rather than the NuGet feed, it does not
  report vulnerabilities, deprecations, licenses, or package contents.

## Related

- [`graph`](../renderers/graph.md) renders this extractor with its
  `dependencies` presentation.
- [`workspace-dependencies`](workspace-dependencies.md) and
  [`cargo-dependencies`](cargo-dependencies.md) provide the same dependency
  graph for Node and Rust.
- [`dotnet-public-api`](dotnet-public-api.md) and [`dotnet-di`](dotnet-di.md)
  inspect what .NET projects export and wire up.
- [The default comparator](../comparators/default.md) can order review steps by
  how many packages depend on each change (`order.by: dependents`).

## How it works

See the
[package README](../../../packages/extractors/nuget-dependencies/README.md) for
details on supported assets formats and package identity rules.

## Build your own

Consider writing a custom extractor when restored assets do not capture what you
need:

- **Another source of truth**, such as reading central package management
  (`Directory.Packages.props`) or `packages.lock.json` directly without running
  restore, or supporting legacy `packages.config` projects.
- **Facts restore does not track**, like project ownership by team, which
  deployables ship each package, or vulnerability and license data from your own
  inventory.
- **A different level of detail**, such as project-to-project references alone
  without NuGet packages.

Try the lighter options first: `assetsPaths` selects which projects to read. To
change the visual layout, keep this extractor and write a custom renderer; to
highlight specific upgrades that matter to your team, add a comparator file.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language to scaffold
the definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, scaffold a new extractor while keeping this graph's renderer:

```sh
projections init <id> --language node --renderer dependencies
```

An extractor is any program that prints an extraction. Run
`projections show -p <id> --trust` while you iterate—an open projection tab
picks up your uncommitted edits ("Your edits") and flags stale results, and the
Testing view runs your projection's checks. Walk through
[Write your first extractor](../../guides/first-extractor.md) to get started,
and check [Extraction schema](../../guides/schemas.md#extraction-schema) for the
output format.

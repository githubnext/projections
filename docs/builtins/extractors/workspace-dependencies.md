# Workspace dependencies

This extractor maps the packages in a Node workspace (npm, pnpm, or Yarn) and
the full transitive dependency tree behind them: what each workspace package
declares, what the lockfile resolves it to, and what those packages pull in.
Compared across a pull request, it shows which dependencies were added, removed,
upgraded, or downgraded—and what pulls them in.

<!-- generated: facts -->

- ID: `workspace-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `package.json`

<!-- end generated: facts -->

## When to use it

Use this extractor in any repository with a root `package.json`—single-package
or monorepo—when you want to review dependency changes as a graph instead of
wading through a lockfile diff. A new direct dependency and the dozens of
transitive packages it brings, a major bump deep in the tree, or two versions of
the same package installed side by side all stand out immediately.

Because it only reads manifests and lockfiles, it runs safely on any pull
request without `--trust`, and it is one of the two default projections the CLI
shows for repositories with no definitions yet.

It covers JavaScript and TypeScript packages only. For Rust use
[`cargo-dependencies`](cargo-dependencies.md), and for .NET use
[`nuget-dependencies`](nuget-dependencies.md).

## What it reads

- The root `package.json` (required) along with every workspace package it
  selects via npm/Yarn `workspaces` or pnpm's `pnpm-workspace.yaml`.
- The lockfile: `package-lock.json` or `npm-shrinkwrap.json` (npm 7+),
  `pnpm-lock.yaml` (lockfile versions 5 through 9), or `yarn.lock` (Yarn Classic
  or Berry).

The package manager is chosen from `inputs.packageManager`, then
`package.json`'s `packageManager` field, and finally whichever lockfile is
present. Nothing gets installed or executed: the lockfile is parsed using each
manager's own resolution rules, matching what `npm ci`,
`pnpm install --frozen-lockfile`, or `yarn install --immutable` would install.

Each workspace package becomes a `package` entity, and each installed
third-party package becomes an `external-package` with its `version`. Declared
dependencies (`dependencies`, `devDependencies`, `peerDependencies`, and
`optionalDependencies`) become typed edges recording both the declared range and
the resolved version. Because entity IDs exclude versions, an upgrade appears as
a single modified package rather than a removal and an addition.

## Options

<!-- generated: inputs -->

| Input            | Meaning                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `packageManager` | npm, pnpm or yarn; default from package.json packageManager or the lockfile present. |
| `root`           | Repository-relative workspace root; default ".".                                     |

<!-- end generated: inputs -->

## What a comparison shows

- **Added or removed packages** — a new dependency with everything it pulls in,
  or a package that is no longer installed.
- **Upgrades and downgrades** shown as modified packages. The
  [`dependencies`](../renderers/graph.md) renderer labels each by which version
  component moved (`Major upgrade`, `Patch downgrade`), and the summary bar
  groups them into clickable filters (`18 major upgrades · 4 patch upgrades`,
  plus how many direct dependencies changed).
- **Declaration changes**, such as moving a dependency from `devDependencies` to
  `dependencies` or widening a range from `^1.2.0` to `^1.3.0`.

Unchanged transitive dependencies collapse into summary cards ("12 more
packages") to keep the diff focused; toggle **All packages** to expand them.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "workspace-dependencies",
  "id": "workspace-dependencies",
  "renderer": "dependencies",
  "title": "Workspace dependencies"
}
```

<!-- end generated: definition -->

## Limitations

- Peer dependencies aren't followed transitively because not every package
  manager locks them, and optional dependencies skipped for other platforms are
  omitted.
- Any declaration missing from a stale lockfile has no resolved version and is
  reported in `metadata.unresolved`.
- Because it reads lockfiles rather than querying registries, it doesn't include
  vulnerability data, licenses, or package contents.
- Character classes and extended globs in workspace patterns are rejected rather
  than guessed at.

## Related

- [`graph`](../renderers/graph.md) — draws this graph using its `dependencies`
  presentation.
- [`cargo-dependencies`](cargo-dependencies.md) and
  [`nuget-dependencies`](nuget-dependencies.md) — the same dependency graph for
  Rust and .NET.
- [The default comparator](../comparators/default.md) — supports ordering steps
  by dependent count (`order.by: dependents`).

## How it works

See the
[package README](../../../packages/extractors/workspace-dependencies/README.md)
for details on each package manager's resolution rules and the extraction model.

## Build your own

Consider writing a custom extractor when manifests and lockfiles don't capture
what you need:

- **Other package managers or layouts**, such as Bun's `bun.lockb`, monorepo
  project graphs (Nx, Turborepo, Rush), or packages vendored outside
  `node_modules`.
- **Extra metadata**, like workspace team ownership, deployment groupings,
  bundle sizes, or license inventories.
- **File-level granularity**, tracking imports between source files instead of
  packages.

Check the built-in options first: `root` points to a nested workspace, and
`packageManager` disambiguates when multiple lockfiles exist. To flag specific
upgrades as risky, add a comparator file; to visualize the same graph
differently, keep this extractor and write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language. That creates the
definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer dependencies
```

An extractor can be any program that prints an extraction. Test changes as you
go with `projections show -p <id> --trust`. An open projection tab picks up your
uncommitted edits ("Your edits") and flags stale results, and the Testing view
runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.

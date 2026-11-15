# Workspace dependencies

The packages of a Node workspace (npm, pnpm or Yarn) and everything they depend
on: what each workspace package declares, what the lockfile resolved it to, and
what those packages pull in, transitively. Compared across a pull request, it
answers "which dependencies did this change add, remove, upgrade or downgrade,
and what pulls them in?"

<!-- generated: facts -->

- ID: `workspace-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `package.json`

<!-- end generated: facts -->

## When to use it

Use it in any repository with a root `package.json`, with or without workspaces,
to review dependency changes as a graph rather than a lockfile diff: a new
direct dependency and the dozens of packages it brings, a major upgrade deep in
the tree, two versions of one package installed at once. It reads only manifests
and the lockfile, so it is safe to run on any pull request without `--trust`,
and it is one of the two projections the CLI shows for a repository with no
definitions of its own.

It covers JavaScript and TypeScript packages only. For Rust use
[`cargo-dependencies`](cargo-dependencies.md), for .NET
[`nuget-dependencies`](nuget-dependencies.md).

## What it reads

- The root `package.json` (required) and every workspace package it selects: npm
  and Yarn `workspaces`, or pnpm's `pnpm-workspace.yaml`.
- The lockfile: `package-lock.json` or `npm-shrinkwrap.json` (npm 7 and later),
  `pnpm-lock.yaml` (lockfile versions 5 to 9), or `yarn.lock` from Yarn classic
  or Yarn Berry.

The package manager is `inputs.packageManager` when set, else the manifest's
`packageManager` field, else the one kind of lockfile present. Nothing is
installed or run: the lockfile is read with each manager's own resolution rules,
so the graph is what `npm ci`, `pnpm install --frozen-lockfile` or
`yarn install --immutable` would install.

Each workspace package is a `package` entity; each installed package is an
`external-package` with its `version`. Each declaration (`dependencies`,
`devDependencies`, `peerDependencies`, `optionalDependencies`) is a relationship
of that kind, with the declared range and the resolved version. IDs never
contain versions, so an upgrade is one modified package, not a removal and an
addition.

## Options

<!-- generated: inputs -->

| Input            | Meaning                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `packageManager` | npm, pnpm or yarn; default from package.json packageManager or the lockfile present. |
| `root`           | Repository-relative workspace root; default ".".                                     |

<!-- end generated: inputs -->

## What a comparison shows

- **Packages** added or removed: a new dependency and everything it brings in,
  or one that is no longer installed.
- **Upgrades and downgrades** as modified packages, whose version changed. The
  [`dependencies`](../renderers/graph.md) renderer words each by the part of the
  version that moved (`Major upgrade`, `Patch downgrade`), and its summary bar
  counts them (`18 major upgrades · 4 patch upgrades`, and how many direct
  dependencies changed), each filtering to its packages.
- **Declarations** added, removed or modified: a dependency moved from
  `devDependencies` to `dependencies`, or a range widened from `^1.2.0` to
  `^1.3.0`.

Unchanged transitive packages collapse into summary cards ("12 more packages")
so the change stays readable; the renderer's **All packages** control shows them
all.

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

- Peer dependencies aren't followed transitively, because not every package
  manager locks them, and optional dependencies skipped for another platform
  aren't listed.
- A declaration the lockfile doesn't record (a stale lockfile) has no resolved
  version and is listed in the extraction's `metadata.unresolved`.
- It reads the lockfile's format, not the registry: it can't tell you about
  vulnerabilities, licenses or package contents.
- Glob character classes and extended globs in workspace patterns are rejected
  rather than guessed at.

## Related

- [`graph`](../renderers/graph.md), whose `dependencies` presentation draws it.
- [`cargo-dependencies`](cargo-dependencies.md) and
  [`nuget-dependencies`](nuget-dependencies.md), the same graph for Rust and
  .NET.
- [The default comparator](../comparators/default.md), which can order steps by
  how many packages depend on each (`order.by: dependents`).

## How it works

The
[package README](../../../packages/extractors/workspace-dependencies/README.md)
details each package manager's resolution rules and the extraction's model.

## Build your own

Write your own extractor when the facts you need aren't in the manifests and
lockfile:

- **Another package manager or layout**: Bun's `bun.lockb`, a monorepo tool with
  its own project graph (Nx, Turborepo, Rush), or packages vendored outside
  `node_modules`.
- **Facts the lockfile doesn't have**: which team owns each workspace, which
  packages are deployed together, bundle sizes, or licenses from your own
  inventory.
- **Another grain**: imports between source files instead of packages.

Try the lighter options first: `root` points it at a workspace that isn't at the
repository root, and `packageManager` settles an ambiguous lockfile. To draw the
same graph differently, keep this extractor and write a renderer; to say which
upgrades matter, add a comparator file.

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

# Cargo dependencies

The crates of a Cargo workspace and everything they depend on, as Cargo resolves
them: each workspace member, the packages it depends on, and what those pull in,
transitively. Compared across a pull request, it answers "which crates did this
change add, remove, upgrade or downgrade, and what pulls them in?"

<!-- generated: facts -->

- ID: `cargo-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `Cargo.toml`, `**/Cargo.toml`

<!-- end generated: facts -->

## When to use it

Use it in a Rust repository with a `Cargo.toml`, single crate or workspace, to
review dependency changes as a graph rather than a `Cargo.lock` diff: a new
crate and the dozens it brings, a major upgrade deep in the tree, two
semver-incompatible versions of one crate built side by side. It asks Cargo
itself, so the graph is the one Cargo resolves, including Git and path
dependencies.

Running Cargo needs `--trust` (or a metadata export, below). It covers Rust
crates only. For Node workspaces use
[`workspace-dependencies`](workspace-dependencies.md), for .NET
[`nuget-dependencies`](nuget-dependencies.md).

## What it reads

By default it runs
`cargo metadata --format-version 1 --manifest-path <manifest>` in the revision,
with `manifestPath` (default `Cargo.toml`) and `cargoPath` (default `cargo`).
Cargo reads the manifests and `Cargo.lock`, and may update the lockfile or fetch
the registry index while it resolves. Grant the variables Cargo needs, such as
`CARGO_HOME` and `RUSTUP_HOME`, in the definition's `execution.environment`, and
raise `execution.timeoutMs` (30 seconds by default) if resolution is slow:

```json
"execution": {"environment": ["CARGO_HOME", "RUSTUP_HOME"], "timeoutMs": 120000}
```

With `metadataPath`, it reads that repository-relative file instead: the JSON
`cargo metadata --format-version 1` printed. It runs nothing and needs no
`--trust`, but the file must be present, and current, in every revision you
compare. Metadata without a resolved graph (from `--no-deps`) is rejected.

Each resolved crate is a `package` entity with its `version`, its `source` (a
registry, a Git repository, or `local`) and whether it is a `workspaceMember`.
Each dependency is a `depends-on` relationship with the name it is used under
(an alias, when renamed) and its kinds (`normal`, `dev`, `build`) and target
conditions. IDs are the crate's name and source, never its version, so an
upgrade is one modified package, not a removal and an addition.

## Options

<!-- generated: inputs -->

| Input          | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `cargoPath`    | Cargo executable.                                       |
| `manifestPath` | Cargo.toml path; default Cargo.toml.                    |
| `metadataPath` | Pre-exported cargo metadata JSON; otherwise runs Cargo. |

<!-- end generated: inputs -->

## What a comparison shows

- **Packages** added or removed: a new crate and everything it brings in, or one
  that is no longer in the graph.
- **Upgrades and downgrades** as modified packages, whose version changed. The
  [`dependencies`](../renderers/graph.md) renderer words each by the part of the
  version that moved (`Major upgrade`, `Patch downgrade`), and its summary bar
  counts them (`3 major upgrades · 12 patch upgrades`), then packages whose
  versions can't be ordered (`changed otherwise`) and how many direct
  dependencies of a workspace member changed, each filtering to its packages.
- **Dependencies** added, removed or modified: a crate moved from
  `[dev-dependencies]` to `[dependencies]`, or given a target condition.

Workspace members are the graph's roots, drawn as workspaces. Unchanged
transitive crates collapse into summary cards ("12 more packages") so the change
stays readable; the renderer's **All packages** control (`transitive`) shows
them all, and **Every dependency** (`paths`) draws every edge rather than the
one path that pulls each crate in.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "cargo-dependencies",
  "id": "cargo-dependencies",
  "renderer": "dependencies",
  "title": "Cargo dependencies"
}
```

<!-- end generated: definition -->

## Limitations

- It is Cargo's resolved graph for every target and feature Cargo resolved, not
  one build: a dependency behind a `cfg` for another platform is listed, with
  its condition.
- When a crate is resolved at two versions at once (`syn` 1 and 2), each ID
  gains its semver-compatible line (`@1`, `@2`). So when a second version
  arrives or the last duplicate leaves, the existing crate's ID changes, and it
  reads as removed and added rather than unchanged.
- A Git dependency's ID leaves out its revision, so moving it to another commit
  is a modified package; its version may not change, and then it counts as
  `changed otherwise`.
- It reads Cargo's metadata, not the registry: it can't tell you about
  advisories, licenses or crate contents.

## Related

- [`graph`](../renderers/graph.md), whose `dependencies` presentation draws it.
- [`workspace-dependencies`](workspace-dependencies.md) and
  [`nuget-dependencies`](nuget-dependencies.md), the same graph for Node and
  .NET.
- [`rust-public-api`](rust-public-api.md), for what a crate exports rather than
  what it depends on.
- [The default comparator](../comparators/default.md), which can order steps by
  how many crates depend on each (`order.by: dependents`).

## How it works

The [package README](../../../packages/extractors/cargo-dependencies/README.md)
details how crates are identified and what Cargo's metadata contributes.

## Build your own

Write your own extractor when Cargo's resolved graph isn't the one you need:

- **One build, not every one**: the crates a single target, platform or feature
  set actually compiles, from `cargo tree --target … --features …` or your build
  system.
- **Facts Cargo doesn't have**: which team owns each crate, which binaries ship
  it, `unsafe` usage or audit status from `cargo vet` or `cargo deny`.
- **Another build system**: Bazel or Buck targets with their own dependency
  graph.

Try the lighter options first: `manifestPath` points it at a workspace that
isn't at the repository root, and `metadataPath` reads an export your CI already
makes. To draw the same graph differently, keep this extractor and write a
renderer; to say which upgrades matter, add a comparator file.

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

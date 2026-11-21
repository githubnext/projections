# Cargo dependencies

This extractor maps the crates in a Cargo workspace and everything they depend
on, exactly as Cargo resolves them—every workspace member, its direct
dependencies, and the transitive tree beneath them. Compared across a pull
request, it shows which crates were added, removed, upgraded, or downgraded, and
what pulls each one into the build.

<!-- generated: facts -->

- ID: `cargo-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `Cargo.toml`, `**/Cargo.toml`

<!-- end generated: facts -->

## When to use it

Use this extractor in any Rust repository with a `Cargo.toml`—whether a single
crate or a multi-crate workspace—to review dependency changes as a graph instead
of digging through a `Cargo.lock` diff. It makes it easy to spot a newly added
crate and the dozens of packages it pulls in, a major upgrade buried deep in the
tree, or two semver-incompatible versions of the same crate built side by side.
Because it queries Cargo directly, the graph reflects what Cargo actually
resolves, including Git and path dependencies.

Running Cargo requires `--trust` unless you supply a pre-exported metadata file
(described below). This extractor covers Rust crates only; for Node workspaces
use [`workspace-dependencies`](workspace-dependencies.md), and for .NET use
[`nuget-dependencies`](nuget-dependencies.md).

## What it reads

By default, the extractor runs
`cargo metadata --format-version 1 --manifest-path <manifest>` in each revision,
using `manifestPath` (default `Cargo.toml`) and `cargoPath` (default `cargo`).
Cargo reads the manifests and `Cargo.lock`, and it may update the lockfile or
fetch the registry index while resolving. Grant any environment variables Cargo
needs—such as `CARGO_HOME` and `RUSTUP_HOME`—in your definition's
`execution.environment`, and bump `execution.timeoutMs` (30 seconds by default)
if resolution takes longer:

```json
"execution": {"environment": ["CARGO_HOME", "RUSTUP_HOME"], "timeoutMs": 120000}
```

If you set `metadataPath`, the extractor reads that repository-relative JSON
file instead (the output of `cargo metadata --format-version 1`). Nothing runs
and `--trust` is not required, though the file must exist and stay up to date in
every revision you compare. Metadata generated with `--no-deps` is rejected
because it lacks the resolved graph.

Each resolved crate becomes a `package` entity with its `version`, its `source`
(a registry, a Git repository, or `local`), and a `workspaceMember` flag. Each
dependency becomes a `depends-on` relationship carrying the name it is imported
under (including aliases when renamed), its kinds (`normal`, `dev`, `build`),
and any target conditions. Entity IDs combine the crate's name and source
without its version, so upgrading a crate shows up as a single modified package
rather than a removal and an addition.

## Options

<!-- generated: inputs -->

| Input          | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `cargoPath`    | Cargo executable.                                       |
| `manifestPath` | Cargo.toml path; default Cargo.toml.                    |
| `metadataPath` | Pre-exported cargo metadata JSON; otherwise runs Cargo. |

<!-- end generated: inputs -->

## What a comparison shows

- **Added or removed packages** highlight any new crate and everything it brings
  along, as well as crates that dropped out of the graph.
- **Upgrades and downgrades** appear as modified packages whose version changed.
  The [`dependencies`](../renderers/graph.md) renderer labels each change by the
  version component that moved (`Major upgrade`, `Patch downgrade`). Its summary
  bar tallies those shifts (`3 major upgrades · 12 patch upgrades`), followed by
  packages whose versions cannot be ordered (`changed otherwise`) and the number
  of changed direct workspace dependencies. Clicking any count filters the graph
  to those packages.
- **Added, removed, or modified dependencies** show structural changes like a
  crate moving from `[dev-dependencies]` to `[dependencies]` or gaining a target
  condition.

Workspace members sit at the root of the graph as workspaces. To keep diffs
scannable, unchanged transitive crates collapse into summary cards ("12 more
packages"). Turn on **All packages** (`transitive`) to expand them all, or
**Every dependency** (`paths`) to show every edge instead of a single path into
each crate.

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

- The graph reflects everything Cargo resolved across all targets and features,
  not a single build configuration. A dependency gated behind a `cfg` for
  another platform still appears, along with its condition.
- When two versions of the same crate exist side by side (such as `syn` 1 and
  2), each ID gets its semver-compatible line appended (`@1`, `@2`). When a
  second version is introduced—or the last duplicate is removed—the existing
  crate's ID changes, so it appears as removed and re-added instead of
  unchanged.
- A Git dependency's ID omits its commit revision, so moving it to a different
  commit appears as a modified package. If its version number did not change, it
  is counted under `changed otherwise`.
- Because it reads Cargo metadata rather than the registry, it cannot report
  security advisories, licenses, or crate contents.

## Related

- [`graph`](../renderers/graph.md) renders this extractor with its
  `dependencies` presentation.
- [`workspace-dependencies`](workspace-dependencies.md) and
  [`nuget-dependencies`](nuget-dependencies.md) provide the same dependency
  graph for Node and .NET.
- [`rust-public-api`](rust-public-api.md) tracks what a crate exports rather
  than what it depends on.
- [The default comparator](../comparators/default.md) can order review steps by
  how many crates depend on each package (`order.by: dependents`).

## How it works

See the
[package README](../../../packages/extractors/cargo-dependencies/README.md) for
how crates are identified and what information Cargo's metadata provides.

## Build your own

Consider writing a custom extractor when Cargo's resolved graph does not tell
the story you need:

- **A single build instead of all targets**, showing only the crates compiled
  for one target, platform, or feature set via
  `cargo tree --target … --features …` or your build system.
- **Facts Cargo does not track**, like crate ownership by team, which binaries
  ship each crate, `unsafe` usage, or audit results from `cargo vet` or
  `cargo deny`.
- **Another build system**, such as Bazel or Buck targets with their own
  dependency graph.

Check the lighter options first: `manifestPath` handles workspaces outside the
repository root, and `metadataPath` reads an export your CI already produces. To
change the visual layout, keep this extractor and write a renderer; to highlight
specific upgrades that matter to your team, add a comparator file.

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

# Swift package dependencies

A Swift package's graph as SwiftPM declares and resolves it: its products and
targets, what each target depends on, and the packages they come from with the
versions `Package.resolved` pins. Compared across a pull request, it answers
"which targets and packages did this change add, remove or rewire, and which
package versions moved?"

<!-- generated: facts -->

- ID: `swift-package-dependencies`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `Package.swift`

<!-- end generated: facts -->

## When to use it

Use it in a repository with a `Package.swift`: a library package, a command line
tool, or an app whose code is split into local packages. It shows the module
structure (which target depends on which) together with the third-party packages
each target uses, so a review sees both a new internal dependency and a package
upgrade.

It reads the manifest without running it, so it needs no Swift toolchain and no
`--trust`, and works on Linux and Windows as well as macOS. Manifests that
compute their targets (`#if`, loops, functions, environment variables) need
SwiftPM to evaluate them: see [What it reads](#what-it-reads).

It reads Swift packages only, not Xcode projects (`.xcodeproj`).

## What it reads

It reads `Package.swift` in `root` (default the repository's root) and, through
`.package(path:)` dependencies, every local package inside the repository,
transitively, so an app split into local packages is one connected graph. It
reads `Package.resolved` next to the root manifest.

**Reading the manifest without running it.** `Package.swift` is Swift code. By
default the extractor reads it as data: the `Package(…)` initializer, the
top-level constants it refers to (`let shared: [Target.Dependency] = […]`),
arrays joined with `+`, and unconditional top-level `package.targets += […]` or
`.append(…)`. Requirements are normalized as SwiftPM does (`from: "1.1.0"` is
`1.1.0..<2.0.0`), and a test compares the result with SwiftPM's own evaluation
of the same manifests. Code that changes something else, such as
`for target in package.targets { target.swiftSettings = … }`, is ignored, since
it doesn't change the graph.

When a value the graph needs is decided by code (`#if os(Linux)`, a loop or
condition, a function, string interpolation, an environment variable), the
extraction fails and names the manifest's line, rather than guessing. Then
either:

- set `manifest` to `"dump-package"`: SwiftPM evaluates each manifest with
  `swift package dump-package`. This compiles and runs the manifest, so it needs
  `--trust` and a Swift toolchain, and it is evaluated for the machine that runs
  it (`#if os(Linux)` is false on macOS). It doesn't resolve or download
  packages. A definition in this mode reads a checkout rather than Git objects,
  and its extractions are cached per toolchain (`environmental`).
- or set `manifestJsonPath` to `swift package dump-package` output your CI
  writes into each revision. Nothing runs, and no `--trust` is needed.

```json
{
  "extractor": "swift-package-dependencies",
  "renderer": "dependencies",
  "inputs": {"manifest": "dump-package"},
  "execution": {"environment": ["HOME", "DEVELOPER_DIR"]}
}
```

Each target is a `target` entity with its `type` (`regular`, `executable`,
`test`, `macro`, `plugin`, `system`, `binary`) and its package; each product is
a `product` entity with its `type` and a library's `linkage`, which `includes`
its targets. A target's `depends-on` relationships lead to another target, to a
product of a local package, or to an `external-package`, naming the `product` it
uses and any `platforms` or `traits` condition. An external package has its
`source` (`repository`, `registry` or `local`), `location`, declared
`requirement`, and the `version`, `revision` or `branch` `Package.resolved`
pins. Packages it pins that no manifest declares are needed by other packages in
turn; they are marked `transitive`, without a relationship, because
`Package.resolved` doesn't record which package needs them.

IDs are the package's directory and the target's or product's name
(`swiftpm:.:target:Harbor`), and an external package's identity
(`swiftpm:package:swift-log`), never a version, so an upgrade is one modified
package.

## Options

<!-- generated: inputs -->

| Input              | Meaning                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `manifest`         | "static" reads Package.swift without running it (default); "dump-package" runs swift package dump-package. |
| `manifestJsonPath` | Pre-exported swift package dump-package JSON for the root package.                                         |
| `root`             | Repository-relative package directory; default ".".                                                        |
| `swiftPath`        | Swift executable for dump-package; default swift.                                                          |

<!-- end generated: inputs -->

## What a comparison shows

- **Targets and products** added, removed or retyped, and the targets a product
  includes.
- **Dependencies** between targets, and on packages, added, removed or given a
  platform condition.
- **Upgrades and downgrades** of external packages as modified packages, worded
  by the part of the version that moved (`Minor upgrade`) and counted in the
  summary bar; a changed requirement (`from:`) without a resolved change is a
  modified package too.

The package's targets and products are the graph's roots, drawn on the left.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "swift-package-dependencies",
  "id": "swift-package-dependencies",
  "renderer": "dependencies",
  "title": "Swift package dependencies"
}
```

<!-- end generated: definition -->

## Limitations

- It doesn't resolve packages, so it doesn't know which package needs a
  transitive one, or the products and targets inside external packages. A
  dependency on a package `Package.resolved` doesn't pin (a missing or stale
  lockfile) has no version.
- Read without running it, the manifest is the one in `Package.swift`; SwiftPM
  may use a version-specific manifest (`Package@swift-6.0.swift`) instead, which
  `metadata.limitations` names.
- `dump-package` evaluates the manifest for the machine running it: a
  platform-specific `#if` is decided by that platform.
- Local packages outside the repository (`.package(path: "../Shared")`) are
  external packages, with no products or targets.

## Related

- [`graph`](../renderers/graph.md), whose `dependencies` presentation draws it.
- [`cargo-dependencies`](cargo-dependencies.md) and
  [`workspace-dependencies`](workspace-dependencies.md), the same for Rust and
  Node.

## How it works

The
[package README](../../../packages/extractors/swift-package-dependencies/README.md)
details how manifests are read and how identities are formed.

## Build your own

Write your own extractor when the declared graph isn't the one you need:

- **The resolved graph across packages**: which package needs each transitive
  one, from `swift package show-dependencies --format json`, which resolves and
  downloads packages.
- **Module imports rather than declarations**: what each target's sources
  actually `import`.
- **Facts SwiftPM doesn't have**: owners, binary sizes or licenses.

Try the lighter options first: `root` points it at a package that isn't at the
repository's root, and `manifestJsonPath` reads an export your CI already makes.
To draw the same graph differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor**, and
pick its language. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer dependencies
```

Run it with `projections show -p <id> --trust` as you change it.
[Write your first extractor](../../guides/first-extractor.md) walks through one.

# Swift public API

The public API of a Swift package's library modules, as the compiler sees it:
every public and open declaration with its signature and the contract facts
compatibility rules read. Compared across a pull request, it answers "what did
this change add, remove or change in what clients of these modules can use?"

<!-- generated: facts -->

- ID: `swift-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `Package.swift`

<!-- end generated: facts -->

## When to use it

Use it in a Swift package that others depend on (a library, an SDK, a shared
module of an app) to review API changes as declarations rather than a source
diff: a new method, a removed case, a parameter whose type changed, a class that
is no longer `open`.

It asks the compiler, so it needs the package's Swift toolchain and `--trust`
(building runs the package's plugins and macros), or symbol graphs a build
already wrote. For a source-only view without a toolchain, nothing built in
reads Swift declarations: see [Build your own](#build-your-own).

## What it reads

By default it runs, in `packagePath`:

```sh
swift package dump-package
swift package dump-symbol-graph --skip-synthesized-members --minimum-access-level public --skip-inherited-docs
```

`dump-package` names the package's library products, whose targets are the
modules it reads (or set `modules`). `dump-symbol-graph` builds the package in
debug and writes one symbol graph per module, with the extensions a module adds
to other modules' types. With a `Package.resolved`, SwiftPM uses only the
versions it pins (`--force-resolved-versions`) and never rewrites it. A module
that re-exports another (`@_exported import`) includes that module's
declarations, as its clients see them.

With `symbolGraphPath`, it reads the revision's `*.symbols.json` files directly
in that repository-relative folder instead (an ignored or untracked graph there
isn't part of the revision and is left out): graphs written by
`swift build -emit-symbol-graph`, `xcodebuild` (`-symbol-graph` builds of a
framework) or `swift-symbolgraph-extract`. Nothing runs and no `--trust` is
needed, but the folder must be part of every revision you compare.

```json
{
  "extractor": "swift-public-api",
  "renderer": "api",
  "inputs": {"scratchPath": ".build"},
  "execution": {"timeoutMs": 300000, "environment": ["HOME", "DEVELOPER_DIR", "TMPDIR"]}
}
```

### Time and caching

Building is the cost. Measured on an Apple M-series Mac with Swift 6.4:

<!-- prettier-ignore -->
| Package | Cold | Warm (nothing changed) | After one edit |
|---|---|---|---|
| Two modules, no dependencies | 7 s | 0.7 s | — |
| Three modules, `swift-collections` and `swift-argument-parser` | 13–20 s, plus about 2 s to resolve from SwiftPM's cache (5 s the first time, from the network) | 1.5 s | 4 s |
| A macro target on `swift-syntax` 600 | 30 s, plus 8 s to resolve from the network | 1.6 s | — |

A built-in's default `execution.timeoutMs` is 30 seconds and its maximum 300
(five minutes), so a small package fits cold, and a large one needs a warm
build:

- **`scratchPath`** sets the build directory, relative to the package. By
  default each run builds in a private directory it removes afterwards, so every
  run is cold. `".build"` uses SwiftPM's usual one: on your working tree it
  reuses your builds, and in a persistent workspace (the `worktree` or `clone`
  workspace strategy) each revision builds incrementally on the last. A fresh
  temporary copy of a revision (the `fresh` strategy) always starts cold.
- **Resolution** downloads packages the first time. Declare an environment
  `prepare` step, `swift package resolve`, keyed on `Package.resolved`, so it
  runs once per lockfile and with its own, longer timeout, before the extraction
  ([Environments](../../runner/environments.md)).
- **Extractions are cached** per revision and toolchain (`environmental`), so a
  revision is built once; CI can publish its extractions so reviewers never
  build.
- When a build can't fit, write the graphs in CI
  (`swift build -Xswiftc -emit-symbol-graph -Xswiftc -emit-symbol-graph-dir -Xswiftc .build/symbol-graphs`)
  and import them with `symbolGraphPath`.

## Options

<!-- generated: inputs -->

| Input             | Meaning                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `modules`         | Modules to include; default the targets of the package's library products.                       |
| `packagePath`     | Repository-relative package directory; default ".".                                              |
| `scratchPath`     | Build directory, relative to the package; default a private one per run.                         |
| `swiftPath`       | Swift executable; default swift.                                                                 |
| `symbolGraphPath` | Directory of pre-generated *.symbols.json files; otherwise runs swift package dump-symbol-graph. |

<!-- end generated: inputs -->

## Model

Each declaration is an entity whose ID is its module and path, as Swift names
it: `swift:Ledger.Entry.init(amount:kind:memo:)`. Argument labels are part of a
function's name, so adding a parameter (even one with a default) is a new
function and the old one's removal. Overloads that share a name are one entity
with several `signatures`. Members a module adds to a type from a module it
doesn't re-export are under an extension:
`swift:Ledger/extension Foundation.Date.ledgerDay`.

<!-- prettier-ignore -->
| Kind | Swift | Contract facts |
|---|---|---|
| `module` | A module | — |
| `class`, `struct`, `enum`, `protocol` | Types | `sealed` (a class that isn't `open`), `supertypes` (superclass, conformances; a protocol's inherited protocols), `typeParameters` |
| `case` | Enum cases | — |
| `init`, `method`, `function`, `operator`, `subscript` | Callables | `signatures` (parameters with `default`, `variadic` and `inout` as `passing: ref`; `returns`; `typeParameters`), `static`, `abstract` (a protocol requirement without a default implementation), `optional` (`@objc optional`) |
| `property`, `variable` | Properties and globals | `type`, `readonly` (`let`, or `{ get }` only), `static` |
| `typealias`, `associatedtype` | Aliases and associated types | `type` |
| `extension` | An extension of another module's type | `type` (the extended type), `supertypes` (the conformances it adds) |

`attributes` lists the attributes the compiler prints (`@discardableResult`,
`@MainActor`) and availability (`@available(*, deprecated, message: "…")`).
`native` holds facts only Swift's rules read: `open` (a member subclasses may
override), `async`, `throws`, `rethrows`, `mutating`, `final`, `convenience`,
`required`, `nonisolated`, and same-type constraints as `where`. The extraction
declares `metadata.ecosystem: "swift"`. Implicit conformances (`Copyable`,
`Escapable`, `SendableMetatype`) and synthesized members are left out.

## What a comparison shows

Declarations added, removed or changed, with their before and after signatures.
With the
[`api-compatibility` comparator](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml),
the rules every ecosystem shares classify each change (a removal is breaking, an
addition additive); Swift has no rules of its own there yet, so Swift-specific
compatibility (a class no longer `open`, a new protocol requirement) is shown as
a change but not classified as breaking.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "swift-public-api",
  "id": "swift-public-api",
  "renderer": "api",
  "title": "Swift public API"
}
```

<!-- end generated: definition -->

## Limitations

- It builds for the machine it runs on: `#if os(…)` and platform availability
  are decided by that platform, and an iOS-only package needs symbol graphs from
  an iOS build, imported with `symbolGraphPath`.
- Xcode projects aren't built; import graphs `xcodebuild` writes.
- Documentation comments, `@_spi` declarations and `package`-level access are
  left out.
- Swift's own compatibility rules (library evolution, resilience) aren't
  applied; only the rules every ecosystem shares are.

## Related

- [`api`](../renderers/api.md), which draws it.
- [`swift-package-dependencies`](swift-package-dependencies.md), for what a
  package depends on.
- [`typescript-public-api`](typescript-public-api.md),
  [`rust-public-api`](rust-public-api.md), [`go-public-api`](go-public-api.md)
  and [`dotnet-public-api`](dotnet-public-api.md), the same for other languages.

## How it works

The [package README](../../../packages/extractors/swift-public-api/README.md)
details the symbol graph mapping and the tests.

## Build your own

Write your own extractor when the compiler's view isn't the one you need:

- **No toolchain**: a source-level reading of public declarations, accepting
  that `#if`, macros and inferred types are approximate.
- **One platform's API**: symbol graphs from an `xcodebuild` build for iOS.
- **Facts the compiler doesn't record**: which declarations are documented,
  tested or used by an app.

Try the lighter options first: `modules` narrows what it reads, `scratchPath`
makes builds warm, and `symbolGraphPath` reads graphs your CI already writes.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor**, and
pick its language. Or choose **Ask an agent to write it**.

**With the CLI**, keep the API renderer:

```sh
projections init <id> --language node --renderer api
```

Run it with `projections show -p <id> --trust` as you change it.
[Write your first extractor](../../guides/first-extractor.md) walks through one.

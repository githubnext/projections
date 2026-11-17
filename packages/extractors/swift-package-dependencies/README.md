---
description: "A Swift package's products, targets and dependencies (graph/v0)"
---

# Swift package dependencies — `graph/v0`

Reads a Swift package's graph: its products and targets, each target's
dependencies, the local packages it depends on inside the repository, and the
external packages with the versions `Package.resolved` pins. The user guide is
[its page](../../../docs/builtins/extractors/swift-package-dependencies.md).

## Inputs

<!-- prettier-ignore -->
| Key | Meaning |
|---|---|
| `root` | Repository-relative package directory. Default `"."`. |
| `manifest` | `"static"` (default) reads `Package.swift` without running it; `"dump-package"` runs `swift package dump-package` for each package and requires `--trust`. |
| `manifestJsonPath` | `swift package dump-package` output for the root package, part of each revision. Nothing runs. Local packages are still read statically. |
| `swiftPath` | The Swift executable for `dump-package`. Default `swift`. |

## Reading manifests

[`swift-support`](../swift-support/README.md) holds both readers; each returns
the same model.

- **Static** (`manifest::statics`): a Swift lexer and a parser for literal
  expressions find the top-level `let package = Package(…)` and evaluate its
  `name`, `products`, `dependencies` and `targets`: string literals, arrays, `+`
  concatenation, implicit member calls (`.target(name:dependencies:path:)`,
  `.product(name:package:condition:)`, `.package(url:from:)`, …), version ranges
  and `Version(1, 2, 3)`, and top-level constants they name. Unconditional
  top-level `+=` and `append` to a constant or to `package.products`,
  `package.dependencies` and `package.targets` are applied. Any other change to
  those, or to a target's `dependencies`, `name` or `path`, anywhere (in a loop,
  condition or function), and any value read from `#if`, interpolation, closures
  or other operators, fails with the line. Requirements are normalized as
  `PackageDescription` does: `from:` and `.upToNextMajor(from:)` to the next
  major version, `.upToNextMinor(from:)` to the next minor one, `a...b` to just
  past `b`'s patch. Identities follow SwiftPM: the last component of the URL or
  path without `.git`, or the registry ID, lowercased.
- **dump-package** (`manifest::dump`): SwiftPM's JSON, with absolute local
  dependency paths made relative to the package's directory
  (`packageKind.root`). The scratch directory is a private one in the revision,
  removed afterwards; nothing is resolved or downloaded.

`Package.resolved` versions 1, 2 and 3 are read (`resolved`).

## Model

<!-- prettier-ignore -->
| Entity | `id` | `kind` | `data` |
|---|---|---|---|
| Target | `swiftpm:<directory>:target:<name>` | `target` | `package`, `type`, `path` when declared |
| Product | `swiftpm:<directory>:product:<name>` | `product` | `package`, `type`, `linkage` (libraries) |
| External package | `swiftpm:package:<identity>` | `external-package` | `source`, `location`, `requirement`, `version`/`revision`/`branch`, `transitive` |

`<directory>` is the package's repository-relative directory, `.` for the root.
Relationships are `includes` (product to target, ID
`includes:<product>:<target>`) and `depends-on` (target to target, product or
package, ID `depends-on:<from>:<to>:<name>`, with `product`, `platforms` and
`traits`). Entities and relationships are sorted by ID. `metadata` lists each
package read (`path`, `name`, `toolsVersion`, how its `manifest` was read), the
`resolved` file, `unresolved` dependencies (`[from ID, name]`) and
`limitations`.

## Tests

`tests/fixtures/harbor` is a real package with a local package, which SwiftPM
resolved and built: its `Package.resolved` is SwiftPM's.
`tests/fixtures/*.dump.json` are `swift package dump-package` output for each
manifest (Swift 6.4), with the fixtures' directory replaced by `/fixtures`.
`tests/package.rs` checks that the static reader gives exactly SwiftPM's
evaluation of each manifest, compares the extraction with
`harbor.expected.json`, and checks that `tests/fixtures/computed`, whose targets
depend on `#if`, is refused statically and read from its export. None of them
runs Swift. Regenerate the golden file with
`PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-swift-package-dependencies`.

The native test runs the real toolchain and is opt-in:

```sh
PROJECTIONS_NATIVE_SWIFT=1 cargo test -p projections-cli --test native_tools native_swift
```

---
description: "A Swift package's public API, from compiler symbol graphs (swift-public-api)"
---

# Swift public API — `swift-public-api`

The public declarations of a Swift package's library modules, read from the
compiler's symbol graphs, with the
[language-neutral contract facts](../../../docs/reference/schemas/api.md#contract).
The user guide is
[its page](../../../docs/builtins/extractors/swift-public-api.md).

<!-- prettier-ignore -->
| Input | Meaning |
|---|---|
| `packagePath` | The package's directory; default `.` |
| `modules` | Modules to read; default the targets of the package's library products (`swift package dump-package`), or every graph imported |
| `scratchPath` | SwiftPM's build directory, relative to the package; default a private one per run, removed afterwards |
| `swiftPath` | Swift executable; default `swift` |
| `symbolGraphPath` | A folder of `*.symbols.json`; nothing is run, and no trust is needed |

## Requirements

- The package's Swift toolchain, 5.9 or newer (`dump-symbol-graph` with
  extension block symbols); verified with Swift 6.4.2 (Xcode 27.2). It never
  installs a toolchain.
- `--trust`: building runs the package's build tool plugins and macros.
  Importing `symbolGraphPath` needs no trust.
- Symbol graph format 0.x; another major version fails rather than being
  misread.

## Mapping

`model.rs` reads every graph of the selected modules and indexes symbols by
module and precise identifier (USR): a module that re-exports another holds the
same symbols with its own relationships. Relationships give each symbol its
parent (`memberOf`, `requirementOf`, `optionalRequirementOf`), which is its
`contains` parent; top-level symbols are in their module. Default
implementations (`defaultImplementationOf`) aren't separate declarations: they
make their requirement non-`abstract`. `conformsTo` and `inheritsFrom` become
`supertypes` (`extends` for a superclass or a protocol's inherited protocol,
`implements` otherwise), named by the target's module and path, or the graph's
fallback name for types outside the selected modules. Extension block symbols
(`swift.extension`) of types outside the graph are `extension` entities holding
the conformances and members they add.

`model/contract.rs` turns a symbol into a contract: its kind's `declaration` and
`term` (the symbol kind without `swift.`), `open` and `sealed` from
`accessLevel`, `readonly` and `type` from the declaration fragments,
`signatures` from `functionSignature` with defaults, variadics and `inout` read
from the declaration's parameter list (`model/fragments.rs`), own generic
parameters (those the parent declares are left out) and availability.

## Tests

`tests/fixtures/compatibility/{before,after}` is a two-module package before and
after a change that exercises the contract facts (an `open` class made `public`,
a new protocol requirement, a new enum case, a new defaulted parameter, a
deprecation, a conformance added in another module). `{before,after}.symbols`
are the graphs Swift 6.4.2's `swift package dump-symbol-graph` wrote for them,
with the absolute directory replaced by `/fixtures/compatibility/<side>`. Unit
tests import them and compare `after` with `after.expected.json`, and check the
commands the extractor runs with a stand-in toolchain. Regenerate the golden
file with
`PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-swift-public-api`.

The native test builds both sides with the real toolchain and compares the
extraction with the imported graphs:

```sh
PROJECTIONS_NATIVE_SWIFT=1 cargo test -p projections-cli --test native_tools native_swift
```

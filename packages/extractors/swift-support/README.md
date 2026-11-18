---
description: "Shared support for the Swift extractors: manifests and Package.resolved"
---

# Swift support

`projections-extractor-swift-support` is shared by the Swift extractors; it
registers no extractor itself and runs nothing.

<!-- prettier-ignore -->
| Module | Contents |
|---|---|
| `lexer` | Swift source as tokens: identifiers, string literals (escapes, interpolation, multiline and raw), numbers, operators and `#` directives, with nested block comments removed |
| `syntax` | Literal expressions (calls with labeled arguments, member paths, arrays, ranges, `+`) and a file's top-level bindings and the changes code makes to values; what it can't evaluate is kept as `Opaque` with its line |
| `manifest` | A package manifest's products, targets and dependencies, read without running it (`statics`) or from `swift package dump-package` (`dump`), as one model |
| `resolved` | `Package.resolved` versions 1, 2 and 3 |
| `packages` | External packages as graph entities (`swiftpm:package:<identity>`), with their requirements and what `Package.resolved` pins, shared by every Swift extractor |

It reads source as text: it never type-checks, expands macros or decides `#if`
conditions. Readers that need a value it can't evaluate fail rather than guess.

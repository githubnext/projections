---
description: Editor support for comparator rules, as rules-editor.wasm
---

# Comparator rules for editors

Semantic tokens, diagnostics, hovers and completions for comparator files and
their tests, from the same reader and checker that load them. It is built as
`rules-editor.wasm` ([scripts/build.mjs](scripts/build.mjs)), which the VS Code
extension calls; it is a separate module from the interpreter, `rules.wasm`, so
viewers never download it.

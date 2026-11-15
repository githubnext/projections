---
description: The sandbox every host runs comparators in, on wasmi
---

# Comparator runtime

The sandbox every host runs comparators in. A custom comparator is a comparator
file, run by the rules interpreter (`rules.wasm`, built from
[`packages/comparators/rules`](../rules)); the default comparator runs as
`default-comparator.wasm`. Both are Projections' own WebAssembly modules, and
they share an internal ABI: zero imports, and the exports `memory`,
`projections_alloc(len) -> ptr` and `projections_compare(ptr, len) -> i64` (the
interpreter also exports `projections_rules_inspect`). Users write comparator
files, never modules; see
[the contracts](../../../docs/contracts/comparisons.md#the-interpreter-module).

## Rust: `projections-comparator-runtime`

Used by the CLI and by servers that verify comparisons. Runs the modules in
[`wasmi`](https://github.com/wasmi-labs/wasmi), a pure-Rust interpreter, with no
host functions at all.

```rust
use projections_comparator_runtime::{ComparatorModule, Limits};

let interpreter = ComparatorModule::load(&rules_wasm)?; // rejects imports and bad exports
let rules = ComparatorModule::rules(&interpreter, &rules_yaml)?; // checked in the sandbox
let comparison_json: Vec<u8> = rules.run(&input_json, &Limits::rules())?;
let identity: &str = rules.digest(); // rules_digest(interpreter_digest(rules.wasm), canonical rules)
```

- `load` validates one of Projections' modules, rejects any import, and checks
  the `memory`, `projections_alloc` and `projections_compare` exports and
  signatures. `rules`/`load_rules` check a comparator file with the
  interpreter's `projections_rules_inspect`, reporting every problem with its
  line, and identify it by `rules_digest`.
- `run` instantiates the module afresh in a new store for every call, so runs
  are independent and deterministic. `Limits` bounds fuel (default 100 billion
  units, roughly 30 s of tight-loop execution in an optimized build), memory
  (default 256 MiB, enforced by a store limiter on every growth, including the
  initial memory), input and output size (default 32 MiB each). Tables are
  limited to 1,000,000 elements.
- Errors are `ComparatorError` values with stable `code()` strings shared with
  the TypeScript runtime. A failed growth beyond the cap is reported as
  `memory-limit` even if the module recovers from it.
- The runtime checks the input and output envelopes structurally; validating a
  comparison against both extractions is the Engine's job.
- `digest(bytes)` returns `sha256:<hex>` for module identity.

The `projections-rules` binary
([`src/bin/projections-rules.rs`](src/bin/projections-rules.rs)) checks or runs
a comparator file in wasmi, one request on stdin per process; servers use it
through `createNativeRulesRuntime`.

## Browser and Node: `@githubnext/projections-comparator-runtime`

In [`js/`](js). See its README.

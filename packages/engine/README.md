---
description: "The shared Rust core: strict JSON, validation and comparison"
icon: cpu
---

# Engine

The shared semantic implementation: strict JSON parsing, extraction validation
and canonicalization (RFC 8785, SHA-256), volatility, and comparison integrity.
Native hosts link it as a crate; [packages/engine/js](js/README.md) compiles it
to WebAssembly for Node and browsers. There is no second JavaScript
implementation. Changes keep the coverage and mutation testing bars in
[TESTING.md](TESTING.md).

JSON stays at the boundary. `src/parse` strictly parses JSON, reads extractions
and comparisons into the typed model in `src/model` once, writes it back,
computes canonical bytes and digests, and serves the request ABI (`src/main.rs`
and `src/wasm.rs` call it). Everything else is a pure function of that model:
`src/validate` and `src/data_rules.rs` (identity, endpoints, domain schemas and
vocabularies), `src/comparison` (comparison integrity) and `src/volatility`
(declarations, tolerance and generated-value judgments, rerun checks). The
default comparator's matching and ordering use the same model.

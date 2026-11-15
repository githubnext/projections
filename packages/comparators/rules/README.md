---
description: "Interprets custom comparator files: YAML and CEL rules"
---

# The rules interpreter

The interpreter for custom comparators: comparator files
(`<name>.comparator.yaml`, `format: projections.comparator`), YAML declarations
and [CEL](https://cel.dev) expressions, the comparator rules, layered over the
default comparator. A definition names one with
`"comparator": "<path>.comparator.yaml"`, or
`{"file": "<path>.comparator.yaml", "options": {...}}`. The crates keep their
internal `rules` names.

[Write a custom comparator](../../../docs/guides/order-of-changes.md#write-a-custom-comparator)
walks through one;
[Custom comparators](../../../docs/design/declarative-comparators.md) is the
full reference (sections, inputs, types, the standard library, cost, the digest
and the equivalence results); the
[schema](../../schemas/schemas/comparator/v0.json) is published at
`https://schemas.projections.githubnext.com/comparator/v0.json`.

- [`yaml/`](yaml): `projections-rules-yaml`: the YAML subset, with each scalar's
  line and column, and [`suite`](yaml/src/suite), the comparator test format
  (`*.comparator.test.yaml`) and its judge. It evaluates nothing, so the CLI
  reads tests with it and runs rules only in the sandbox.
- [`src/rules/`](src/rules): The model: sections, variables, typed functions.
- [`src/check/`](src/check), [`src/types.rs`](src/types.rs): The load-time
  checker over the declared types.
- [`src/library/`](src/library): The standard library.
- [`src/macros/`](src/macros): The macros (`match`, `cond`, `collect`,
  `template`), expanded when a file loads.
- [`src/interpret/`](src/interpret): Interpreting a file over two extractions:
  baseline, inputs, checks, matching, classification, steps and metadata.
- [`src/cost.rs`](src/cost.rs): The deterministic cost meter.
- [`src/coverage/`](src/coverage): Rule coverage, opt-in: probes compiled into
  every expression of a file read with `Comparator::with_coverage`, counting its
  functions, expressions and decision outcomes
  ([Rule coverage](../../../docs/contracts/comparisons.md#rule-coverage)).
- [`src/core.rs`](src/core.rs), [`src/steps.rs`](src/steps.rs): Identity passes
  over the default matching, and the step operations.
- [`editor/`](editor): `projections-rules-editor`, built as `rules-editor.wasm`
  for the VS Code extension alone: the language service editors call
  (`projections_rules_editor`), with semantic tokens over exactly the CEL
  values, diagnostics at their line and column, hovers and completions
  ([Editing comparator files](../../../docs/design/declarative-comparators.md#editing-comparator-files)).
  It links this crate with the `editing` feature and without `abi`.
- [`src/module_abi.rs`](src/module_abi.rs), [`src/wasm.rs`](src/wasm.rs): The
  comparator module ABI (the default `abi` feature): `projections_compare`,
  `projections_rules_inspect` and `projections_rules_cover`.
- [`tests/`](tests): Agreement with every comparator the rules replaced (their
  recorded comparisons in [`tests/golden`](tests/golden)), the default
  comparator's order as rules, determinism, cost, the sandbox and regression
  ceilings.

`node packages/comparators/rules/scripts/build.mjs` builds `dist/rules.wasm`, a
zero-import comparator module, and `dist/THIRD_PARTY_NOTICES.txt`. Every host
runs that module in its sandbox: the CLI in wasmi, browsers in a Worker
(`createRulesRuntime` in `@githubnext/projections-comparator-runtime`).
`node packages/comparators/rules/editor/scripts/build.mjs` builds the editors'
module, `editor/dist/rules-editor.wasm`, which the VS Code extension's build
runs.

```sh
cargo test --release -p projections-comparator-rules   # everything, with the full generated corpus and the regression ceilings
cargo test -p projections-rules-yaml                     # the YAML subset and the test format
cargo test -p projections-rules-editor                   # the editors' language service
cargo test -p projections-cli --test comparator_tests    # every *.comparator.test.yaml in the repository, run as projections check runs them
npm run check:comparators                                # every comparator file and docs example: schema, checks and lint (after npm run build)
npm run test:rust:rules-coverage                         # the built-in rules comparators' rule coverage gates, with what is uncovered by line
cargo run --release -p projections-comparator-rules --example check -- file.comparator.yaml   # diagnostics with line and column
```

## Contributing an operation

Rules can express what every comparator here does. Logic that needs a compiler,
a parser or a resolver belongs in the extractor, as facts in `data`. An
operation belongs in the standard library only when it is:

1. **generic**: about graphs, IDs, lists, maps, findings or text, not one
   domain;
2. **needed by more than one comparator**; and
3. **inexpressible in CEL**, such as anything that iterates to a fixed point or
   recurses over data of unbounded depth, **or expressible only as list
   surgery**: index loops, scans standing in for maps, rebuilding data
   structures.

To add one:

1. Add a `Function` to `LIBRARY` in [`src/library/mod.rs`](src/library/mod.rs):
   its name in a namespace (`graph.`, `ids.`, `lists.`, `maps.`, `findings.`,
   `prose.`), parameter and result types, a cost class and the documentation the
   checker and the docs show. Its implementation, in the module for its
   namespace, must be deterministic (no hash-ordered output; sort by `ids.sort`
   order) and linear or `n log n` in its inputs; the cost meter charges it by
   the size of its result.
2. Test it: a checker test for its signature, a determinism test, and a case in
   the comparator that needed it.
3. Add its row to
   [the standard library table](../../../docs/design/declarative-comparators.md#the-standard-library),
   with what it replaces and why CEL can't, and use it in the rules that
   motivated it.

A change to the library changes `rules.wasm`, and with it every rules
comparator's digest, so saved comparisons are recompared once.

---
description: "The default comparator: matching, interpretation and order"
---

# Default comparator

`projections-comparator-default` is the comparator every projection uses unless
its definition names a custom comparator file, which layers over it. It is a
pure function

```
(before extraction, after extraction, options) -> comparison
```

with no filesystem, network, clock or randomness. It ships and runs only as a
WebAssembly module, like the rules interpreter: core WebAssembly with **zero
imports**, exporting `memory`, `projections_alloc(len) -> ptr` and
`projections_compare(ptr, len) -> (ptr << 32) | len` as specified in
[the contracts](../../../docs/contracts/comparisons.md#the-interpreter-module).
The CLI runs it in the [comparator runtime](../runtime/README.md)'s sandbox;
browsers run the same module. Only tests link the Rust code natively, to check
the module against it. Both extractions are validated by the Engine first, and
every result is checked with the Engine's `validate-comparison` rules.

## Correspondence and status

1. Exact IDs match first. An exact pair is a change only when its canonical
   content differs (`modified`, correspondence `exact`).
2. The remaining items are connected by explicit `previousIds` claims, honored
   in either direction so a reversed pair recognizes the same connection. The
   runner applies a definition's `correspondence` as `previousIds` before
   saving.
3. Each connected group of claims becomes one change: one before and one after
   item is `declared` (`modified` or `unchanged` by content), one before item
   and several after items is a `split`, several before items and one after item
   is a `merge`. Any other group is an `ambiguous-correspondence` error.
4. Everything else is `added` or `removed`.

Relationship content is compared after rewriting before-side endpoints through
one-to-one entity correspondence, so renaming an endpoint alone does not modify
a relationship. Evidence, previous IDs and metadata never make a change.

## Order

The default order is the prototype sequencer's policy:

- changes connected to each other through the change itself form one group;
- independent peers at the same depth change together;
- removals go leaves first and additions roots first, as exact mirror images, so
  swapping the extractions reverses the steps;
- at most five removal and five addition waves, made by merging whole adjacent
  layers, never by splitting a group;
- relationships leave with the first of their departing endpoints and arrive
  with the last of their arriving endpoints. A relationship that keeps its
  identity while moving from a departing endpoint to an arriving one arrives in
  either direction, the one exception to exact mirroring;
- every other change (modified, renamed, split or merged items, and
  relationships between surviving entities) forms one `restructure` step between
  them.

`order.reverse` is always `mirror`.

## Options

```json
{"comparator": {"options": {"order": {"by": "dependents", "direction": "descending"}}}}
```

`order.by` is `dependents` (incoming relationships in the after extraction, or
the before extraction for removals) or `data.<key>` (a numeric data field).
Steps are sorted within each phase by the largest value of their members,
`descending` by default. Ties keep the default order; steps without a value go
last.

## Build

```sh
node packages/comparators/default/scripts/build.mjs
```

builds `dist/default-comparator.wasm` (ignored build output) with a 256 MiB
memory maximum and verifies it has zero imports and the three ABI exports.
`npm run build` runs it through the Engine package, which ships the module as
`@githubnext/projections-engine/default-comparator.wasm`; the Inspector serves
it as `engine/default-comparator.wasm`, and the CLI embeds it, runs it and
records its `sha256:` digest in saved comparisons. The module ignores a supplied
`baseline`; hosts pass it an empty one, since its result is the baseline.

`cargo test -p projections-comparator-default` runs the shared conformance
corpus, the ported matching and sequencer tests, and builds the module from
source to inspect its imports, exports, signatures and memory bound.

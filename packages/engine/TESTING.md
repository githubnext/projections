# Testing the Engine

The core Rust Engine (`projections-engine`, this directory) and the default
comparator (`projections-comparator-default`, `packages/comparators/default`)
hold every rule that decides whether an extraction or a comparison is valid, so
they are held to very high unit test coverage and to mutation testing. Commands
below run from the repository root.

## Tests

- `packages/engine/src/parse/json.rs` and
  `packages/comparators/default/src/order/tests.rs` have unit tests for private
  behavior that no public entry point reaches.
- `packages/engine/tests/` covers the request ABI and its size limits
  (`requests.rs`), the executable (`binary.rs`), strict JSON (`json.rs`),
  extraction validation (`validation.rs`), comparison integrity
  (`comparison.rs`) and the shared conformance corpus (`conformance.rs`).
- `packages/comparators/default/tests/` covers the module function (`call.rs`),
  correspondence (`comparator.rs`, `matching.rs`), ordering (`order.rs`), the
  shared corpus and the Wasm module's imports and exports (`module.rs`).
- `properties.rs` in both crates holds
  [proptest](https://proptest-rs.github.io/proptest/) invariants:
  canonicalization and normalization are idempotent and independent of input
  order, digests match, validation rejects corrupted documents with the right
  diagnostic, an extraction compared with itself has no changes, every change
  references real items, results are deterministic, and the reverse comparison
  mirrors the forward one. Run more cases with
  `PROPTEST_CASES=5000 cargo test -p projections-comparator-default --test properties`.
  Failing inputs are not persisted; turn a reported minimal input into a regular
  test.

Tests assert behavior: the diagnostic code, path and message, the exact output,
or the boundary on both sides of a limit. A test that only executes a line is
not enough, which is what mutation testing checks.

## Coverage

```sh
rustup component add llvm-tools
cargo install cargo-llvm-cov@0.9.1 --locked
npm run test:rust:coverage
```

This measures both crates with
[cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov), prints uncovered
lines and fails below 98% line or region coverage. Add `--html` after
`npm run test:rust:coverage --` for a browsable report. Branch coverage needs a
nightly toolchain (`cargo +nightly llvm-cov --branch ...`) and is informational
only.

## Mutation testing

```sh
cargo install cargo-mutants@27.1.0 --locked
npm run test:rust:mutants -- --jobs 3                                # every mutant
git diff --relative origin/main... > /tmp/changes.diff
npm run test:rust:mutants -- --jobs 3 --in-diff /tmp/changes.diff   # changed code only
```

[cargo-mutants](https://mutants.rs) changes the code under test one mutation at
a time and expects a test to fail. Its configuration, `.cargo/mutants.toml`,
limits it to the two crates and skips the Wasm module build test. Results are in
`mutants.out/`. A full run with three jobs takes about 45 minutes locally.

## Proofs

The Engine's core promises are proved rather than only tested: Verus proves the
decisions in `packages/engine/verified` for every input, and the Engine and the
default comparator call them. `VERIFICATION.md` lists each promise, what is
proved, what is trusted and what is evidence. Run the proofs and their mutation
check with `npm run tools -- verify` (`--install` the first time); CI runs them
in the `verus` job, alongside the main check. Proofs are not part of
`cargo test`, and need no change to it.

## CI

The Projections workflow enforces the coverage thresholds (`coverage`) on every
push to `main`, nightly and on each pull request that reaches the Engine or the
default comparator, and mutation tests the changed code of each pull request
that changes a file `.cargo/mutants.toml` examines (`mutants-diff`), alongside
the main check ([what CI runs](../../CONTRIBUTING.md#what-ci-runs)). The
`Engine quality` workflow runs every mutant in four shards weekly and on manual
dispatch.

## Exclusions

There are no coverage exclusions. The few uncovered regions are unreachable
error arms, such as canonicalizing a `serde_json::Value`, which cannot fail; do
not add a test that only pretends to reach them. If code must be excluded, say
why in a comment next to it.

Every viable mutant must be killed by a test. A mutant may be excluded in
`.cargo/mutants.toml` only when

- it is equivalent: no input can observe the difference;
- it only hangs, so the suite could detect it only by timing out; or
- native tests cannot run it (`wasm.rs`, compiled only for `wasm32`; the Engine
  ABI is exercised by the `packages/engine/js` tests and the comparator ABI by
  the comparator runtime's tests).

Each exclusion carries a comment with its reason and is anchored to one mutant
name from `cargo mutants --list`. It names the file, function and mutation; it
also names the line and column only when the function has several identical
mutations. A stale line anchor stops matching, so the mutant is tested again
rather than silently skipped. Unviable mutants (those that do not compile) need
no action.

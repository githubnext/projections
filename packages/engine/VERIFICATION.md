# Verifying the Engine

The Engine decides whether an extraction or a comparison is valid, so a few of
its promises must never break, whatever a comparator, an extractor or a future
change does. This document is their intent artifact, in the style of
[PDD Kit](https://githubnext.com/projects/pdd-kit/) (Proof-Driven Development):
each promise in plain language, the decisions behind its exact wording, and what
holds it, labelled by the kind of assurance it rests on.

| Label        | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **Proved**   | [Verus](https://github.com/verus-lang/verus) proves the code meets the clause for every input.   |
| **Trusted**  | The proofs assume it; [The trusted boundary](#the-trusted-boundary) says why that is legitimate. |
| **Evidence** | Example and property-based tests (proptest) pass on the inputs they try.                         |

Every proved decision is in one dependency-free crate,
[`packages/engine/verified`](verified/README.md), and the Engine and the default
comparator call it: there is no second copy of any proved code. Ordinary builds,
native and Wasm, expand `verus!` into the plain Rust it contains.

A proof is only as good as its specification, so every clause carries a
plain-English comment, and a mutation check plants one bug per clause
(`packages/engine/verified/mutants/`, 71 of them) and requires Verus to reject
each on that clause or on the proof step that establishes it. A clause no mutant
can break would constrain nothing.

## The promises

### 1. Reversing a comparison gives exactly the mirror result

Comparing after with before lists the same changes, each mirrored: before and
after swapped, an addition read as a removal and back, a split read as a merge
and back; its steps play in reverse order with removals and additions swapped.

- **Proved**: the Engine accepts a change exactly when it accepts its mirror
  image (`correspondence::shape`); a matched group's correspondence in one
  direction is the mirror of the other's (`correspondence::group`); claim groups
  do not depend on direction (`components`).
- **Proved**: the default comparator's step assembly mirrors. Grouping layers
  into at most five waves never splits a layer (`waves::wave_sizes`); a changed
  relationship goes with its last arriving wave, else its last departing wave,
  else restructures, and swapping arriving and departing mirrors that placement
  (`waves::place_mirror`); and the steps of the reversed comparison are exactly
  these steps played backwards, removals and additions swapped
  (`waves::phases_mirror`).
- **Proved**: tolerance and generated-value judgments do not depend on which
  side is before (promises 4 and 5), so a reversed comparison judges every value
  the same way.
- **Evidence**: the whole comparison mirrors, its changes and its steps
  (`packages/comparators/default/tests/properties.rs`,
  `the_reverse_comparison_mirrors_the_forward_one`, with volatile data and
  declarations on both sides; `tests/order.rs`). Which entities are removed or
  added, and their layers, come from matching and the entity graph; they are
  tested, not proved, to mirror.

Decision recorded: steps mirror exactly **except** a relationship change with
both a departing and an arriving endpoint. It changes with its last arriving
endpoint in either direction, so it is in an addition step both ways.
`place_mirror` states that exception and the property test names it
(`straddling`); "exactly the mirror" holds for every other step member.

Decision recorded: proving the whole comparison's steps mirror would mean
proving the entity graph's layering and the matching passes together, several
times the proof of everything else here. The middle ground above proves the
decisions that order the steps and leaves the graph tested.

### 2. Identity matching is one-to-one, and ambiguity is an error

No item belongs to two changes. A group of items that correspond many to many is
an `ambiguous-correspondence` error, never resolved by picking a pair. A key
that two items share on one side matches nothing there.

- **Proved**: no change the Engine accepts is many-to-many, from any comparator
  (`correspondence::shape`); the default comparator gives a group a
  correspondence exactly when it is one-to-one, a split or a merge, and every
  correspondence it chooses is one the Engine accepts (`correspondence::group`);
  a key identity pass pairs exactly the items whose key is unique on both sides,
  and no item twice (`keys::unique_pairs`), for the default exact-ID pass and
  every rules comparator's key passes; two items share a claim group exactly
  when a chain of claims joins them, so no group is merged silently
  (`components::components`, which also groups changed entities for
  presentation).
- **Evidence**: the Engine rejects an item referenced by two changes
  (`duplicate-reference`, `packages/engine/tests/comparison.rs`).

Decision recorded: an `unchanged` split or merge is a valid identity-only change
in the contract, so the proof accepts it. (The first draft of the specification
forbade it, and Verus refused the code; the contract was right.)

### 3. Canonical bytes and digests are deterministic, and equal for equal models

Normalizing an extraction and canonicalizing it (RFC 8785) gives the same bytes
and SHA-256 digest whatever the input's item order.

- **Proved**: normalization sorts every list it orders (items by ID, volatile
  declarations by their key, missing inputs, vocabularies) through one sort
  (`sort::sort`, called by `packages/engine/src/canonical.rs`). It returns a
  permutation that puts the keys in UTF-16 code unit order, the order JavaScript
  and RFC 8785 use, and the sorted keys depend only on which keys there are, so
  any arrangement of the same keys, sorted or not, gives the same sequence
  (`sort::canonical`). That makes normalization order-independent and
  idempotent.
- **Trusted**: `serde_jcs` writes RFC 8785 bytes, and SHA-256 hashes them;
  `str::encode_utf16` is injective.
- **Evidence**: idempotence, digest agreement and order independence over random
  extractions (`packages/engine/tests/properties.rs`). Number forms: `1` and
  `1.0` are equal in the model, and RFC 8785 writes both as `1`.

### 4. Tolerance decisions are monotonic

Loosening a declared bound, or declaring one more, never turns a difference
within tolerance into one beyond it; and combining declarations takes the
tighter, whichever side or declaration came first.

- **Proved**: a difference is within tolerance exactly when one declared bound
  holds, a list of spreads holding when every one does (`tolerance::within`), so
  declaring one more bound or loosening one keeps within within
  (`loosening_keeps_within`). Combining two tolerances accepts a difference
  exactly when both would by the same kind of bound, so it is no looser than
  either (`tighter_accepts`, unconditionally); and combining both sides'
  declarations does not depend on order (`merge_is_symmetric`).
- **Trusted**: IEEE 754 arithmetic. vstd leaves `f64` uninterpreted, so each
  operation is a one-line wrapper named by a specification function, and the
  proofs use four facts as axioms: `<=` is transitive; the `min` of two
  nonnegative numbers is one of them and at most each; scaling by a nonnegative
  number preserves order.
- **Evidence**: proptest over the whole finite range checks each axiom against
  real `f64` arithmetic (`packages/engine/src/volatility/tolerance/tests.rs`);
  `packages/engine/tests/volatility.rs`.

Decision recorded (November 2026): the rules for combining both sides'
declarations are symmetric. Before, the after side's spread or basis won where
the two sides declared different ones, so a reversed comparison could judge a
value differently. Now, with two spreads both must hold, and with two bases the
value moved if either moved (`docs/contracts/extractions.md`). The mirror
property test failed under the old rule.

A known edge: a spread alone with factor 0 whose spread values overflow (above
about 1e154) makes `0 × ∞ = NaN`, so even a zero difference is beyond it. The
scaling axiom's premise excludes it. It is unreachable, since equal values never
reach the tolerance check.

### 5. An equal basis means a generated value is unchanged

A generated value whose bases are equal on both sides is unchanged however its
text varies; a basis that moved, or a value on one side only, always makes it
beyond tolerance.

- **Proved**: the parts reported moved are exactly the basis parts that differ
  (`generated::moved_parts`), so bases move exactly when they differ; and a
  value is judged unchanged exactly when every basis is equal on both sides,
  whatever its two texts (`generated::judge`).
- **Trusted**: a part name's order is a lawful total order, so a `BTreeMap`
  finds what it holds, and two basis values are equal when `Datum`'s `==` says
  so.
- **Evidence**: `packages/engine/tests/generated.rs`.

### 6. "Unchanged" means no reported difference

An unchanged change has no content difference outside its declared volatile
values, and every volatile difference is within tolerance. An exact pair with no
difference at all is not listed; one whose differences are all within is listed
as `unchanged` with `varied` and belongs to no step. Nothing a comparator omits
may differ.

- **Proved (decisions)**: the default comparator's status and the Engine's check
  of any comparator's status agree; an accepted `unchanged` status, an unlisted
  pair and an accepted omission each mean there is no residual difference and
  every volatile difference is within tolerance
  (`unchanged::unchanged_means_no_reported_difference`).
- **Proved (content)**: a data key is reported as a residual difference, and a
  pair of values differs, exactly when they are not equal everywhere outside the
  declared volatile and basis paths (`content::residual_keys`,
  `content::differs`), so no residual difference means equal outside declared
  variation.
- **Trusted**: `Datum`'s `==` on values that aren't both objects or both arrays
  (numbers compare by value); an array index's key is its decimal digits;
  `String`'s order is lawful.
- **Evidence**: the Engine recomputes every one-to-one change's assessment and
  rejects a status or `varied` that disagrees, and rejects an omitted difference
  (`hidden-change`, `packages/engine/tests/comparison.rs`);
  `packages/engine/tests/volatility.rs` and the conformance corpus.

## The trusted boundary

The proofs cover the decisions in `packages/engine/verified`. They assume:

- **The glue that calls them**, which tests cover: turning the Engine's model
  into the verified functions' arguments, and their results back (for example,
  `packages/engine/src/canonical.rs`'s UTF-16 words, the key numbering in the
  default comparator's `run_pass`, and the Engine calling `shape` for every
  change it reads). The glue is thin by design: it converts, never decides.
- **IEEE 754** (promise 4): four named axioms, each checked by proptest.
- **Lawful orders and equality**: `String`'s `Ord` is a total order (a
  `requires` at each call, which Rust's standard library guarantees); `Datum`'s
  `==`; an array index's decimal key.
- **`serde_jcs` and SHA-256** (promise 3).
- **Rust's `Vec`, `BTreeMap` and `Ord`**, through vstd's specifications.
- **The `verus!` macro's erasure**: ordinary builds compile the same code with
  specifications and proofs removed (`verus_builtin_macros`, a build-time
  dependency only).
- **Verus and Z3** themselves.

Not promised: performance or termination on huge inputs beyond the Engine's
limits, and anything about renderers or hosts.

## Running the checks

`packages/engine/verified/verus.toml` pins the Verus release, the Rust toolchain
it needs and its macro crate's version; `tools verify` and CI read it and
nothing else pins Verus. From the repository root:

```sh
npm run tools -- verify --install   # download the pinned release, then prove and run the mutation check
npm run tools -- verify --proofs-only
```

`--install` puts the release in `~/.cache/projections/verus/<release>` and
installs the pinned toolchain with `rustup`, minimal profile; nothing else is
installed. `node packages/engine/verified/scripts/verify.mjs` does the same
without the workspace's npm install, which is how CI runs it. To install by
hand, into any directory and outside `~/.rustup`:

```sh
T=$PWD/.verification
export RUSTUP_HOME=$T/rustup
curl -LO https://github.com/verus-lang/verus/releases/download/release/0.2026.11.02.8bf68ee/verus-0.2026.11.02.8bf68ee-arm64-macos.zip
unzip verus-*.zip -d $T && rustup toolchain install 1.99.1 --profile minimal
node packages/engine/verified/scripts/verify.mjs --verus $T/verus-arm64-macos/verus
```

To change the release, update `verus.toml` and the `verus_builtin_macros`
version in `packages/engine/verified/Cargo.toml` together;
`tools/cli/test/verify.test.ts` fails when they disagree, or when a mutant's
text no longer occurs in its module.

CI runs the `verus` job in parallel with the main job (`.github/actions/verus`):
a checkout, the cached release and the pinned toolchain, with no npm install and
no workspace build. It runs when a change reaches the Engine's crates, on every
push to `main` and nightly; `ci-ok`, the required check, fails when it does
([what CI runs](../../CONTRIBUTING.md#what-ci-runs)).

## Measurements

Measured in November 2026 on an Apple Silicon Mac and on GitHub's
`ubuntu-latest` runners.

| Module           | Promise | Code lines | Proof lines |
| ---------------- | ------- | ---------: | ----------: |
| `correspondence` | 1, 2    |         96 |          58 |
| `keys`           | 2       |         45 |         125 |
| `components`     | 1, 2    |         98 |         187 |
| `sort`           | 3       |        183 |         274 |
| `tolerance`      | 1, 4    |        155 |         148 |
| `generated`      | 1, 5    |         78 |         222 |
| `unchanged`      | 6       |         33 |          22 |
| `content`        | 6       |        154 |         221 |
| `waves`          | 1       |        104 |         137 |
| `datum`, `lib`   |         |        128 |           0 |
| **Total**        |         |   **1074** |    **1394** |

Lines exclude comments and blank lines; proof lines are specifications,
`requires` and `ensures` clauses, invariants, assertions and lemmas, so proof is
about 1.3 times the code. The mutants add 743 lines, and the scripts and
`tools verify` about 300.

|                |                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effort         | About an hour for the pilot's two modules; about two hours of agent time for the other seven, the symmetric merge rules and the CI job                                                 |
| Verifier time  | 95 items in 1.3 s on the Mac, 7 s on a CI runner                                                                                                                                       |
| Mutation check | 71 mutants in 30 s on the Mac (four at a time, each verifying only its module)                                                                                                         |
| CI             | The `verus` job, in parallel with the rest: about 3 minutes on `ubuntu-latest`, of which 30 s is setup with the release cached (33 MB), 7 s the proofs and the rest the mutation check |
| Memory         | Under 1 GB per Verus process                                                                                                                                                           |
| Build friction | None: one build-time macro crate; native and Wasm builds, `cargo test` and clippy unchanged                                                                                            |

What the proofs found: Verus rejected the first specification of correspondence
shapes, which forbade an `unchanged` split or merge that the contract allows;
and specifying the merge rules exposed that combining declarations favoured the
after side, which broke mirroring (now symmetric). Neither was a crash; both
were wrong promises.

### Kani: dropped

The pilot also tried [Kani](https://model-checking.github.io/kani/) bounded
proofs that parsing and canonicalization never panic and that tolerance is
monotonic. Loop-free numeric harnesses proved in seconds; floating-point
multiplication, maps and sorting timed out after 10 to 20 minutes or grew past
11 GB in CBMC. Verus now proves what those harnesses aimed at, for every input
rather than bounded ones, so the harnesses were removed. (A memory leak during
the pilot's Kani runs was later traced to Playwright WebKit tracing, not Kani.)
For no-panic parsing, fuzzing `parse_json` and `canonicalize` would complement
the property tests better than bounded model checking.

### Recommendation

**Keep it, and hold it to this scope.** Every promise above is now proved at the
decision that keeps it, behind a trusted boundary that is small, named and
tested. The cost is about 1.3 lines of proof per line of code in one crate,
seconds of verification, and a parallel CI job that needs no build. Extend it
only when a new engine decision joins one of these promises; route such
decisions through `packages/engine/verified` rather than writing them in the
Engine. Proving whole-comparison step mirroring (the entity graph and the
matching passes) is not worth its cost while the property test holds it.

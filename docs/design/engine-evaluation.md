# Projection engine evaluation

Status: adopted from the measured evidence below.

## Decision

Adopt one Rust semantic core compiled to a native executable and browser Wasm.
The same `EngineRequest`/`EngineResponse` ABI performs raw JSON decoding,
normalization/validation, explicit matching, canonicalization and comparison. No
JavaScript semantic implementation or success-shaped fallback is required.

This recommendation follows actual native/browser output agreement and runtime
measurements, not just toolchain availability. Production/release readiness
remains a separate gate.

## Pre-rename adoption measurements

The measurements in this section were recorded before the public Engine naming
change. They remain the qualified adoption-time evidence, not measurements of
the renamed artifacts. The renamed implementation preserves the same semantics,
wire operations, bounds and tests.

Measured 2026-11-03 on macOS arm64, Apple M5 Max, Node 26.12.1, Rust 1.97.1,
actual headless Chromium 156.0.8078.4. The reproducible driver is
`npm run measure --workspace @githubnext/projections-engine`.

The initial slice's release native executable is 583,952 bytes. Its browser Wasm
is 348,568 bytes, 130,456 bytes gzip. Browser module import, local HTTP fetch,
compilation and instantiation took 8.4 ms in this run. These figures are
build/host-specific; network latency and a cold public deployment are not
measured.

The representative cyclic graph contains 1,000 service nodes and 5,000
relationships, including nested data and per-node source evidence. Its compact
input is 524,541 bytes. The comparison renames and modifies a node, updating its
incident endpoints without falsely modifying the relationships.

| Operation              | Native median | Browser Wasm median | Result JSON bytes |
| ---------------------- | ------------: | ------------------: | ----------------: |
| Decode                 |       26.0 ms |             18.9 ms |           574,541 |
| Normalize              |       30.6 ms |             22.2 ms |           574,541 |
| Canonicalize + SHA-256 |       36.2 ms |             29.2 ms |           623,753 |
| Compare                |       89.3 ms |             73.5 ms |         2,025,236 |

Medians are five sequential samples. Native timings include process startup,
request serialization, stdin/stdout transfer and response parsing. Browser
timings include request serialization, Wasm input/output copies and response
parsing, but exclude Playwright's cross-process transfer. Therefore these are
practical binding measurements, not isolated core CPU benchmarks or an
apples-to-apples language ranking. Browser output and native output deeply agree
on every sample.

A limit-sized graph (10,000 nodes, 50,000 edges; input 5,274,741 bytes) was also
executed through all four real bindings:

| Operation              |   Native | Browser Wasm | Result JSON bytes |
| ---------------------- | -------: | -----------: | ----------------: |
| Decode                 | 243.8 ms |     231.9 ms |         5,774,741 |
| Normalize              | 268.9 ms |     231.0 ms |         5,774,741 |
| Canonicalize + SHA-256 | 345.4 ms |     331.6 ms |         6,255,953 |
| Compare                | 978.3 ms |   1,341.8 ms |        20,309,637 |

This is one stress sample, not a distribution or universal performance
guarantee. All outputs agree. Comparison payloads intentionally retain both
entities and explanations and can substantially exceed input size. The measured
limit-sized comparison fits the 64 MiB response limit and Wasm's 512 MiB memory
ceiling.

The pre-rename follow-up was remeasured after adding strict artifact parsing,
normalized-output size checks and Worker support: Wasm 349,035 bytes (130,644
gzip), native 583,952 bytes; representative compare medians 97.5 ms native /
83.5 ms Wasm. Its single maximum graph sample is 971.6 ms native / 1,682.9 ms
Wasm. The earlier tables are retained as the adoption-time evidence, not
silently presented as timings of later code.

The six initial shared protocol corpus cases also agree through native and real
Chromium **and WebKit**, covering canonical bytes, explicit renames, duplicate
identity, missing endpoints, duplicate raw JSON keys and unsafe raw integers.
Additional engine tests exercise all seven domain validators, reverse renamed +
modified entities/relationships, ambiguity, strict fields, cycles, bounds,
evidence exclusion, Unicode ordering and ECMAScript number spelling.

## Renamed Engine verification

The renamed native/Wasm/Worker entries and artifacts were rebuilt and
remeasured. `engine-measurements.json` records those new measurements: native
583,952 bytes; Wasm 348,971 bytes (130,633 gzip); browser startup 6.8 ms.
Representative five-run compare medians are 112.4 ms native / 86.4 ms Wasm. The
single maximum-graph sample is 1,194.6 ms native / 1,765.8 ms Wasm. Timing
variation on a shared host is not evidence of a semantic change or a latency
guarantee.

The current suite has 13 Rust tests, 142 Node tests, and 61 shared-plus-engine
native/browser ABI cases **per browser engine**, covering valid and invalid
inputs in every standard IR. Boundary tests exercise exactly 32 MiB raw JSON,
exactly 8 MiB extractor JSON, 50/64-level depth distinctions, oversized values
and normalized-output expansion. Clean tarball verification also compiles a
fresh consumer's TypeScript imports and runs its native/Wasm methods with Rust
tools absent from PATH.

## Consequences and limitations

The Wasm artifact is small enough for a practical browser slice and the
representative browser comparison was below 100 ms in the recorded runs. The
largest supported graphs should run inside an application-owned Worker: promises
alone do not prevent a synchronous 1.34-second Wasm call from blocking the UI.

The follow-up `/worker` package entry now supplies that Worker lifecycle, with
explicit disposal and failure of all pending operations on timeout/crash. Actual
Chromium and WebKit execute a 10,000-node/50,000-edge comparison in the Worker
with native output agreement while the main thread continues ticking 10-ms UI
timers (127 and 55 ticks respectively in the recorded run). This is
responsiveness evidence, not a frame-rate guarantee: input serialization and
result parsing still occur on the caller. The Worker does not add another
engine.

Clean tarball tests install protocol and engine into a fresh consumer directory
and execute both native and Wasm without workspace links or a Rust build in that
consumer. Failure tests cover spawn, malformed JSON/response, nonzero exits,
signals, timeout, stdout/stderr overflow, invalid Wasm, disposal and rejected
pending requests. Packaging retains MIT and dependency license notices.

The strict `parse-json` follow-up was also exercised on a 30,859,072-byte
comparison-shaped envelope containing the two limit-sized states and the real
native comparison. JSON-string wrapping makes its request 37,139,176 bytes,
above the original 32 MiB transport cap. Both Chromium and WebKit Workers now
deeply agree with native on the parsed envelope. The raw artifact limit remains
32 MiB while transport is separately bounded to 128 MiB; oversized raw artifacts
still fail. A quote-heavy regression independently covers double encoding.

Native JSON RPC is intentionally per-operation and bounded. Persistent workers
could reduce startup overhead later, but are not needed to demonstrate this
shared engine or to expose the package ABI. No extractor, Git, process, clock,
network, filesystem or DOM API exists in the semantic library.

No float formatter was improvised: RFC 8785 canonicalization delegates to
`serde_jcs` 0.2.0 and `ryu-js` 0.2.2, locked in Cargo. This is reuse of
established implementations, not a claim of an independent security audit.
Diagnostics and parsing remain native/Rust so duplicate keys and unsafe integers
can be rejected before an ordinary host parser erases them.

Only the measured macOS arm64 native artifact is execution-verified. Linux and
Windows packaging remain unverified. Memory exhaustion is an explicit trap or
process failure, not a fabricated empty state. There is no claim of byte/hash
compatibility with earlier prototypes, and no dependency on them.

## The default comparator in the CLI's comparator runtime

The CLI runs the default comparator as `default-comparator.wasm` in the
comparator runtime (the `wasmi` interpreter, default limits), the sandbox
comparator files run in, rather than linking its Rust code. Measured on macOS
arm64 with optimized builds, comparing two generated `graph/v0` extractions
whose every relationship changed (the worst case for the comparator's work),
excluding Engine validation:

| Entities / relationships                |  Input | Changes | Native Rust | `default-comparator.wasm` in `wasmi` |
| --------------------------------------- | -----: | ------: | ----------: | -----------------------------------: |
| 1,000 / 5,000                           | 0.8 MB |  10,011 |       63 ms |                               446 ms |
| 5,000 / 25,000                          | 4.4 MB |  50,052 |      358 ms |                             2,168 ms |
| 10,000 / 50,000 (the extraction limits) | 8.8 MB | 100,104 |      661 ms |                             4,495 ms |

Loading the module takes about 6 ms. The interpreter is about seven times slower
than native code, and every limit-sized run stays well inside the default fuel
budget and memory cap. Both produce identical comparisons. Typical pull request
comparisons, with hundreds of changes, take milliseconds either way.

# Projection engine evaluation

Status: adopted, based on the measurements below.

## Decision

We will use a single Rust semantic core compiled to both a native executable and
browser Wasm. The same `EngineRequest`/`EngineResponse` ABI handles raw JSON
decoding, normalization and validation, explicit matching, canonicalization, and
comparison. That means we don't need a separate JavaScript semantic
implementation or a fake success-shaped fallback.

This decision rests on verified agreement between native and browser outputs and
on measured runtime performance, not just on whether the toolchain compiles.
Production and release readiness are still gated separately.

## Pre-rename adoption measurements

We recorded these numbers before the public Engine rename. They serve as the
evidence that justified adoption, not as benchmarks for the renamed artifacts.
The renamed implementation keeps the same semantics, wire operations, bounds,
and tests.

All runs took place on 2026-11-03 on macOS arm64 (Apple M5 Max, Node 26.12.1,
Rust 1.97.1, headless Chromium 156.0.8078.4) using
`npm run measure --workspace @githubnext/projections-engine`.

In that initial slice, the release native executable came in at 583,952 bytes.
The browser Wasm binary was 348,568 bytes uncompressed and 130,456 bytes
gzipped. Importing the browser module, fetching it over local HTTP, compiling
it, and instantiating it took 8.4 ms. Keep in mind that these numbers are
specific to this build and host; they don't include network latency or a cold
public deployment.

For a representative workload, we used a cyclic graph with 1,000 service nodes
and 5,000 relationships, including nested data and per-node source evidence
(524,541 bytes of compact input). The comparison renames and modifies a node,
updating its incident endpoints without falsely marking the relationships as
modified.

| Operation              | Native median | Browser Wasm median | Result JSON bytes |
| ---------------------- | ------------: | ------------------: | ----------------: |
| Decode                 |       26.0 ms |             18.9 ms |           574,541 |
| Normalize              |       30.6 ms |             22.2 ms |           574,541 |
| Canonicalize + SHA-256 |       36.2 ms |             29.2 ms |           623,753 |
| Compare                |       89.3 ms |             73.5 ms |         2,025,236 |

Each median comes from five sequential samples. Native times include process
startup, request serialization, stdin/stdout transfer, and response parsing.
Browser times include request serialization, Wasm input/output copies, and
response parsing, but not Playwright's cross-process transfer. Treat these as
practical end-to-end binding numbers rather than isolated CPU benchmarks or a
direct language comparison. Native and browser outputs matched deeply on every
sample.

We also ran a limit-sized graph (10,000 nodes and 50,000 edges; 5,274,741 bytes
of input) through all four bindings:

| Operation              |   Native | Browser Wasm | Result JSON bytes |
| ---------------------- | -------: | -----------: | ----------------: |
| Decode                 | 243.8 ms |     231.9 ms |         5,774,741 |
| Normalize              | 268.9 ms |     231.0 ms |         5,774,741 |
| Canonicalize + SHA-256 | 345.4 ms |     331.6 ms |         6,255,953 |
| Compare                | 978.3 ms |   1,341.8 ms |        20,309,637 |

That is a single stress sample, not a statistical distribution or a universal
guarantee, and all outputs agreed. Comparison payloads intentionally keep both
entities and their explanations, so they can grow much larger than the input.
Even so, the limit-sized comparison stayed inside the 64 MiB response limit and
Wasm's 512 MiB memory ceiling.

After adding strict artifact parsing, normalized-output size checks, and Worker
support, we remeasured the pre-rename follow-up. Wasm grew slightly to 349,035
bytes (130,644 gzipped) while native stayed at 583,952 bytes. Representative
compare medians were 97.5 ms native and 83.5 ms Wasm, and the single
maximum-graph sample took 971.6 ms native and 1,682.9 ms Wasm. We kept the
original tables above intact as adoption-time evidence instead of quietly
swapping in numbers from later code.

The six initial shared protocol corpus cases also agreed across native, real
Chromium, **and WebKit**. They cover canonical bytes, explicit renames,
duplicate identity, missing endpoints, duplicate raw JSON keys, and unsafe raw
integers. Additional engine tests cover all seven domain validators, reverse
renamed-and-modified entities and relationships, ambiguity, strict fields,
cycles, bounds, evidence exclusion, Unicode ordering, and ECMAScript number
spelling.

## Renamed Engine verification

After renaming the native, Wasm, and Worker entry points and artifacts, we
rebuilt and remeasured everything, recording the results in
`engine-measurements.json`. Native stayed at 583,952 bytes, Wasm came in at
348,971 bytes (130,633 gzipped), and browser startup took 6.8 ms. Five-run
representative compare medians were 112.4 ms native and 86.4 ms Wasm, while the
single maximum-graph sample took 1,194.6 ms native and 1,765.8 ms Wasm. Small
timing swings on a shared host don't indicate a semantic change or establish a
latency guarantee.

The test suite now has 13 Rust tests, 142 Node tests, and 61 shared-plus-engine
native/browser ABI cases **per browser engine**, covering both valid and invalid
inputs across every standard IR. Boundary tests check the exact 32 MiB raw JSON
limit, the exact 8 MiB extractor JSON limit, 50- and 64-level depth
distinctions, oversized values, and normalized-output expansion. Clean tarball
verification also compiles a fresh consumer's TypeScript imports and runs its
native and Wasm methods with no Rust tools on PATH.

## Consequences and limitations

The Wasm binary is small enough for practical browser use, and representative
comparisons stayed under 100 ms in our runs. For the largest supported graphs,
however, the host application should run Wasm inside a Worker: wrapping a
synchronous 1.34-second Wasm call in a promise still blocks the main thread.

The follow-up `/worker` package entry now provides that Worker lifecycle,
including explicit disposal and failing all pending operations on a timeout or
crash. Both Chromium and WebKit ran a 10,000-node, 50,000-edge comparison inside
the Worker with full native output agreement while the main thread kept ticking
10-ms UI timers (127 ticks in Chromium and 55 in WebKit). That shows the UI
stays responsive, though it isn't a frame-rate guarantee because input
serialization and result parsing still happen on the caller. The Worker runs the
exact same engine, not a separate one.

Clean tarball tests install the protocol and engine packages into a fresh
consumer directory and run both native and Wasm paths without workspace links or
a local Rust build. Failure tests verify spawn errors, malformed JSON or
responses, nonzero exits, signals, timeouts, stdout/stderr overflow, invalid
Wasm, disposal, and rejected pending requests. The published packages preserve
MIT and dependency license notices.

We also tested the strict `parse-json` follow-up on a 30,859,072-byte
comparison-shaped envelope holding two limit-sized states and the real native
comparison. Wrapping it as a JSON string pushes the request to 37,139,176 bytes,
past the original 32 MiB transport cap. Both Chromium and WebKit Workers now
match native output on that parsed envelope. The raw artifact limit stays at 32
MiB while transport has a separate 128 MiB ceiling, so oversized raw artifacts
still fail. A quote-heavy regression test independently covers double encoding.

Native JSON RPC runs per operation with strict bounds. Persistent worker
processes could cut startup overhead later, but we don't need them to prove out
the shared engine or expose the package ABI. The semantic library itself has no
extractor, Git, process, clock, network, filesystem, or DOM APIs.

We didn't write a custom float formatter. RFC 8785 canonicalization delegates to
`serde_jcs` 0.2.0 and `ryu-js` 0.2.2, both locked in Cargo. That gives us
established implementations, though it is not an independent security audit.
Parsing and diagnostics stay in native Rust so duplicate keys and unsafe
integers get caught before a host parser can silently erase them.

So far, only the macOS arm64 native artifact has been execution-verified; Linux
and Windows packaging still need verification. Memory exhaustion surfaces as an
explicit trap or process failure rather than a fabricated empty state. We make
no claim of byte or hash compatibility with earlier prototypes and have no
dependency on them.

## The default comparator in the CLI's comparator runtime

Rather than linking the default comparator's Rust code directly, the CLI runs it
as `default-comparator.wasm` inside the same `wasmi` interpreter sandbox (with
default limits) used for comparator files. On macOS arm64 with optimized builds,
we measured worst-case comparisons of two generated `graph/v0` extractions where
every relationship changed (excluding Engine validation):

| Entities / relationships                |  Input | Changes | Native Rust | `default-comparator.wasm` in `wasmi` |
| --------------------------------------- | -----: | ------: | ----------: | -----------------------------------: |
| 1,000 / 5,000                           | 0.8 MB |  10,011 |       63 ms |                               446 ms |
| 5,000 / 25,000                          | 4.4 MB |  50,052 |      358 ms |                             2,168 ms |
| 10,000 / 50,000 (the extraction limits) | 8.8 MB | 100,104 |      661 ms |                             4,495 ms |

Loading the module takes about 6 ms. The interpreter runs roughly seven times
slower than native code, yet even a limit-sized run stays comfortably inside the
default fuel budget and memory cap, and both produce identical comparisons.
Typical pull request comparisons have hundreds of changes and finish in
milliseconds either way.

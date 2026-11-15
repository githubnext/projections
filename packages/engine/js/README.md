---
description: The Engine as WebAssembly for Node and browsers
---

# Projections semantic engine

One Rust implementation supplies normalization, nine standard IR validators,
explicit identity matching, RFC 8785 canonicalization and SHA-256 to native
processes and browsers. The JavaScript package contains transport bindings only.
It neither collects repository facts nor lays out/presents a graph.

```ts
import {createNativeEngine} from '@githubnext/projections-engine/native'
const native = createNativeEngine() // optional {executable, timeoutMs, maxResponseBytes}
const normalized = await native.decode(rawCollectorJson)
const {digest} = await native.canonicalize(normalized)
```

```ts
import {createWasmEngine} from '@githubnext/projections-engine/browser'
const browser = await createWasmEngine() // fetches the adjacent artifacts/engine.wasm and default-comparator.wasm
const comparison = await browser.compare(before, after)
```

For UI-facing or large-extraction work, use the Worker facade:

```ts
import {createWorkerEngine} from '@githubnext/projections-engine/worker'
const worker = await createWorkerEngine() // optional {workerUrl, wasm, comparator, timeoutMs}
try {
  const comparison = await worker.compare(before, after)
} finally {
  worker.dispose()
}
```

The Worker uses the same Wasm artifact and raw JSON ABI. Semantic execution runs
off the UI thread; input serialization and result parsing still occur on the
caller. `dispose()` is idempotent and rejects pending/future operations.
Initialization failure, crashes, malformed replies, and startup/request timeout
terminate the Worker and reject all pending requests. `timeoutMs` is 30 s by
default (1 ms–300 s); a request timeout includes its queue wait. Worker script
and Wasm URLs must satisfy the application's CSP and same-origin/CORS policy.

Both factories return the protocol's `ProjectionEngine`. The native factory is
synchronous; the browser factory is asynchronous. All operations return
promises. The package root exports only shared types, errors and limits. It
never imports Node APIs. The `/browser` entry has no Node dependencies.

`createWasmEngine({url})` supports a separately served Wasm artifact.
`createWasmEngine({module})` accepts a `WebAssembly.Module`, `ArrayBuffer` or
typed array for offline loading and module reuse. These options are mutually
exclusive. A second argument, `{url}` or `{module}` (bytes, so its digest is
known), selects the default comparator module. Bundlers must copy the exported
`@githubnext/projections-engine/engine.wasm` and `default-comparator.wasm`
artifacts and preserve their URLs, or explicitly supply `url`/`module`. Ordinary
static hosting can serve `dist/` and `artifacts/` together. The Wasm module has
no imports, WASI, filesystem, network, clock or DOM dependency.

Pass **raw extractor JSON** to `decode`. A host `JSON.parse` cannot preserve
duplicate keys or the original spelling of a rounded unsafe integer. Object
methods reject non-JSON host values, unsafe/nonfinite numbers, unpaired
surrogates, cycles, sparse arrays, accessors and custom object prototypes rather
than letting `JSON.stringify` silently alter them. JavaScript numbers have
already been rounded by their producer; no API can recover precision lost before
a call.

Use `parseJson(rawArtifactJson)` for a strict parse of an entire saved
extraction, comparison or manifest envelope before artifact validation. It
returns generic protocol `Json`, not a validated artifact or extraction. It uses
the same Rust duplicate-key, Unicode and safe-number checks, with the 64-level
transport depth bound and 32 MiB raw artifact cap. The transport envelope has a
separate 128 MiB cap to accommodate JSON-string escaping without weakening the
raw bound. `decode` additionally normalizes and validates an extraction with its
tighter 50-level/8-MiB limits.

Semantic failures reject with `EngineError` and structured `diagnostics`
(`severity`, `code`, JSON Pointer `path`, `message`). `EngineTransportError`
identifies spawn, timeout, malformed response, output-limit and Wasm trap
failures. There is no JavaScript engine fallback. Native invocations run argv
directly, one bounded JSON document on stdin and one response on stdout; exit 0
means success, exit 1 a diagnostic response, and other exits/signals fail
transport validation. Native processes run per operation; calls do not share
mutable semantic state.

## Semantics and limits

All seven domain schemas are supported explicitly: graph, DAG, treemap, metrics,
API, database and architecture. Normalization validates before sorting entity
and relationship arrays by UTF-16 code-unit ID order and filling omitted `data`
with `{}`. Unknown fields/versions, dangling endpoints, cycles in hierarchical
schemas, and ambiguous identity are errors. Treemaps are forests; DAGs may have
multiple/parallel incoming relationships. Treemap internal values are
authoritative, not recomputed from leaves. Unicode text is never normalized.

`compare(before, after, options?)` runs the default comparator module
(`artifacts/default-comparator.wasm`, zero imports, a fresh instance per call)
and then `validateComparison` checks its result against both extractions. Exact
IDs match first, then explicit `previousIds` declarations from either side, so
swapping the extractions preserves correspondence. One-to-one claims are
declared renames; an unambiguous one-to-many or many-to-one group is a split or
merge; anything else is an `ambiguous-correspondence` comparator error.
Label/similarity matching is never used. Relationship identity is independent of
entity identity; matching entity IDs normalize endpoints only for content
equality. `defaultComparator()` reports the module's `sha256:` digest. A
comparator error rejects with an `EngineError` whose code is `comparator-error`.
One-to-one pairs are judged through the extractions' `volatile` declarations:
variation within tolerance is an `unchanged` change with `varied`, in no step.

`vary(before, after)` compares two extractions of the same revision, such as a
rerun, by ID with no matching, and resolves to `{equal, within, beyond}`:
whether the canonical bytes are identical, the volatile values that varied
within tolerance (`{collection, id, path}`) and everything else that differs
(`{collection?, id?, path, reason}`). The runs are reproducible when `beyond` is
empty. See
[volatile data](../../../docs/contracts/extractions.md#volatile-data).

Canonical content includes IDs, kinds, labels, data, confidence, relationship
endpoints and `volatile` declarations. Evidence, previous IDs and extraction
metadata are excluded. Object keys and item arrays use UTF-16 ordering; numbers
use RFC 8785/ECMAScript formatting through `serde_jcs`/`ryu-js`, including `-0`
to `0`. The digest is lowercase SHA-256 of the UTF-8 canonical bytes, not an
artifact-byte hash.

| Bound                                   |                                                                    Supported limit |
| --------------------------------------- | ---------------------------------------------------------------------------------: |
| Entities / relationships per extraction |                                                                    10,000 / 50,000 |
| Extraction nesting                      |                                                    50 JSON levels, root at depth 0 |
| Extraction JSON size                    | 8 MiB compact input and normalized output; raw `decode` also bounds original bytes |
| Raw artifact JSON / request / response  |                                                          32 MiB / 128 MiB / 64 MiB |
| Comparator module input                 |                                                                             64 MiB |
| Transport JSON nesting                  |                                                                          64 levels |
| Native timeout                          |                                              30 s default, configurable 1 ms–300 s |
| Native stderr                           |                                                                             64 KiB |
| Wasm linear memory                      |                                 Engine 512 MiB, default comparator 256 MiB maximum |

These are enforced ceilings, not a latency or memory-allocation guarantee for
arbitrary data shapes. A limit-sized representative graph is exercised in real
Chromium and WebKit through the Worker. Run large comparisons in a Worker to
avoid blocking UI. The promise API does not make synchronous Wasm work
preemptible; cancellation/worker management belongs to the application. An
allocation failure/trap is an explicit transport failure.

## Build and verification

From the candidate public repository root, using Node >=26.12.1, Rust >=1.85 and
the locked dependency manifests:

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build --workspace @githubnext/projections-schemas
npm run build --workspace @githubnext/projections-engine
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
npm run typecheck --workspace @githubnext/projections-engine
npm test --workspace @githubnext/projections-engine
npx playwright install chromium webkit
npm run test:browser --workspace @githubnext/projections-engine
npm run measure --workspace @githubnext/projections-engine
```

Build output is local and ignored: `target/`, `packages/engine/js/dist/`,
`packages/engine/js/artifacts/engine.wasm`,
`packages/engine/js/artifacts/default-comparator.wasm`,
`packages/comparators/default/dist/` and `artifacts/native/`. Nothing outside
this repository, and no provider call, is needed. The checked-in Cargo lockfile
and `--locked` builds prevent dependency drift. `npm pack` builds and includes
the real executable/Wasm artifacts, not workspace symlinks.

The native artifact is built for the packaging host's OS/architecture; the
binding rejects a different host. Other hosts must build their own package or
set `executable` to a compatible separately built binary. Only macOS arm64 has
been executed in the initial measurement; other native platforms are not claimed
as verified. Wasm is portable and separately verified in Chromium and WebKit.
The Rust source is MIT. Build/pack includes its license and the locked Rust
dependencies' full license/notices under `artifacts/`; dependencies retain their
respective licenses rather than being relicensed.

## Verified artifact loading (`@githubnext/projections-engine/artifacts`)

`loadArtifact(json, {engine})` accepts raw saved extraction or comparison JSON
in Node or a browser. Inject the native engine, Wasm engine or Worker facade;
this module has no Node transport or alternate semantic engine.

The engine strictly parses raw JSON before generated structural validators run.
Loading verifies recorded projection/definition identity, the extraction and its
digest. Comparisons require one shared `definitionDigest`, are rerun with the
default comparator (whose recorded digest must match) and every saved change,
step and summary must match its result. A comparison made by a custom comparator
is verified with `{engine, rules: {bytes, runtime}}`: the comparator file its
definition names, whose digest must match, rerun in a rules runtime
(`createRulesRuntime()` or `createNativeRulesRuntime()` from
`@githubnext/projections-comparator-runtime`); without them it is rejected. JSON
object key order is irrelevant; array order is not. Unknown fields, invalid
claims and unsupported versions fail explicitly.

Inputs are bounded to 32 MiB of UTF-8 and 64 envelope levels; individual
extractions retain the engine's own limits. Larger combined documents can exceed
the artifact budget even when their individual extractions are valid. Errors
carry diagnostics; engine errors are preserved.

Structural validators are generated from the protocol's published JSON schemas
at build time using MIT-licensed `@exodus/schemasafe`. Published runtime modules
do not compile schemas, evaluate strings or need `unsafe-eval`. Wasm execution
separately requires the browser's `wasm-unsafe-eval` CSP permission.

Verification is not authentication: evidence/provenance remain untrusted claims,
and extraction digests intentionally exclude evidence. A downloaded archive also
needs byte hashes, independently authorized source identity and transport
checks. This loader never executes extractors or artifact-supplied code.

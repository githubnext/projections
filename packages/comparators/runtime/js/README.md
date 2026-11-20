---
description: Runs comparators sandboxed from JavaScript
---

# @githubnext/projections-comparator-runtime

Runs custom comparators (comparator files) sandboxed: the rules interpreter
(`rules.wasm`, built from [`packages/comparators/rules`](../../rules)) with
native WebAssembly in a dedicated, single-use Worker, or natively in wasmi on
servers.

```ts
import {ComparatorRuntimeError, createRulesRuntime} from '@githubnext/projections-comparator-runtime'

const runtime = createRulesRuntime({deadlineMs: 30_000, maxMemoryPages: 4096})
try {
  const {digest, warnings} = await runtime.check(rulesBytes) // diagnostics reject with RulesError
  const comparison = await runtime.compare(rulesBytes, {protocolVersion: 0, before, after, baseline, options: {}})
} catch (error) {
  if (error instanceof ComparatorRuntimeError) console.error(error.code, error.message)
}
```

- `createRulesRuntime()` checks and runs rules in Workers; the interpreter is
  the packaged `rules.wasm` (exported as `./rules.wasm`), which browsers fetch
  once from `rulesInterpreterUrl`, by default next to `browser.js`. Checks are
  cached by content.
- `createNativeRulesRuntime()` (Node only) runs them in the packaged native
  `projections-rules` runner, wasmi with the CLI's fuel and memory limits, one
  process per call, killed at the deadline: for servers, where the bounds must
  not depend on a browser.
- `isComparatorFile(path)` and `rulesComparatorDigest(interpreter, canonical)`
  are portable helpers.
- `.` resolves to `./node` under Node (`worker_threads`) and to `./browser`
  otherwise (Web Worker, created with
  `new Worker(new URL('./worker-entry.js', import.meta.url), {type: 'module'})`;
  pass `workerUrl` to override).
- Before any interpreter code runs, the module is compiled and checked: any
  import is rejected (`forbidden-import`), and the `memory`, `projections_alloc`
  and `projections_compare` exports must match the ABI.
- The deadline (default 30 s) is wall-clock time; when it passes the Worker is
  terminated and the call rejects with `deadline`.
- `check` and `compare` also take `{signal}`: aborting it terminates the Worker
  (or kills the native runner) and rejects with `cancelled`; an aborted signal
  never starts one. A caller with an overall budget across several calls passes
  `AbortSignal.timeout(remaining)` or its own controller, so no call outlives
  it. `loadArtifact` passes `rules.signal` through when it reruns a comparator
  file.
- Memory is capped at `maxMemoryPages` (default 4096, 256 MiB). A module whose
  initial memory exceeds the cap is rejected; a module that declares a maximum
  within the cap is bounded natively; otherwise the memory size is checked after
  each call into the module, and growth beyond the cap is reported as
  `memory-limit`. Browsers cannot interrupt growth they allow natively, so a
  module without a declared maximum can allocate past the cap until the call
  returns or traps.
- Input and output are capped at 32 MiB by default (`maxInputBytes`,
  `maxOutputBytes`).
- Every failure rejects with `ComparatorRuntimeError` using the same codes and,
  where the cause is host-independent, the same messages as the Rust runtime.
  The runtime never falls back to another comparison.

`./testing` exports in-thread variants, and a Worker runner for modules of a
test's own that speak the interpreter's ABI, for tests only. The in-thread
variants have no deadline, so a non-terminating module hangs the calling thread.

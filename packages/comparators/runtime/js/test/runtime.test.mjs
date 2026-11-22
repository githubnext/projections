import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ComparatorRuntimeError} from '../dist/node.js'
import {
  inspectModule,
  runComparatorBytesInThreadForTests,
  runComparatorInThreadForTests,
  runModuleInWorkerForTests as runComparator,
} from '../dist/testing.js'
import {comparator, i32, i64, op, wasm} from './wasm.mjs'

const input = {protocolVersion: 0, before: {}, after: {}, baseline: {}, options: {}}
const comparison = '{"protocolVersion":0,"changes":[],"steps":[],"metadata":{}}'
const exports = [
  {name: 'memory', kind: 2, index: 0},
  {name: 'projections_alloc', kind: 0, index: 0},
  {name: 'projections_compare', kind: 0, index: 1},
]
const forever = [...op.loop, ...op.br(0), ...op.end]

async function rejects(promise, code, message) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof ComparatorRuntimeError, error)
    assert.equal(error.code, code, error.message)
    if (message) assert.match(error.message, message)
    return true
  })
}

test('runs a comparator in a worker and returns its comparison', async () => {
  const bytes = comparator(comparison)
  assert.deepEqual(await runComparator(bytes, input), JSON.parse(comparison))
  assert.deepEqual(await runComparatorInThreadForTests(bytes, input), JSON.parse(comparison))
  const raw = await runComparatorBytesInThreadForTests(bytes, input)
  assert.equal(new TextDecoder().decode(raw), comparison)
  // Concurrent runs use independent workers.
  const results = await Promise.all(Array.from({length: 4}, () => runComparator(bytes, input)))
  for (const result of results) assert.deepEqual(result, JSON.parse(comparison))
})

test('writes the input at the allocated pointer', async () => {
  const length = new TextEncoder().encode(JSON.stringify(input)).length
  const check = condition => [...condition, ...op.if, ...op.unreachable, ...op.end]
  const bytes = comparator(comparison, {
    body: [
      ...check([...op.localGet(0), ...op.i32Const(4096), ...op.i32Ne]),
      ...check([...op.localGet(1), ...op.i32Const(length), ...op.i32Ne]),
      // i32.load8_u at 4096 must be '{'
      ...check([...op.i32Const(4096), 0x2d, 0x00, 0x00, ...op.i32Const(0x7b), ...op.i32Ne]),
    ],
  })
  assert.deepEqual(await runComparator(bytes, input), JSON.parse(comparison))
})

test('rejects modules with imports before running them', async () => {
  const bytes = wasm({
    types: [
      [[i32], [i32]],
      [[i32, i32], [i64]],
      [[], []],
    ],
    imports: [
      {module: 'env', name: 'clock', type: 2},
      {module: 'wasi_snapshot_preview1', name: 'fd_write', type: 0},
    ],
    functions: [
      {type: 0, body: op.i32Const(0)},
      {type: 1, body: op.i64Const(0)},
    ],
    memories: [{min: 1}],
    exports: [
      {name: 'memory', kind: 2, index: 0},
      {name: 'projections_alloc', kind: 0, index: 2},
      {name: 'projections_compare', kind: 0, index: 3},
    ],
  })
  await rejects(
    runComparator(bytes, input),
    'forbidden-import',
    /^comparator modules must have zero imports, but this module has 2: env\.clock, wasi_snapshot_preview1\.fd_write$/u,
  )
})

test('rejects missing and mistyped exports', async () => {
  const types = [
    [[i32], [i32]],
    [[i32, i32], [i64]],
    [[i32, i32], [i32]],
  ]
  const functions = [
    {type: 0, body: op.i32Const(0)},
    {type: 1, body: op.i64Const(0)},
    {type: 2, body: op.i32Const(0)},
  ]
  const build = moduleExports => wasm({types, functions, memories: [{min: 1}], exports: moduleExports})
  await rejects(
    runComparator(build(exports.slice(0, 2)), input),
    'missing-export',
    /^comparator module does not export \x60projections_compare\x60$/u,
  )
  await rejects(runComparator(build(exports.slice(1)), input), 'missing-export', /\x60memory\x60/u)
  await rejects(runComparator(build([exports[0], exports[2]]), input), 'missing-export', /\x60projections_alloc\x60/u)
  await rejects(
    runComparator(build([exports[0], exports[1], {name: 'projections_compare', kind: 0, index: 2}]), input),
    'invalid-export',
    /^comparator export \x60projections_compare\x60 must be a function \(i32, i32\) -> \(i64\), but is a function \(i32, i32\) -> \(i32\)$/u,
  )
  await rejects(
    runComparator(build([{name: 'memory', kind: 0, index: 0}, exports[1], exports[2]]), input),
    'invalid-export',
    /\x60memory\x60 must be a 32-bit linear memory, but is a function \(i32\) -> \(i32\)/u,
  )
  await rejects(runComparator(new TextEncoder().encode('not wasm'), input), 'invalid-module')
  assert.deepEqual(inspectModule(comparator(comparison, {memory: {min: 2, max: 8}})), {minimumPages: 2, maximumPages: 8})
})

test('terminates comparators that run past the deadline', async () => {
  const started = performance.now()
  await rejects(
    runComparator(comparator(comparison, {body: forever}), input, {deadlineMs: 200}),
    'deadline',
    /^comparator exceeded its 200 ms deadline$/u,
  )
  assert.ok(performance.now() - started < 5000)
  // Start functions run under the same deadline.
  const bytes = comparator(comparison, {extraFunctions: [{type: 2, body: forever}], start: 2})
  await rejects(runComparator(bytes, input, {deadlineMs: 200}), 'deadline')
})

test('the caller’s signal stops a running comparator, and one already aborted never starts it', async () => {
  const controller = new AbortController()
  const started = performance.now()
  const running = runComparator(comparator(comparison, {body: forever}), input, {deadlineMs: 30_000}, controller.signal)
  setTimeout(() => controller.abort(new Error('the artifact deadline passed')), 100)
  await rejects(running, 'cancelled', /^the comparator run was cancelled: the artifact deadline passed$/u)
  // Well before the comparator's own 30 s deadline: the Worker was terminated, not left looping.
  assert.ok(performance.now() - started < 5000)
  await rejects(runComparator(comparator(comparison), input, {}, AbortSignal.abort()), 'cancelled')
})

test('stops memory growth beyond the cap', async () => {
  const limit = /^comparator tried to grow its memory beyond the 1048576-byte limit$/u
  const grow = pages => [...op.i32Const(pages), ...op.memoryGrow, ...op.drop]
  // Growth that succeeds natively is detected afterward.
  await rejects(runComparator(comparator(comparison, {body: grow(100)}), input, {maxMemoryPages: 16}), 'memory-limit', limit)
  // Growth until failure, then a trap: the cap is still the reported cause.
  const bomb = [
    ...op.loop,
    ...op.i32Const(1),
    ...op.memoryGrow,
    ...op.i32Const(-1),
    ...op.i32Ne,
    ...op.brIf(0),
    ...op.end,
    ...op.unreachable,
  ]
  await rejects(
    runComparator(comparator(comparison, {body: bomb, memory: {min: 2, max: 64}}), input, {maxMemoryPages: 16}),
    'memory-limit',
    limit,
  )
  // A declared maximum within the cap is enforced natively; the failed grow is not a violation.
  assert.deepEqual(
    await runComparator(comparator(comparison, {body: grow(100), memory: {min: 2, max: 16}}), input, {maxMemoryPages: 16}),
    JSON.parse(comparison),
  )
  // Initial memory beyond the cap fails before running.
  await rejects(runComparator(comparator(comparison, {memory: {min: 100}}), input, {maxMemoryPages: 16}), 'memory-limit', limit)
  await assert.rejects(runComparator(comparator(comparison), input, {maxMemoryPages: 0}), RangeError)
})

test('surfaces comparator errors', async () => {
  await rejects(
    runComparator(comparator('{"error":"priority list is empty"}'), input),
    'comparator-error',
    /^comparator failed: priority list is empty$/u,
  )
  for (const output of ['{"error":42}', '{"error":"x","steps":[]}']) {
    await rejects(runComparator(comparator(output), input), 'invalid-output', /exactly/u)
  }
})

test('surfaces traps', async () => {
  await rejects(runComparator(comparator(comparison, {body: op.unreachable}), input), 'trap', /^comparator trapped: /u)
})

test('rejects oversize output and malformed return values', async () => {
  await rejects(
    runComparator(comparator(comparison, {packed: 0xffff_ffff}), input),
    'output-too-large',
    /^comparator output is 4294967295 bytes, exceeding the 33554432-byte limit$/u,
  )
  await rejects(runComparator(comparator(comparison), input, {maxOutputBytes: 10}), 'output-too-large')
  await rejects(
    runComparator(comparator(comparison, {packed: 0x0001_0000_0002_0000n}), input),
    'invalid-return',
    /projections_compare returned 131072 bytes at 65536, outside its 131072-byte memory/u,
  )
  const bytes = wasm({
    types: [
      [[i32], [i32]],
      [[i32, i32], [i64]],
    ],
    functions: [
      {type: 0, body: op.i32Const(-1)},
      {type: 1, body: op.i64Const(0)},
    ],
    memories: [{min: 1}],
    exports,
  })
  await rejects(runComparator(bytes, input), 'invalid-return', /projections_alloc\(\d+\) returned 4294967295/u)
})

test('rejects malformed output', async () => {
  for (const [output, message] of [
    [new Uint8Array([0xff, 0xfe]), /not UTF-8/u],
    ['{"protocolVersion":0,', /not valid JSON/u],
    ['[]', /must be a JSON object/u],
    ['', /not valid JSON/u],
    ['{"protocolVersion":1,"changes":[],"steps":[]}', /protocolVersion 0/u],
    ['{"protocolVersion":0,"changes":{},"steps":[]}', /\x60changes\x60 must be an array/u],
    ['{"protocolVersion":0,"changes":[]}', /\x60steps\x60 must be an array/u],
    ['{"protocolVersion":0,"changes":[],"steps":[],"colors":{}}', /unknown field \x60colors\x60/u],
    ['{"protocolVersion":0,"changes":[],"steps":[],"order":"mirror"}', /\x60order\x60 must be an object/u],
  ]) {
    await rejects(runComparator(comparator(output), input), 'invalid-output', message)
  }
})

test('rejects invalid input', async () => {
  const bytes = comparator(comparison)
  for (const [value, message] of [
    [[], /must be a JSON object/u],
    [{...input, options: undefined}, /\x60options\x60 must be an object/u],
    [{...input, protocolVersion: 1}, /protocolVersion 0/u],
    [{...input, x: 1}, /unknown field \x60x\x60/u],
    [{...input, options: {big: 1n}}, /not serializable/u],
  ]) {
    await rejects(runComparator(bytes, value), 'invalid-input', message)
  }
  await rejects(
    runComparator(bytes, input, {maxInputBytes: 8}),
    'input-too-large',
    /^comparator input is \d+ bytes, exceeding the 8-byte limit$/u,
  )
})

test('a cancelled check fails only its own caller: others keep their check, and a success is shared with later callers', async () => {
  const {cachedChecks} = await import('../dist/rules.js')
  const starts = []
  const check = cachedChecks(
    (rules, options) =>
      new Promise((resolve, reject) => {
        starts.push(options.signal)
        options.signal?.addEventListener('abort', () => reject(new ComparatorRuntimeError('cancelled', 'cancelled')))
        setTimeout(() => resolve({digest: 'sha256:d', canonical: '', warnings: []}), 50)
      }),
  )
  const rules = new TextEncoder().encode('rules: []')
  const controller = new AbortController()
  const mine = check(rules, {signal: controller.signal})
  const shared = check(rules)
  await new Promise(resolve => setTimeout(resolve, 10))
  controller.abort()
  await rejects(mine, 'cancelled')
  assert.equal((await shared).digest, 'sha256:d')
  // A settled success is shared, even with a caller that has a signal, without checking again.
  assert.equal((await check(rules, {signal: new AbortController().signal})).digest, 'sha256:d')
  assert.equal(starts.length, 2)
  // An already-aborted caller gets no result, cached or not.
  await rejects(check(rules, {signal: AbortSignal.abort()}), 'cancelled')
})

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
    /^comparator modules must have zero imports, but this module has 2: env\.clock, wasi_snapshot_preview1\.fd_write$/,
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
  const build = exports => wasm({types, functions, memories: [{min: 1}], exports})
  await rejects(
    runComparator(build(exports.slice(0, 2)), input),
    'missing-export',
    /^comparator module does not export `projections_compare`$/,
  )
  await rejects(runComparator(build(exports.slice(1)), input), 'missing-export', /`memory`/)
  await rejects(runComparator(build([exports[0], exports[2]]), input), 'missing-export', /`projections_alloc`/)
  await rejects(
    runComparator(build([exports[0], exports[1], {name: 'projections_compare', kind: 0, index: 2}]), input),
    'invalid-export',
    /^comparator export `projections_compare` must be a function \(i32, i32\) -> \(i64\), but is a function \(i32, i32\) -> \(i32\)$/,
  )
  await rejects(
    runComparator(build([{name: 'memory', kind: 0, index: 0}, exports[1], exports[2]]), input),
    'invalid-export',
    /`memory` must be a 32-bit linear memory, but is a function \(i32\) -> \(i32\)/,
  )
  await rejects(runComparator(new TextEncoder().encode('not wasm'), input), 'invalid-module')
  assert.deepEqual(inspectModule(comparator(comparison, {memory: {min: 2, max: 8}})), {minimumPages: 2, maximumPages: 8})
})

test('terminates comparators that run past the deadline', async () => {
  const started = performance.now()
  await rejects(
    runComparator(comparator(comparison, {body: forever}), input, {deadlineMs: 200}),
    'deadline',
    /^comparator exceeded its 200 ms deadline$/,
  )
  assert.ok(performance.now() - started < 5000)
  // Start functions run under the same deadline.
  const bytes = comparator(comparison, {extraFunctions: [{type: 2, body: forever}], start: 2})
  await rejects(runComparator(bytes, input, {deadlineMs: 200}), 'deadline')
})

test('stops memory growth beyond the cap', async () => {
  const limit = /^comparator tried to grow its memory beyond the 1048576-byte limit$/
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
    /^comparator failed: priority list is empty$/,
  )
  for (const output of ['{"error":42}', '{"error":"x","steps":[]}']) {
    await rejects(runComparator(comparator(output), input), 'invalid-output', /exactly/)
  }
})

test('surfaces traps', async () => {
  await rejects(runComparator(comparator(comparison, {body: op.unreachable}), input), 'trap', /^comparator trapped: /)
})

test('rejects oversize output and malformed return values', async () => {
  await rejects(
    runComparator(comparator(comparison, {packed: 0xffff_ffff}), input),
    'output-too-large',
    /^comparator output is 4294967295 bytes, exceeding the 33554432-byte limit$/,
  )
  await rejects(runComparator(comparator(comparison), input, {maxOutputBytes: 10}), 'output-too-large')
  await rejects(
    runComparator(comparator(comparison, {packed: 0x0001_0000_0002_0000n}), input),
    'invalid-return',
    /projections_compare returned 131072 bytes at 65536, outside its 131072-byte memory/,
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
  await rejects(runComparator(bytes, input), 'invalid-return', /projections_alloc\(\d+\) returned 4294967295/)
})

test('rejects malformed output', async () => {
  for (const [output, message] of [
    [new Uint8Array([0xff, 0xfe]), /not UTF-8/],
    ['{"protocolVersion":0,', /not valid JSON/],
    ['[]', /must be a JSON object/],
    ['', /not valid JSON/],
    ['{"protocolVersion":1,"changes":[],"steps":[]}', /protocolVersion 0/],
    ['{"protocolVersion":0,"changes":{},"steps":[]}', /`changes` must be an array/],
    ['{"protocolVersion":0,"changes":[]}', /`steps` must be an array/],
    ['{"protocolVersion":0,"changes":[],"steps":[],"colors":{}}', /unknown field `colors`/],
    ['{"protocolVersion":0,"changes":[],"steps":[],"order":"mirror"}', /`order` must be an object/],
  ]) {
    await rejects(runComparator(comparator(output), input), 'invalid-output', message)
  }
})

test('rejects invalid input', async () => {
  const bytes = comparator(comparison)
  for (const [value, message] of [
    [[], /must be a JSON object/],
    [{...input, options: undefined}, /`options` must be an object/],
    [{...input, protocolVersion: 1}, /protocolVersion 0/],
    [{...input, x: 1}, /unknown field `x`/],
    [{...input, options: {big: 1n}}, /not serializable/],
  ]) {
    await rejects(runComparator(bytes, value), 'invalid-input', message)
  }
  await rejects(
    runComparator(bytes, input, {maxInputBytes: 8}),
    'input-too-large',
    /^comparator input is \d+ bytes, exceeding the 8-byte limit$/,
  )
})

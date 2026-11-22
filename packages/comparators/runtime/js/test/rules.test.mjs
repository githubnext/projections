import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {ComparatorRuntimeError, RulesError, createRulesRuntime, isComparatorFile} from '../dist/node.js'
import {checkRulesInThreadForTests, runRulesInThreadForTests} from '../dist/testing.js'

const root = new URL('../../../../../', import.meta.url)
const read = async path => new Uint8Array(await readFile(new URL(path, root)))
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

test('names comparator files by their .comparator.yaml extension', () => {
  assert.equal(isComparatorFile('packages/comparators/api-compatibility/api-compatibility.comparator.yaml'), true)
  assert.equal(isComparatorFile('x.comparator.yml'), true)
  assert.equal(isComparatorFile('x.rules.yaml'), false)
  assert.equal(isComparatorFile('x.yaml'), false)
  assert.equal(isComparatorFile('comparator.js'), false)
})

test('checks a rules file once and identifies it by its canonical form', async () => {
  const runtime = createRulesRuntime()
  const rules = await read('examples/comparators/moved-components/moved-components.comparator.yaml')
  const checked = await runtime.check(rules)
  // The interpreter is identified by the source digest its build embeds, not by its bytes, which differ by build host.
  const module = new WebAssembly.Module(await readFile(new URL('../dist/rules.wasm', import.meta.url)))
  const [section] = WebAssembly.Module.customSections(module, 'projections.interpreter')
  const interpreter = new TextDecoder().decode(section)
  assert.match(interpreter, /^sha256:[0-9a-f]{64}$/u)
  assert.equal(checked.digest, sha256(`projections-rules-comparator\n${interpreter}\n${checked.canonical}`))
  assert.deepEqual(await checkRulesInThreadForTests(rules), checked)
  // Comments and layout are not part of a rules comparator's identity.
  const edited = new TextEncoder().encode(`# A comment\n${new TextDecoder().decode(rules)}\n\n`)
  assert.equal((await runtime.check(edited)).digest, checked.digest)
})

test('runs a rules file in a worker, with the same comparison as in-thread', async () => {
  const runtime = createRulesRuntime()
  const rules = await read('examples/comparators/moved-components/moved-components.comparator.yaml')
  const input = {
    protocolVersion: 0,
    before: await json('examples/comparators/moved-components/fixtures/before.json'),
    after: await json('examples/comparators/moved-components/fixtures/after.json'),
    baseline: {protocolVersion: 0, changes: [], steps: []},
    options: {},
  }
  const comparison = await runtime.compare(rules, input)
  assert.equal(comparison.protocolVersion, 0)
  assert.ok(comparison.changes.some(change => change.correspondence === 'declared' && /moved/u.test(change.summary)))
  assert.deepEqual(
    comparison.steps.map(step => step.kind),
    ['remove', 'restructure', 'add'],
  )
  assert.deepEqual(comparison, await runRulesInThreadForTests(rules, input))
})

test('returns lint warnings with a checked rules file', async () => {
  const runtime = createRulesRuntime()
  assert.deepEqual((await runtime.check(await read('examples/comparators/moved-components/moved-components.comparator.yaml'))).warnings, [])
  const rules = new TextEncoder().encode(
    "format: projections.comparator\nversion: 0\nmetadata:\n  values:\n    size: \"size(changes) == 0 ? 'none' : size(changes) == 1 ? 'one' : size(changes) == 2 ? 'two' : 'many'\"\n",
  )
  const {warnings} = await runtime.check(rules)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'chained-conditional')
  assert.equal(warnings[0].path, '/metadata/values/size')
  assert.match(warnings[0].message, /^Line 5, column \d+: A chain of 3 conditionals/u)
})

test('reports every rules problem with its YAML line and column', async () => {
  const runtime = createRulesRuntime()
  const rules = new TextEncoder().encode('format: projections.comparator\nversion: 0\nmetadata:\n  values:\n    count: size(chnages)\n')
  await assert.rejects(runtime.check(rules), error => {
    assert.ok(error instanceof RulesError, error)
    assert.equal(error.code, 'invalid-module')
    assert.ok(error.diagnostics.length >= 1)
    assert.match(error.message, /chnages/u)
    assert.match(error.message, /Line 5, column 17/u)
    return true
  })
})

test('stops rules at the deadline and rejects non-UTF-8 rules', async () => {
  const rules = await read('examples/comparators/moved-components/moved-components.comparator.yaml')
  await assert.rejects(createRulesRuntime().check(new Uint8Array([0xff, 0xfe])), error => {
    assert.ok(error instanceof ComparatorRuntimeError)
    assert.equal(error.code, 'invalid-module')
    return true
  })
  const before = await json('packages/renderers/file-packing/fixtures/opensource-before.json')
  const after = await json('packages/renderers/file-packing/fixtures/opensource-after.json')
  await assert.rejects(
    createRulesRuntime({deadlineMs: 1}).compare(rules, {protocolVersion: 0, before, after, baseline: {}, options: {}}),
    error => error instanceof ComparatorRuntimeError && error.code === 'deadline',
  )
})

test('the native runner (wasmi) checks and compares exactly as the Worker does', async () => {
  const {createNativeRulesRuntime} = await import('../dist/node.js')
  const native = createNativeRulesRuntime()
  const worker = createRulesRuntime()
  const rules = await read('examples/comparators/moved-components/moved-components.comparator.yaml')
  assert.deepEqual(await native.check(rules), await worker.check(rules))
  const input = {
    protocolVersion: 0,
    before: await json('examples/comparators/moved-components/fixtures/before.json'),
    after: await json('examples/comparators/moved-components/fixtures/after.json'),
    baseline: {},
    options: {},
  }
  assert.deepEqual(await native.compare(rules, input), await worker.compare(rules, input))
  await assert.rejects(native.check(new TextEncoder().encode('format: x\n')), error => {
    assert.ok(error instanceof ComparatorRuntimeError)
    assert.equal(error.code, 'invalid-module')
    assert.match(error.message, /Line 1, column 9/u)
    return true
  })
  await assert.rejects(
    createNativeRulesRuntime({deadlineMs: 1}).compare(rules, input),
    error => error instanceof ComparatorRuntimeError && error.code === 'deadline',
  )
})

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {test} from 'node:test'
import {createNativeEngine, EngineError} from '../dist/native.js'
import {createWasmEngine} from '../dist/browser.js'
import {comparatorCases, engineCases} from './vectors.mjs'

const wasmBytes = await readFile(new URL('../artifacts/engine.wasm', import.meta.url))
const comparatorBytes = await readFile(new URL('../artifacts/default-comparator.wasm', import.meta.url))
const engines = {
  native: createNativeEngine(),
  wasm: await createWasmEngine({module: wasmBytes}, {module: comparatorBytes}),
}
const corpus = JSON.parse(await readFile(new URL('../../../schemas/fixtures/conformance.json', import.meta.url), 'utf8'))
corpus.cases.push(...engineCases)
const state = (entities = [], relationships = [], schema = 'graph/v0') => ({protocolVersion: 0, schema, entities, relationships})
const node = id => ({id, kind: 'service', label: id})
const methods = {'parse-json': 'parseJson', 'validate-comparison': 'validateComparison'}
const argumentsOf = ({operation, extraction, before, after, comparison, json}) =>
  operation === 'decode' || operation === 'parse-json'
    ? [json]
    : operation === 'validate-comparison'
      ? [before, after, comparison]
      : operation === 'vary' || operation === 'pair'
        ? [before, after]
        : [extraction]

for (const [name, engine] of Object.entries(engines)) {
  for (const item of corpus.cases) {
    test(`${name}: shared corpus ${item.id}`, async () => {
      const method = methods[item.request.operation] ?? item.request.operation
      const args = argumentsOf(item.request)
      if (item.expectError) {
        await assert.rejects(engine[method](...args), error => {
          assert.ok(error instanceof EngineError)
          const code = typeof item.expectError === 'string' ? item.expectError : item.expectedErrorCode
          if (code) assert.equal(error.diagnostics[0].code, code)
          if (item.expectedErrorPath) assert.equal(error.diagnostics[0].path, item.expectedErrorPath)
          return true
        })
      } else {
        const result = await engine[method](...args)
        if (item.expectedCanonical) assert.equal(result.canonical, item.expectedCanonical)
        if (item.expectedResult) assert.deepEqual(result, item.expectedResult)
      }
    })
  }
  for (const item of corpus.comparisons) {
    test(`${name}: shared comparator corpus ${item.id}`, async () => {
      if (item.expectError) {
        await assert.rejects(
          engine.compare(item.before, item.after, item.options),
          error =>
            error instanceof EngineError && error.diagnostics[0].code === 'comparator-error' && error.message.includes(item.expectError),
        )
      } else {
        assert.deepEqual(await engine.compare(item.before, item.after, item.options), item.expected)
      }
    })
  }
  for (const item of comparatorCases) {
    test(`${name}: default comparator ${item.id}`, async () => {
      if (item.expectedErrorCode) {
        await assert.rejects(
          engine.compare(item.before, item.after, item.options),
          error =>
            error instanceof EngineError &&
            error.diagnostics[0].code === item.expectedErrorCode &&
            item.expectedMessage.test(error.message),
        )
      } else {
        assert.deepEqual((await engine.compare(item.before, item.after, item.options)).changes, item.expectedChanges)
      }
    })
  }
  test(`${name}: the default comparator identifies its module`, async () => {
    assert.deepEqual(await engine.defaultComparator(), {
      id: 'default',
      digest: `sha256:${createHash('sha256').update(comparatorBytes).digest('hex')}`,
    })
  })
  test(`${name}: deterministic semantic hash, no Unicode normalization, RFC8785 number formatting`, async () => {
    const data = Object.fromEntries([
      ['\ue000', 1],
      ['😀', -0],
      ['\r', 'control'],
      ['decimal', Number('333333333.33333329')],
      ['small', 1e-7],
      ['fixed', 1e-6],
      ['é', 'composed'],
      ['e\u0301', 'decomposed'],
    ])
    const before = state([{...node('\ue000'), data}, node('😀')])
    const canonical = await engine.canonicalize(before)
    assert.ok(canonical.canonical.indexOf('"id":"😀"') < canonical.canonical.indexOf('"id":"\ue000"'))
    assert.ok(canonical.canonical.includes('"😀":0,"\ue000":1'))
    assert.ok(canonical.canonical.includes('"decimal":333333333.3333333'))
    assert.ok(canonical.canonical.includes('"small":1e-7'))
    assert.ok(canonical.canonical.includes('"fixed":0.000001'))
    assert.equal(canonical.digest, createHash('sha256').update(canonical.canonical).digest('hex'))
    const reordered = structuredClone(before)
    reordered.entities.reverse()
    reordered.entities[1].data = Object.fromEntries(Object.entries(data).reverse())
    reordered.entities[1].previousIds = ['historic']
    reordered.entities[1].evidence = [{kind: 'source', source: 'src/thing.ts', location: {line: 1, column: 2}}]
    reordered.metadata = {time: 'different'}
    assert.deepEqual(await engine.canonicalize(reordered), canonical)
    const comparison = await engine.compare(before, reordered)
    assert.deepEqual(comparison.changes, [])
    assert.equal((await engine.normalize(reordered)).entities[1].evidence[0].source, 'src/thing.ts')
  })

  test(`${name}: renamed + modified relationships and reverse comparisons`, async () => {
    const before = state([node('a'), node('stable')], [{id: 'e', kind: 'uses', from: 'a', to: 'stable'}])
    const after = state(
      [{...node('b'), previousIds: ['a'], data: {size: 4}}, node('stable')],
      [{id: 'f', previousIds: ['e'], kind: 'uses', from: 'b', to: 'stable', data: {weight: 1}}],
    )
    for (const [left, right] of [
      [before, after],
      [after, before],
    ]) {
      const comparison = await engine.compare(left, right)
      assert.deepEqual(
        comparison.changes.map(change => [change.collection, change.before, change.after, change.status, change.correspondence]),
        [
          ['entities', [left.entities[0].id], [right.entities[0].id], 'modified', 'declared'],
          ['relationships', [left.relationships[0].id], [right.relationships[0].id], 'modified', 'declared'],
        ],
      )
      assert.deepEqual(comparison.steps, [{changes: comparison.changes.map(change => change.id), kind: 'restructure'}])
      assert.deepEqual(await engine.validateComparison(left, right, comparison), comparison)
    }
  })

  test(`${name}: JSON boundary never silently deletes/replaces values`, async () => {
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      9007199254740992,
      undefined,
      1n,
      () => {},
      Symbol('not-json'),
      '\ud800',
      new Date(),
      new Map(),
      {
        toJSON() {
          return {}
        },
      },
      {
        get value() {
          throw Error('do not invoke')
        },
      },
      Array(2),
      Object.assign([1], {extra: 1}),
    ]) {
      await assert.rejects(engine.normalize(state([{...node('a'), data: {value}}])), EngineError)
    }
    const cyclic = {}
    cyclic.self = cyclic
    await assert.rejects(engine.normalize(state([{...node('a'), data: cyclic}])), EngineError)
    const unsafe = await engine.decode(
      '{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"a","kind":"x","label":"A","data":{"n":9007199254740991}}],"relationships":[]}',
    )
    assert.equal(unsafe.entities[0].data.n, Number.MAX_SAFE_INTEGER)
    for (const value of [NaN, 9007199254740992, undefined, new Map()]) {
      await assert.rejects(engine.compare(state([{...node('a'), data: {value}}]), state()), EngineError)
    }
    assert.deepEqual(
      await engine.normalize(state([{...node('a'), data: {value: -0}}])),
      await engine.normalize(state([{...node('a'), data: {value: 0}}])),
    )
  })

  test(`${name}: strict entire artifact envelopes, generic JSON and scalar results`, async () => {
    const raw = '{"format":"projections.extraction","version":0,"provenance":{"revision":{"ref":"one"}},"extraction":{"entities":[]}}'
    assert.deepEqual(await engine.parseJson(raw), JSON.parse(raw))
    for (const raw of ['null', 'true', '1', '""', '[1,2,3]']) {
      assert.deepEqual(await engine.parseJson(raw), JSON.parse(raw))
    }
    for (const [raw, code, path] of [
      ['{"format":"projections.manifest","repository":{"id":9007199254740993}}', 'unsafe-integer', '/repository/id'],
      ['{"format":"one","format":"two"}', 'duplicate-key', '/format'],
      ['{"provenance":{"ref":"one","ref":"two"}}', 'duplicate-key', '/provenance/ref'],
      ['{"title":"\\ud800"}', 'invalid-json', '/title'],
      ['{"a":1} trailing', 'invalid-json', '/a'],
    ]) {
      await assert.rejects(engine.parseJson(raw), error => error.diagnostics[0].code === code && error.diagnostics[0].path === path)
    }
    for (const [levels, valid] of [
      [64, true],
      [65, false],
    ]) {
      const nested = '['.repeat(levels) + '0' + ']'.repeat(levels)
      if (valid) await engine.parseJson(nested)
      else await assert.rejects(engine.parseJson(nested), error => error.diagnostics[0].code === 'depth-limit')
    }
  })

  test(`${name}: depth boundary and diagnostic JSON Pointers`, async () => {
    for (const [levels, valid] of [
      [46, true],
      [47, false],
    ]) {
      let nested = 1
      for (let i = 0; i < levels; i++) nested = {nested}
      const input = state([{...node('a'), data: {nested}}])
      // root /entities/0/data is depth 3; data.nested is depth 4.
      if (valid) await engine.normalize(input)
      else await assert.rejects(engine.normalize(input), error => error.diagnostics[0].code === 'depth-limit')
    }
    await assert.rejects(
      engine.decode('{"x/y~z":{"a":1,"a":2}}'),
      error => error.diagnostics[0].code === 'duplicate-key' && error.diagnostics[0].path === '/x~1y~0z/a',
    )
    await assert.rejects(
      engine.normalize(state([], [{id: 'e', kind: 'uses', from: 'absent', to: 'absent'}])),
      error => error.diagnostics[0].path === '/extraction/relationships/0/from',
    )
    await assert.rejects(
      engine.compare(state(), state([], [], 'dag/v0')),
      error => error.diagnostics[0].code === 'comparator-error' && /schema-mismatch at \/after\/schema/.test(error.message),
    )
    await assert.rejects(
      engine.validateComparison(state(), state([], [], 'dag/v0'), {protocolVersion: 0, changes: [], steps: []}),
      error => error.diagnostics[0].code === 'schema-mismatch' && error.diagnostics[0].path === '/after/schema',
    )
  })

  test(`${name}: no label heuristics, independent edge identity, explicit ambiguity`, async () => {
    const before = state([{...node('a'), label: 'Same'}, node('stable')], [{id: 'one', kind: 'e', from: 'a', to: 'stable'}])
    const after = state([{...node('b'), label: 'Same'}, node('stable')], [{id: 'two', kind: 'e', from: 'b', to: 'stable'}])
    assert.deepEqual(
      (await engine.compare(before, after)).changes.map(change => `${change.status}:${change.id}`),
      ['removed:a', 'added:b', 'removed:one', 'added:two'],
    )
    const ambiguous = state([
      {...node('c'), previousIds: ['a', 'stable']},
      {...node('d'), previousIds: ['a']},
    ])
    for (const [left, right] of [
      [before, ambiguous],
      [ambiguous, before],
    ]) {
      await assert.rejects(
        engine.compare(left, right),
        error => error.diagnostics[0].code === 'comparator-error' && /ambiguous-correspondence/.test(error.message),
      )
    }
  })
}

test('native/Wasm parity on seeded reorderings and numeric encodings', async () => {
  let seed = 0x12345678
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let iteration = 0; iteration < 30; iteration++) {
    const entities = Array.from({length: 10}, (_, i) => ({
      ...node(`${String.fromCodePoint(i % 2 ? 0x1f600 : 0xe000)}-${i}`),
      data: {value: random() * 1e12, tiny: random() * 1e-20},
    }))
    const input = state(entities.sort(() => random() - 0.5))
    const native = await engines.native.canonicalize(input)
    const wasm = await engines.wasm.canonicalize(input)
    assert.deepEqual(native, wasm)
    const reference = value =>
      Array.isArray(value)
        ? value.map(reference)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map(key => [key, reference(value[key])]),
            )
          : value
    const expected = JSON.stringify(
      reference({
        ...input,
        entities: input.entities.map(entity => ({...entity, data: entity.data})).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      }),
    )
    assert.equal(native.canonical, expected)
  }
})

test('native and Wasm hosts run the same default comparator module', async () => {
  const before = state([node('root'), node('old')], [{id: 'r-old', kind: 'uses', from: 'root', to: 'old'}])
  const after = state(
    [node('root'), node('new'), {...node('billing'), previousIds: ['old']}],
    [{id: 'r-new', kind: 'uses', from: 'root', to: 'new'}],
  )
  for (const options of [{}, {order: {by: 'dependents'}}, {order: {by: 'data.size', direction: 'ascending'}}]) {
    assert.deepEqual(await engines.native.compare(before, after, options), await engines.wasm.compare(before, after, options))
  }
  assert.deepEqual(await engines.native.defaultComparator(), await engines.wasm.defaultComparator())
})

test('limit-sized comparisons stay within the comparator module memory bound', async () => {
  const {graph} = await import('../scripts/harness.mjs')
  const before = graph(10000, 50000)
  const after = structuredClone(before)
  for (const entity of after.entities) entity.id = entity.id.replace('node:', 'other:')
  for (const relationship of after.relationships) {
    relationship.id = relationship.id.replace('edge:', 'link:')
    relationship.from = relationship.from.replace('node:', 'other:')
    relationship.to = relationship.to.replace('node:', 'other:')
  }
  const comparison = await engines.native.compare(before, after)
  assert.equal(comparison.changes.length, 120000)
  assert.deepEqual(
    comparison.steps.map(step => step.kind),
    ['remove', 'add'],
  )
})

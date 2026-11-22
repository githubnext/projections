import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {basis, basisDigest, canonicalJson, extraction, generations} from '../src/extractor.ts'

// The same digests the Rust SDK's tests expect (packages/extractors/sdk/tests/generation.rs).
const cart = basis({input: 'class Cart {}', prompt: 'Summarize.', model: 'fake-summarizer@1'})
const CART_DIGEST = 'sha256:02c585f6060308c569e5b1258bb4fa5198e1dc491f9424f3687c5d58b2a8d8d9'

test('a basis hashes its parts and keeps the model verbatim', () => {
  assert.deepEqual(cart, {
    input: 'sha256:b6a57a5700a3228e12314dc29a611932d30a15d9a470859b7fa27d071bb07c8d',
    prompt: 'sha256:af639d92c6b7997ae8f55fee998ce444d8077f9bface7147a210656046b058ab',
    model: 'fake-summarizer@1',
  })
  assert.equal(basisDigest(cart), CART_DIGEST)
  // Key order doesn't matter; non-strings hash as canonical JSON.
  assert.equal(basisDigest({model: cart.model, prompt: cart.prompt, input: cart.input}), CART_DIGEST)
  assert.equal(basis({context: {files: ['a', 'b']}}).context, 'sha256:91ebe95a33b44a953051c279ae1082f32291926c51001f2d3d8db846ef56ba97')
  assert.deepEqual(basis({model: 'm@2'}, {verbatim: []}), {
    model: 'sha256:3af2c7166bce4d6b5bda3829309bfb57442fe71514c2305ea005b8e9d141a379',
  })
})

test('a basis checks its limits', () => {
  assert.throws(() => basis({}), RangeError)
  assert.throws(() => basis(Object.fromEntries(Array.from({length: 17}, (_, n) => [`p${n}`, 'x']))), RangeError)
  assert.throws(() => basis({'9lives': 'x'}), RangeError)
  assert.throws(() => basis({model: 'x'.repeat(257)}), RangeError)
  assert.throws(() => basis({model: 1}), RangeError)
})

test('canonical JSON is RFC 8785', () => {
  assert.equal(
    canonicalJson({b: [1, 2.5, -0, 'é\u2028'], a: null, é: true, z: {y: 1e21}}),
    '{"a":null,"b":[1,2.5,0,"é\u2028"],"z":{"y":1e+21},"é":true}',
  )
})

test('generations reuse a stored value by declared path and basis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projections-generations-'))
  try {
    const file = join(directory, 'generations.jsonl')
    await writeFile(
      file,
      [
        JSON.stringify({path: '/data/summary', basis: CART_DIGEST, value: 'Holds a cart.'}),
        'not json',
        JSON.stringify({path: '/data/title', basis: CART_DIGEST, value: {short: 'Cart'}}),
        '',
      ].join('\n'),
    )
    const store = await generations({generations: {file}})
    assert.equal(store.size, 2)
    assert.equal(store.get('/data/summary', cart), 'Holds a cart.')
    assert.deepEqual(store.get('/data/title', cart), {short: 'Cart'})
    // Another path with the same basis is another value.
    assert.equal(store.get('/data/other', cart), undefined)
    let calls = 0
    const produce = () => {
      calls += 1
      return 'Fresh.'
    }
    assert.equal(await store.generate('/data/summary', cart, produce), 'Holds a cart.')
    assert.equal(await store.generate('/data/summary', basis({input: 'class Bag {}'}), produce), 'Fresh.')
    assert.equal(calls, 1)
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('without a snapshot, or with an unreadable one, every value is generated', async () => {
  for (const request of [{}, {generations: {file: join(tmpdir(), 'projections-missing-generations.jsonl')}}]) {
    const store = await generations(request)
    assert.equal(store.size, 0)
    assert.equal(await store.generate('/data/summary', cart, () => Promise.resolve('New.')), 'New.')
  }
})

test('an extraction fills in the protocol and sorts its items by ID, as the Engine does', () => {
  const document = extraction({
    entities: {'team:b': {kind: 'team', label: 'B'}, 'team:a': {id: 'team:a', kind: 'team', label: 'A'}},
    relationships: new Map([['owns', {kind: 'owns', from: 'team:a', to: 'team:b'}]]),
    metadata: {authority: 'declared'},
  })
  assert.deepEqual(document, {
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: [
      {id: 'team:a', kind: 'team', label: 'A'},
      {id: 'team:b', kind: 'team', label: 'B'},
    ],
    relationships: [{id: 'owns', kind: 'owns', from: 'team:a', to: 'team:b'}],
    metadata: {authority: 'declared'},
  })
  // U+FF5E sorts after U+1F600 by code point, before it by UTF-16 code unit.
  const ids = ['\u{1F600}', '\uFF5E', 'a']
  const sorted = extraction({schema: 'architecture/v0', entities: ids.map(id => ({id, kind: 'k', label: id}))})
  assert.equal(sorted.schema, 'architecture/v0')
  assert.deepEqual(
    sorted.entities.map(entity => entity.id),
    ['a', '\u{1F600}', '\uFF5E'],
  )
})

test('an extraction explains what is wrong with its items', () => {
  const entity = {id: 'a', kind: 'k', label: 'A'}
  const cases: [() => unknown, RegExp][] = [
    [() => extraction({entities: 'a' as never}), /array of objects/u],
    [() => extraction({entities: [['a']] as never}), /entities\[0\] is an array, not an object/u],
    [() => extraction({entities: [{kind: 'k'}] as never}), /entities\[0\] has no id/u],
    [() => extraction({entities: {a: {id: 'b', kind: 'k', label: 'A'}}}), /has the id "b"/u],
    [() => extraction({entities: [{id: 'a', kind: 'k'}] as never}), /entity "a" needs label/u],
    [() => extraction({relationships: [{id: 'r', kind: 'k', from: 'a'}] as never}), /relationship "r" needs to/u],
    [() => extraction({entities: [entity], relationships: [{...entity, from: 'a', to: 'a'}]}), /Two items/u],
    [() => extraction({schema: 'graph' as never}), /domain schema/u],
    [() => extraction({colour: 'red'} as never), /no field "colour"/u],
  ]
  for (const [call, message] of cases) assert.throws(call, message)
})

// A module specifier: a file URL, which a Windows path (D:\...) is not.
const sdk = new URL('../src/extractor.ts', import.meta.url).href
const run = (script: string) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', `import {result} from ${JSON.stringify(sdk)}\n${script}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

test('result writes one extraction to stdout, once', () => {
  const written = run(`result({entities: [{id: 'a', kind: 'k', label: 'é', data: {n: 1}}]})`)
  assert.deepEqual(JSON.parse(written), {
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: [{id: 'a', kind: 'k', label: 'é', data: {n: 1}}],
    relationships: [],
  })
  assert.throws(() => run(`result(); result()`), /call it once/u)
})

test('result names the item whose value JSON cannot hold', () => {
  for (const value of ['Number.NaN', '1n']) {
    assert.throws(
      () => run(`result({entities: [{id: 'a', kind: 'k', label: 'A'}, {id: 'b', kind: 'k', label: 'B', data: {v: ${value}}}]})`),
      (error: {stdout: string; stderr: string}) =>
        error.stderr.includes(`The item "b" holds a value JSON can't represent`) && error.stdout === '',
    )
  }
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel, extractionModel, stepEmphasis} from '@githubnext/projections-renderer-kit'
import {compatibilityOf} from '../node_modules/.cache/test/compatibility.js'
import {
  changesFirst,
  comparisonRows,
  limitEntries,
  limitScope,
  qualifiedNames,
  readableId,
  revisionRows,
} from '../node_modules/.cache/test/model.js'
import {signatureLayout, signatureSegments, signatureTokens} from '../node_modules/.cache/test/signature.js'
import {ApiView} from '../node_modules/.cache/test/view.js'
import {plain} from '../../kit/test/markup.mjs'

const engine = createNativeEngine()
const api = entities => ({protocolVersion: 0, schema: 'api/v0', entities, relationships: []})
const declaration = (id, signature, kind = 'function') => ({id, kind, label: id, data: {signature}})

const before = api([
  declaration('greet', 'greet(): string'),
  declaration('parse', 'parse(text: string): Node'),
  declaration('legacy', 'legacy(): void'),
  declaration('stable', 'stable(): void'),
])
const after = api([
  declaration('greet', 'greet(name: string): string'),
  declaration('parse', 'tokenize(input: Buffer): Token[]'),
  declaration('added', 'added(): void'),
  declaration('stable', 'stable(): void'),
])
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

async function comparison(a = before, b = after) {
  return comparisonModel(a, b, await engine.compare(a, b))
}

const props = (model, {comparing = true, diff = false, progress = 1, highlighting = 1} = {}) => ({
  init: {},
  model,
  comparing,
  diff,
  comparisonMode: diff ? 'diff' : comparing ? 'side-by-side' : undefined,
  progress,
  highlighting,
  direction: 1,
  schedule: [],
  rendererName: 'api',
  selectedId: null,
  hoveredId: null,
  emphasis: stepEmphasis([], progress, comparing ? highlighting : 0),
  onSelect() {},
  onOpen() {},
  reportSteps() {},
  controls: {},
  declareControls() {},
  onAction: () => () => {},
  options: {},
  viewport: undefined,
  reducedMotion: false,
  locale: 'en',
})
const render = p => renderToStaticMarkup(createElement(ApiView, p))
/** Each row's markup, by data-entity-id. */
const footer = '<div class="pk-change-footer api-declaration-footer" data-change-footer=""></div>'
/** A row's footer status text: the word per part (icons carry no text), empty for an unchanged row. */
const statusOf = body =>
  plain(/<div class="pk-change-footer api-declaration-footer" data-change-footer="">(.*?)<\/div>/.exec(body)?.[1] ?? '')
const rowsOf = markup =>
  Object.fromEntries(
    [...markup.matchAll(/<section [^>]*data-entity-id="([^"]+)"[^>]*>(.*?)<\/section>/g)].map(([, id, body]) => [id, body]),
  )

test('segments merge two signatures, removals before the additions that replace them', () => {
  assert.deepEqual(signatureSegments('hello(): string', 'hello(name: string): string'), [
    {text: 'hello(', kind: 'same'},
    {text: 'name: string', kind: 'added'},
    {text: '): string', kind: 'same'},
  ])
  assert.deepEqual(signatureSegments('f(a: A): void', 'f(b: A): void'), [
    {text: 'f(', kind: 'same'},
    {text: 'a', kind: 'removed'},
    {text: 'b', kind: 'added'},
    {text: ': A): void', kind: 'same'},
  ])
  const segments = signatureSegments('f(a: A): void', 'f(b: A): void')
  assert.deepEqual(
    signatureTokens(segments, 'before')
      .map(token => token.text)
      .join(''),
    'f(a: A): void',
  )
  assert.deepEqual(
    signatureTokens(segments, 'after').filter(token => token.changed),
    [{text: 'b', changed: true}],
  )
  const huge = signatureSegments('a '.repeat(1000), 'b '.repeat(1000))
  assert.deepEqual(huge, [
    {text: 'a '.repeat(1000), kind: 'removed'},
    {text: 'b '.repeat(1000), kind: 'added'},
  ])
})

test('a mostly surviving signature reads inline; a rewritten one splits into removed and added lines', () => {
  assert.equal(signatureLayout(signatureSegments('class Client', 'class Client implements AsyncDisposable')), 'inline')
  assert.equal(
    signatureLayout(signatureSegments('parse(source: string): Document', 'parse(source: string, options?: Options): Document')),
    'inline',
  )
  assert.equal(signatureLayout(signatureSegments('parse(text: string): Node', 'tokenize(input: Buffer): Token[]')), 'split')
  assert.equal(signatureLayout(signatureSegments('a '.repeat(1000), 'b '.repeat(1000))), 'split')
})

test('rows: each revision in its own ID order, and the diff lists every declaration once', async () => {
  const model = await comparison()
  const ids = rows => rows.map(row => row.id)
  assert.deepEqual(
    revisionRows(model, 'before').map(row => row.before.id),
    [...before.entities.map(e => e.id)].sort(),
  )
  assert.deepEqual(
    revisionRows(model, 'after').map(row => row.after.id),
    [...after.entities.map(e => e.id)].sort(),
  )
  assert.deepEqual(ids(comparisonRows(model)), ['added', 'greet', 'legacy', 'parse', 'stable'])
})

test('the diff renders every change with its status footer and signature diff, and unchanged rows plain', async () => {
  const model = await comparison()
  const rows = rowsOf(render(props(model, {diff: true})))
  assert.deepEqual(Object.keys(rows).sort(), ['added', 'greet', 'legacy', 'parse', 'stable'])
  assert.equal(statusOf(rows.added), 'Added')
  assert.match(
    rows.added,
    /class="api-signature added" data-projections-identifier=""><span class="api-line-mark" aria-hidden="true">\+<\/span>added\(\): void/,
  )
  assert.equal(statusOf(rows.legacy), 'Removed')
  assert.match(
    rows.legacy,
    /class="api-signature removed" data-projections-identifier=""><span class="api-line-mark" aria-hidden="true">−<\/span>legacy\(\): void/,
  )
  assert.equal(statusOf(rows.greet), 'Modified')
  assert.match(
    rows.greet,
    /<pre class="api-signature" data-projections-identifier=""><span>greet\(<\/span><ins>name: string<\/ins><span>\): string<\/span><\/pre>/,
  )
  assert.match(rows.greet, /Signature changed from “greet\(\): string” to “greet\(name: string\): string”/)
  // A rewritten signature splits into a removed line above an added one.
  assert.match(
    rows.parse,
    /class="api-signature removed" data-projections-identifier="">.*>parse\(text: string\): Node<\/pre><pre class="api-signature added" data-projections-identifier="">.*>tokenize\(input: Buffer\): Token\[\]<\/pre>/,
  )
  assert.ok(!rows.stable.includes('pk-status') && !rows.stable.includes('<del') && !rows.stable.includes('<ins'))
  // The unchanged row still reserves its footer, so every row has the same rhythm.
  assert.ok(rows.stable.endsWith(footer))
  assert.match(rows.stable, /<pre class="api-signature" data-projections-identifier="">stable\(\): void<\/pre>/)
})

test('a renamed declaration shows its previous label and its renamed signature', async () => {
  const model = await comparison(fixture('http-client-v1'), fixture('http-client-v2'))
  const rows = rowsOf(render(props(model, {diff: true})))
  assert.ok(!('fetchJson' in rows))
  assert.equal(statusOf(rows.getJson), 'RenamedModified')
  assert.match(
    rows.getJson,
    /Previously <\/span><span data-projections-identifier="" class="pk-identifier pk-truncate" title="fetchJson"><del>fetchJson<\/del><\/span>/,
  )
  assert.match(rows.getJson, /<del>fetchJson<\/del><ins>getJson<\/ins>/)
  // Side-by-side, the before pane names it as the before revision did, under its row ID.
  assert.match(rowsOf(render(props(model, {progress: 0, highlighting: 0}))).getJson, />fetchJson<\/button>/)
})

test('names, IDs and signatures are marked as code identifiers; status sits in the row footer, not beside the name', async () => {
  const model = await comparison(fixture('http-client-v1'), fixture('http-client-v2'))
  const rows = rowsOf(render(props(model, {diff: true})))
  assert.match(
    rows.getJson,
    /<span class="api-declaration-head">.*<button [^>]*class="entity-link pk-truncate" data-projections-identifier="" title="getJson"[^>]*>getJson<\/button><\/span>/,
  )
  assert.match(
    rows.getJson,
    /<div class="pk-change-footer api-declaration-footer" data-change-footer=""><span class="pk-status-text"[^>]*><span class="pk-status-part renamed"/,
  )
  assert.doesNotMatch(rows.getJson, /class="pk-status[^"]*" data-projections-identifier/)
  assert.match(
    rows['ClientOptions.retries'],
    /data-projections-identifier="" title="ClientOptions.retries"[^>]*>ClientOptions.retries<\/button>/,
  )
  for (const body of Object.values(rows)) {
    for (const pre of body.match(/<pre [^>]*>/g)) assert.match(pre, /data-projections-identifier=""/)
  }
  const nested = render(props(await comparison(member('headers'), member('header')), {diff: true}))
  assert.match(nested, /<code class="semantic-id" data-projections-identifier="">/)
})

function member(name) {
  return {
    protocolVersion: 0,
    schema: 'api/v0',
    entities: [
      {...declaration('ts-api:(root):.:Response', 'interface Response', 'interface'), label: 'Response'},
      {...declaration(`ts-api%3A(root)%3A.%3AResponse:instance:${name}`, `"${name}": string`, 'member'), label: name},
    ],
    relationships: [
      {id: `contains:${name}`, kind: 'contains', from: 'ts-api:(root):.:Response', to: `ts-api%3A(root)%3A.%3AResponse:instance:${name}`},
    ],
  }
}

test('a nested declaration is named as code spells it, not by its encoded ID', async () => {
  const model = await comparison(member('headers'), member('headers'))
  const html = render(props(model, {diff: true}))
  assert.match(html, /<code class="semantic-id"[^>]*>Response\.headers<\/code>/)
  assert.doesNotMatch(plain(html), /%3A/)
  // A top-level declaration's name is its label, so no second line repeats it.
  assert.equal(html.match(/class="semantic-id"/g).length, 1)
})

test('qualified names fall back to the decoded ID where two declarations would share one', () => {
  const names = qualifiedNames(
    api([
      {...declaration('ts-api:(root):.:use', 'use(): void'), label: 'use'},
      {...declaration('ts-api:(root):.%2Fvanilla:use', 'use(): void'), label: 'use'},
    ]),
  )
  assert.deepEqual([...names.values()], ['ts-api:(root):.:use', 'ts-api:(root):./vanilla:use'])
  assert.equal(readableId('a%3Ab%3A%253Ac'), 'a:b::c')
})

test('an unchanged row in the diff is drawn exactly as an unchanged comparison draws it', async () => {
  const same = await comparison(after, after)
  const model = await comparison()
  assert.equal(rowsOf(render(props(model, {diff: true}))).stable, rowsOf(render(props(same, {diff: true}))).stable)
})

test('without highlighting the diff keeps its content and footers and drops only the emphasis and status words', async () => {
  const model = await comparison()
  const on = render(props(model, {diff: true}))
  const off = render(props(model, {diff: true, highlighting: 0}))
  assert.match(on, /data-highlighting="on"/)
  assert.doesNotMatch(off, /pk-status-text/)
  assert.equal(
    off,
    on
      .replace('data-highlighting="on"', 'data-highlighting="off"')
      .replace(/<span class="pk-status-text".*?<\/span><\/span><\/div>/g, '</div>'),
  )
})

test('side-by-side panes list each revision; with highlighting each marks its side of the changes', async () => {
  const model = await comparison()
  const alone = extraction => render(props(extractionModel(extraction), {comparing: false, highlighting: 0}))
  const pane = (progress, highlighting) => render(props(model, {progress, highlighting}))
  // Without highlighting, each pane is its revision alone (selection IDs aside), its rows reserving empty footers.
  assert.equal(pane(0, 0).replaceAll(footer, ''), alone(before))
  assert.equal(pane(1, 0).replaceAll(footer, ''), alone(after))
  assert.equal(pane(0, 0).split(footer).length - 1, before.entities.length)
  const start = rowsOf(pane(0, 1)),
    end = rowsOf(pane(1, 1))
  assert.ok(!('added' in start) && !('legacy' in end))
  assert.equal(statusOf(start.legacy), 'Removed')
  assert.equal(statusOf(end.added), 'Added')
  assert.match(start.legacy, /class="api-signature removed"/)
  assert.match(end.added, /class="api-signature added"/)
  assert.match(start.greet, /class="api-signature removed" data-projections-identifier="">.*<span>greet\(<\/span><span>\): string<\/span>/)
  assert.match(end.greet, /class="api-signature added" data-projections-identifier="">.*<mark>name: string<\/mark>/)
  assert.ok(!start.parse.includes('<mark'), 'a rewrite is not marked run by run')
  assert.ok(!start.stable.includes('pk-status') && !end.stable.includes('<mark'))
})

test('text is never inserted as HTML', async () => {
  const hostile = api([declaration('x', 'x(): <script>a</script>')])
  const changed = api([declaration('x', 'x(y: number): <script>b</script>')])
  const markup = render(props(await comparison(hostile, changed), {diff: true}))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(!markup.includes('<script>'))
})

test('more than 500 declarations show a notice', () => {
  const many = api(Array.from({length: 520}, (_, index) => declaration(`d${String(index).padStart(3, '0')}`, `d${index}(): void`)))
  const markup = render(props(extractionModel(many), {comparing: false, highlighting: 0}))
  assert.match(markup, /Showing 500 of 520 declarations/)
  assert.equal(markup.match(/data-entity-id=/g).length, 500)
})

/** The default comparison classified as the api-compatibility comparator would. */
const compatibility = {
  version: 0,
  ecosystem: 'typescript',
  rules: 'Test rules',
  counts: {breaking: 2, additive: 2, compatible: 0, unknown: 0},
  changes: {
    legacy: {level: 'breaking', reason: '`legacy` was removed', findings: []},
    parse: {level: 'breaking', kinds: ['binary', 'source'], reason: 'Parameter `text` no longer accepts `string`', findings: []},
    added: {level: 'additive', reason: '`added` was added', findings: []},
    greet: {level: 'additive', reason: 'Optional parameter `name` was added', findings: []},
  },
  notices: ['One revision lacks `data.contract`.'],
}
async function classified(options = {}, metadata = {compatibility}) {
  const model = await comparison()
  return {...props(model, options), init: {mode: 'comparison', comparison: {metadata}}}
}
const compatibilityOfRow = body => plain(/<span class="api-compatibility [a-z]+"[^>]*>(.*?)<\/span><\/div>/.exec(body)?.[1] ?? '')

test('a classified diff keeps its notices, lists breaking changes first and states each level with its reason', async () => {
  const markup = render(await classified({diff: true}))
  // The host's summary bar counts the levels (see summary.test.mjs); the view draws no summary line of its own.
  assert.doesNotMatch(markup, /api-compatibility-counts|2 breaking|Test rules/)
  assert.match(
    markup,
    /^<div class="api-view pk-stage"[^>]*><div class="api-panel" data-projections-content=""><div class="api-compatibility-notices" data-projections-content="">/,
  )
  const rows = rowsOf(markup)
  assert.deepEqual(Object.keys(rows), ['legacy', 'parse', 'added', 'greet', 'stable'])
  assert.equal(compatibilityOfRow(rows.legacy), 'Breaking')
  // Titles and assistive text take plain text: the code markers are dropped.
  assert.match(rows.legacy, /data-compatibility="breaking"[^>]*title="legacy was removed"/)
  // The rules name and notices are prose with inline code too.
  assert.match(
    markup,
    /<p class="api-compatibility-notice">One revision lacks <code class="pk-code" data-projections-identifier="">data.contract<\/code>.<\/p>/,
  )
  assert.ok(!markup.includes('`'), 'no code marker is ever shown')
  assert.equal(compatibilityOfRow(rows.added), 'Additive')
  assert.match(
    rows.parse,
    /<p class="api-compatibility-reason" data-compatibility="breaking" style="visibility:visible;opacity:1" aria-hidden="false">Binary and source: Parameter <code class="pk-code" data-projections-identifier="">text<\/code> no longer accepts <code class="pk-code" data-projections-identifier="">string<\/code><\/p>/,
  )
  // Change status keeps its own fixed cell before the compatibility.
  assert.match(
    rows.legacy,
    /<div class="pk-change-footer api-declaration-footer" data-change-footer=""><span class="pk-status-text api-change-status"/,
  )
  assert.ok(!rows.stable.includes('api-compatibility'))
  // An unchanged row's footer is exactly the kit's empty footer.
  assert.ok(rows.stable.endsWith(footer))
})

test('without highlighting a classified diff keeps every reserved line and drops the levels', async () => {
  const off = rowsOf(render(await classified({diff: true, highlighting: 0})))
  assert.equal(compatibilityOfRow(off.legacy), '')
  assert.match(
    off.legacy,
    /<p class="api-compatibility-reason" data-compatibility="breaking" style="visibility:hidden;opacity:0" aria-hidden="true">/,
  )
})

test('breaking only lists the breaking changes, in both modes', async () => {
  const options = {diff: true, controls: {breakingOnly: true}}
  const diff = rowsOf(render({...(await classified({diff: true})), controls: {breakingOnly: true}}))
  assert.deepEqual(Object.keys(diff), ['legacy', 'parse'])
  const pane = rowsOf(render({...(await classified({progress: 0})), controls: {breakingOnly: true}}))
  assert.deepEqual(Object.keys(pane), ['legacy', 'parse'])
  const none = render({
    ...(await classified({diff: true}, {compatibility: {...compatibility, changes: {added: compatibility.changes.added}}})),
    controls: options.controls,
  })
  assert.match(none, /No breaking changes/)
})

test('side by side, the level reads its reason to assistive technology instead of a reason line', async () => {
  const rows = rowsOf(render(await classified({progress: 0})))
  assert.match(rows.legacy, /data-icon="breaking" aria-hidden="true"><\/span>Breaking<span class="sr-only">: legacy was removed<\/span>/)
  assert.ok(!rows.legacy.includes('api-compatibility-reason'))
  // At the endpoint without highlighting, nothing is stated.
  assert.ok(!rowsOf(render(await classified({progress: 0, highlighting: 0}))).legacy.includes('api-compatibility '))
})

test('a classification that is missing or malformed is ignored', () => {
  assert.equal(compatibilityOf(undefined), undefined)
  assert.equal(compatibilityOf({compatibility: {version: 1, changes: {}}}), undefined)
  const parsed = compatibilityOf({
    compatibility: {version: 0, changes: {a: {level: 'fatal', reason: 'x'}, b: {level: 'breaking', reason: 'y', kinds: [1, 'source']}}},
  })
  assert.deepEqual([...parsed.changes], [['b', {level: 'breaking', kinds: ['source'], reason: 'y'}]])
  assert.equal(parsed.counts.breaking, 1)
})

test('a diff with more rows than fit lists its changes first, each group in its order', () => {
  const rows = [
    {id: 'a', status: 'unchanged'},
    {id: 'b', status: 'modified'},
    {id: 'c', status: 'unchanged'},
    {id: 'd', status: 'added'},
  ]
  assert.deepEqual(
    changesFirst(rows, 3).map(row => row.id),
    ['b', 'd', 'a', 'c'],
  )
  assert.deepEqual(
    changesFirst(rows, 4).map(row => row.id),
    ['a', 'b', 'c', 'd'],
  )
})

test('under the Changes scope the limit counts the declarations drawn, changes before their context', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map(id => ({id}))
  const scope = {changes: new Set(['d', 'e']), context: new Set(['a', 'c']), shown: new Set(['a', 'c', 'd', 'e'])}
  assert.equal(limitScope(scope, rows, 4), scope)
  const limited = limitScope(scope, rows, 3)
  assert.deepEqual([...limited.shown].sort(), ['a', 'd', 'e'])
  assert.deepEqual([...limited.changes].sort(), ['d', 'e'])
  assert.deepEqual([...limited.context], ['a'])
})

test('the declaration limit counts what is drawn: declarations outside folds and an opened run, never more', () => {
  const item = id => ({type: 'item', item: id})
  const entries = [item('a'), {type: 'fold', key: 'b', items: ['b', 'c', 'd'], open: true}, item('b'), item('c'), item('d'), item('e')]
  const limited = limitEntries(entries, 3)
  assert.deepEqual(
    limited.entries.map(entry => (entry.type === 'item' ? entry.item : `fold ${entry.key}`)),
    ['a', 'fold b', 'b', 'c'],
  )
  assert.equal(limited.drawn, 3)
  assert.equal(limited.total, 5)
  assert.equal(limitEntries(entries, 10).entries.length, entries.length)
})

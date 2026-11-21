import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {
  cardHeight,
  cardWidthRange,
  changeMark,
  comparisonModel,
  createGraphTransition,
  diffCardText,
  diffModel,
  extractionModel,
  fieldChanges,
  fieldLines,
  formatValue,
  pluralKind,
  wrapText,
  sameValue,
} from '../dist/index.js'
import {ChangePills, SvgValueChange, ValueChange} from '../dist/react.js'
import {compare, entity, extraction, relationship} from './engine.mjs'
import {plain} from './markup.mjs'

const noop = () => undefined

const html = node => renderToStaticMarkup(node)

async function rewired() {
  const before = extraction(
    'graph/v0',
    [entity('a', 'service'), entity('b', 'service', {data: {port: 80, tags: ['x']}}), entity('c', 'service'), entity('old', 'cache')],
    [relationship('a->b', 'a', 'b', 'calls'), relationship('a->old', 'a', 'old', 'calls'), relationship('link', 'b', 'c', 'calls')],
  )
  const after = extraction(
    'graph/v0',
    [entity('a', 'service'), entity('b', 'service', {data: {port: 8080, tags: ['x']}}), entity('c', 'service'), entity('new', 'cache')],
    [relationship('a->b', 'a', 'b', 'calls'), relationship('a->new', 'a', 'new', 'calls'), relationship('link', 'c', 'b', 'calls')],
  )
  return comparisonModel(before, after, await compare(before, after))
}

test('the union holds every entity of both revisions, each with its change and what differs', async () => {
  const model = await rewired()
  const diff = diffModel(model)
  const byId = Object.fromEntries(diff.entities.map(item => [item.id, item]))
  assert.deepEqual(diff.entities.map(item => [item.id, item.change]).sort(), [
    ['a', 'unchanged'],
    ['b', 'modified'],
    ['c', 'unchanged'],
    ['new', 'added'],
    ['old', 'removed'],
  ])
  assert.equal(byId.old.entity, byId.old.before, 'a removed entity is drawn as it was')
  assert.equal(byId.b.entity, byId.b.after, 'a survivor is drawn as it is now')
  assert.deepEqual(byId.b.fields, [{key: 'port', before: 80, after: 8080}], 'only fields that differ, structurally compared')
  assert.deepEqual(diff.counts.entities, {added: 1, removed: 1, modified: 1, renamed: 0, unchanged: 2})
  assert.equal(diff.entity('b'), byId.b)
})

test('a rewired relationship is drawn twice: its old part removed, its new part added', async () => {
  const diff = diffModel(await rewired())
  const parts = diff.relationships.map(part => [part.key, part.change, part.side, `${part.from}->${part.to}`])
  assert.deepEqual(
    parts.filter(([key]) => key.startsWith('link')),
    [
      ['link:before', 'removed', 'before', 'b->c'],
      ['link:after', 'added', 'after', 'c->b'],
    ],
  )
  assert.deepEqual(
    parts.find(([key]) => key === 'a->b'),
    ['a->b', 'unchanged', 'both', 'a->b'],
  )
  assert.ok(parts.some(([key, change]) => key === 'a->old' && change === 'removed'))
  assert.ok(parts.some(([key, change]) => key === 'a->new' && change === 'added'))
})

test('an extraction is a union of one revision: everything unchanged', () => {
  const single = extraction('graph/v0', [entity('a'), entity('b')], [relationship('a->b', 'a', 'b')])
  const diff = diffModel(extractionModel(single))
  assert.ok(diff.entities.every(item => item.change === 'unchanged' && item.fields.length === 0))
  assert.deepEqual(
    diff.relationships.map(part => [part.key, part.side]),
    [['a->b', 'both']],
  )
})

test('field changes compare values structurally and show them verbatim', () => {
  assert.ok(sameValue({a: 1, b: [1, {c: 2}]}, {b: [1, {c: 2}], a: 1}))
  assert.ok(!sameValue([1, 2], [2, 1]))
  assert.ok(!sameValue(null, undefined))
  const before = {id: 'r', kind: 'resource', label: 'db', data: {action: 'update', values: {ttl: 60, name: 'x', tags: {a: 1}}}}
  const after = {id: 'r', kind: 'resource', label: 'database', data: {action: 'replace', values: {ttl: 60, name: 'y', extra: true}}}
  assert.deepEqual(
    fieldChanges(before, after).map(change => change.key),
    ['label', 'action', 'values'],
  )
  assert.deepEqual(fieldChanges(before, after, {fields: ['action']}), [{key: 'action', before: 'update', after: 'replace'}])
  assert.deepEqual(fieldLines({id: 'r', status: 'modified', before, after}, {object: 'values'}), [
    {key: 'extra', before: 'null', after: 'true'},
    {key: 'name', before: 'x', after: 'y'},
    {key: 'tags', before: '{"a":1}', after: 'null'},
  ])
  assert.deepEqual(fieldLines({id: 'r', status: 'modified', before, after}, {exclude: ['values']}), [
    {key: 'action', before: 'update', after: 'replace'},
  ])
  assert.deepEqual(fieldLines({id: 'r', status: 'added', after}), [], 'an added entity has no field changes')
  assert.equal(formatValue('(known after apply)'), '(known after apply)')
  assert.equal(formatValue(undefined), 'null')
})

test('a change mark is data-change with the change, and nothing for an unchanged item', () => {
  assert.deepEqual(changeMark('added'), {'data-change': 'added'})
  assert.deepEqual(changeMark({status: 'unchanged', renamed: true}), {'data-change': 'renamed'})
  assert.deepEqual(changeMark({status: 'modified', renamed: true}), {'data-change': 'modified'})
  assert.deepEqual(changeMark('unchanged'), {})
})

test('kinds are pluralized as English forms them', () => {
  assert.deepEqual(['service', 'class', 'dependency', 'key', 'box'].map(pluralKind), [
    'services',
    'classes',
    'dependencies',
    'keys',
    'boxes',
  ])
})

test('a value change is the old value struck through in a removed pill, then the new one in an added pill', () => {
  const markup = html(createElement(ValueChange, {before: 'enforce', after: 'monitor'}))
  assert.match(markup, /data-layout="stacked"/)
  assert.match(markup, /<del class="pk-change-pill" data-change="removed"><span class="sr-only">was <\/span>enforce<\/del>/)
  assert.match(markup, /<ins class="pk-change-pill" data-change="added"><span class="sr-only">, now <\/span>monitor<\/ins>/)
  const inline = html(createElement(ValueChange, {before: 'a', after: 'b', layout: 'inline'}))
  assert.match(inline, /<span class="pk-value-arrow" aria-hidden="true">→<\/span>/)
  assert.equal(plain(html(createElement(ValueChange, {after: 'only'}))), 'now only')
})

test('change pills carry their sign, their change in words and, when selectable, their entity', () => {
  const markup = html(
    createElement(ChangePills, {
      label: 'Dependencies',
      items: [
        {key: 'a', label: 'ILogger', change: 'unchanged'},
        {key: 'b', label: 'IClock', change: 'added', entityId: 'service:IClock'},
        {key: 'c', label: 'ICache', change: 'removed'},
      ],
      onSelect: noop,
      selectedId: 'service:IClock',
    }),
  )
  assert.match(markup, /^<ul class="pk-change-pills" aria-label="Dependencies">/)
  assert.equal(plain(markup), 'ILogger+Added: IClock−Removed: ICache')
  assert.match(
    markup,
    /<button type="button" class="pk-change-pill pk-part selected" data-entity-id="service:IClock" aria-pressed="true" data-change="added">/,
  )
  assert.match(markup, /<span class="pk-change-pill" data-change="removed"><span class="pk-pill-sign" aria-hidden="true">−<\/span>/)
  assert.match(markup, /<span class="pk-change-pill"><span class="pk-pill-label">ILogger<\/span><\/span>/, 'unchanged pills are plain')
})

test('an SVG value change strikes the old value and arrows to the new one', () => {
  const markup = html(
    createElement('svg', null, createElement(SvgValueChange, {before: '4.21.2', after: '5.1.0', x: 84, y: 0, anchor: 'end'})),
  )
  assert.match(markup, /text-anchor="end"/)
  assert.match(
    markup,
    /<tspan class="pk-svg-was">4.21.2<\/tspan><tspan class="pk-svg-arrow"> → <\/tspan><tspan class="pk-svg-now">5.1.0<\/tspan>/,
  )
})

test('the graph diff frame is the union layout: every card at full presence, rewired routes twice, nothing overlapping', async () => {
  const model = await rewired()
  const transition = await createGraphTransition(model, [])
  const frame = transition.diff
  assert.deepEqual(frame.nodes.map(node => node.id).sort(), ['a', 'b', 'c', 'new', 'old'])
  assert.ok(frame.nodes.every(node => node.opacity === 1 && node.local === 1))
  const keys = frame.edges.map(edge => [edge.key, edge.part ?? 'both'])
  assert.deepEqual(
    keys.filter(([key]) => key.startsWith('link')),
    [
      ['link:before', 'before'],
      ['link:after', 'after'],
    ],
  )
  assert.ok(frame.edges.every(edge => edge.points.length > 1))
  const boxes = frame.nodes.map(node => ({
    id: node.id,
    left: node.x - node.width / 2,
    right: node.x + node.width / 2,
    top: node.y - node.height / 2,
    bottom: node.y + node.height / 2,
  }))
  for (const a of boxes) {
    for (const b of boxes) {
      if (a.id < b.id) {
        assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.id} overlaps ${b.id}`)
      }
    }
  }
  // Diff only: one layout, with cards grown for their field changes, and the same frame at any progress.
  const grown = await createGraphTransition(model, [], {diffOnly: {heights: new Map([['b', 124]])}})
  assert.equal(grown.layouts.length, 1)
  assert.equal(grown(0), grown.diff)
  const b = grown.diff.nodes.find(node => node.id === 'b')
  const a = grown.diff.nodes.find(node => node.id === 'a')
  assert.equal(b.height, 124)
  assert.equal(a.height, cardHeight('service'))
  // Deterministic: the same documents lay out the same union.
  const again = await createGraphTransition(model, [])
  assert.deepEqual(
    again.diff.nodes.map(node => [node.id, node.x, node.y]),
    frame.nodes.map(node => [node.id, node.x, node.y]),
  )
})

test('every graph scenario has a readable union: no two cards overlap in its diff frame', async () => {
  const directory = new URL('../../graph/', import.meta.url)
  const {scenarios} = JSON.parse(await readFile(new URL('scenarios.json', directory), 'utf8'))
  const load = async value => (typeof value === 'string' ? JSON.parse(await readFile(new URL(value, directory), 'utf8')) : value)
  const options = {architecture: {compound: true}, infrastructure: {compound: ['module', 'resource-group', 'resource']}}
  for (const scenario of scenarios) {
    if (!scenario.before || scenario.comparator || scenario.renderer === 'dependencies') continue
    const before = await load(scenario.before),
      after = await load(scenario.after)
    const model = comparisonModel(before, after, await compare(before, after))
    const {diff} = await createGraphTransition(model, [], {...options[scenario.renderer], diffOnly: {}})
    assert.equal(diff.nodes.length, model.entities.length, scenario.id)
    const cards = diff.nodes.filter(node => !node.group)
    for (const a of cards) {
      for (const b of cards) {
        if (a.id < b.id) {
          assert.ok(
            Math.abs(a.x - b.x) * 2 >= a.width + b.width - 0.5 || Math.abs(a.y - b.y) * 2 >= a.height + b.height - 0.5,
            `${scenario.id}: ${a.id} overlaps ${b.id}`,
          )
        }
      }
    }
  }
})

test('long data wraps after its separators and is never cut off', () => {
  assert.deepEqual(wrapText('aws_cloudwatch_metric_alarm', 22), ['aws_cloudwatch_metric_', 'alarm'])
  assert.deepEqual(wrapText('(known after apply)', 22), ['(known after apply)'])
  assert.deepEqual(wrapText('["shop-prod.c9x1.us-east-1.rds.amazonaws.com"]', 22), [
    '["shop-prod.c9x1.us-',
    'east-1.rds.amazonaws.',
    'com"]',
  ])
  assert.deepEqual(wrapText('abcdefghijklmnop', 6), ['abcdef', 'ghijkl', 'mnop'])
  for (const text of ['a_b.c/d-e,f:g h', 'x'.repeat(50), 'module.database.aws_db_instance.main']) {
    assert.equal(wrapText(text, 7).join(''), text, 'joining the lines gives the text back')
  }
})

test('a diff card lays out its text whole and grows to hold it', () => {
  const text = card => card.lines.map(line => line.spans.map(span => span.text).join('')).join('|')
  const plain = diffCardText({after: {id: 'a', kind: 'service', label: 'api'}, kind: {text: 'Service'}})
  assert.equal(text(plain), 'Service|api')
  assert.equal(plain.height, cardHeight('service'), "a short card keeps its kind's own height")
  assert.equal(plain.width, cardWidthRange.min, 'and the narrowest width')
  // A card is as wide as its longest line needs, its status footer included.
  const status = [{status: 'modified', glyph: '~', icon: 'modified', label: 'Update in place'}]
  const named = diffCardText({after: {id: 'a', kind: 'service', label: 'payments-gateway'}, kind: {text: 'Service'}, status})
  assert.equal(named.width, Math.ceil((32 + 16 * 7.4) / 4) * 4)
  assert.ok(diffCardText({...{after: {id: 'a', kind: 'service', label: 'a'}}, kind: {text: 'Service'}, status}).width > cardWidthRange.min)
  const before = {id: 'r', kind: 'resource', label: 'db', data: {version: '1.0.0'}}
  const after = {id: 'r', kind: 'resource', label: 'database', data: {version: '2.0.0'}}
  const card = diffCardText({
    before,
    after,
    kind: {text: 'aws_cloudwatch_metric_alarm', identifier: true},
    detail: entity => entity.data.version,
    fields: [
      {key: 'records', before: '["shop-prod.c9x1.us-east-1.rds.amazonaws.com"]', after: '(known after apply)'},
      {key: 'ttl', before: '60', after: '300'},
      {key: 'a', before: '1', after: '2'},
      {key: 'b', before: '1', after: '2'},
    ],
  })
  const all = text(card)
  assert.ok(!all.includes('…'), all)
  for (const whole of [
    'aws_cloudwatch_metric_alarm',
    '["shop-prod.c9x1.us-east-1.rds.amazonaws.com"]',
    '(known after apply)',
    '1.0.0',
    '2.0.0',
  ]) {
    assert.ok(all.replaceAll('|', '').includes(whole), whole)
  }
  assert.ok(all.includes('db|database'), 'the old name, then the new one')
  assert.ok(all.endsWith('and 1 more change'))
  // Every line is below the one before, and the card holds the last one above its footer.
  const ys = card.lines.filter(line => line.anchor !== 'end').map(line => line.y)
  assert.deepEqual(
    ys,
    [...ys].sort((a, b) => a - b),
  )
  assert.ok(card.height >= Math.max(...ys) + 18)
  // Long text wraps at the widest card, never past it.
  assert.equal(card.width, cardWidthRange.max)
  const room = Math.floor((card.width - 32) / 7.4)
  assert.ok(card.lines.every(line => line.spans.map(span => span.text).join('').length <= room))
  assert.deepEqual(
    diffCardText({before, after, detail: entity => entity.data.version}),
    diffCardText({before, after, detail: entity => entity.data.version}),
  )
})

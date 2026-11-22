import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {generatedForm, rowDetails, subjectRows, subjectVariation, useProjection} from '../dist/index.js'
import {GeneratedList, RegeneratedToggle} from '../dist/ui/index.js'

const volatile = [
  {collection: 'entities', kinds: ['class'], path: '/data/summary', generated: true, basis: '/data/summaryBasis'},
  {collection: 'entities', kinds: ['test'], path: '/data/durationMs'},
]
const extraction = entities => ({protocolVersion: 0, schema: 'graph/v0', volatile, entities, relationships: []})
const cls = (id, summary, input, model = 'm@1') => ({
  id,
  kind: 'class',
  label: id,
  data: {summary, summaryBasis: {input, model}, size: 1},
})
const before = extraction([
  cls('cart', 'Holds a cart.', 'sha256:a'),
  cls('orders', 'Places orders.', 'sha256:b'),
  {id: 'parse', kind: 'test', label: 'parse', data: {durationMs: 100}},
])
const after = extraction([
  cls('cart', 'Keeps a cart.', 'sha256:a'),
  cls('orders', 'Places orders and confirms them.', 'sha256:b2', 'm@2'),
  {id: 'parse', kind: 'test', label: 'parse', data: {durationMs: 120}},
])
const change = (id, status, varied) => ({id, collection: 'entities', before: [id], after: [id], status, correspondence: 'exact', varied})
const comparison = {
  protocolVersion: 0,
  changes: [
    change('cart', 'unchanged', [{path: '/data/summary', within: true, generated: true}]),
    change('orders', 'modified', [{path: '/data/summary', within: false, generated: true, because: ['input', 'model']}]),
    change('parse', 'unchanged', [{path: '/data/durationMs', within: true}]),
  ],
  steps: [{changes: ['orders']}],
  variation: {within: 2, beyond: 1},
}
const subject = {mode: 'comparison', before, after, comparison}
const rows = subjectRows(subject)
const row = id => rows.find(candidate => candidate.id === id)

test('regenerated items are counted apart from other variation', () => {
  assert.deepEqual(subjectVariation(subject, rows), {within: 1, beyond: 0, regenerated: 1})
})

test('the detail card lists generated values first, and leaves them and their bases out of fields and varied', () => {
  const cart = rowDetails(subject, row('cart'), rows)
  assert.deepEqual(
    cart.generated.map(field => [field.name, field.before, field.after]),
    [['summary', 'Holds a cart.', 'Keeps a cart.']],
  )
  assert.deepEqual(cart.varied, [])
  assert.deepEqual(generatedForm(cart.generated[0]), {
    form: 'regenerated',
    before: 'Holds a cart.',
    after: 'Keeps a cart.',
    json: false,
    words: 'Regenerated from the same inputs',
    same: false,
  })
  const orders = rowDetails(subject, row('orders'), rows)
  assert.deepEqual(
    orders.fields.map(field => field.key),
    [],
  )
  const form = generatedForm(orders.generated[0])
  assert.equal(form.form, 'changed')
  assert.equal(form.words, 'Regenerated because the input and the model (`m@1` → `m@2`) changed')
  assert.ok(form.runs?.some(run => run.op === 'added' && run.text.includes('confirms')))
  // One extraction: the value, plainly.
  const single = {mode: 'extraction', extraction: after}
  const one = rowDetails(
    single,
    subjectRows(single).find(item => item.id === 'cart'),
    subjectRows(single),
  )
  assert.equal(generatedForm(one.generated[0]).form, 'plain')
  assert.ok(!one.fields.some(field => field.key === 'data:summary' || field.key === 'data:summaryBasis'))
})

test('generated values render with the Generated mark, and the regenerated toggle filters to them', () => {
  const markup = renderToStaticMarkup(createElement(GeneratedList, {generated: rowDetails(subject, row('orders'), rows).generated}))
  assert.match(markup, /data-generated-mark=""/u)
  assert.match(markup, /Regenerated because the input and the model/u)
  assert.match(markup, /aria-pressed="false"[^>]*>Word diff/u)
  let controller
  function Probe(props) {
    controller = useProjection({subject, projection: {id: 'classes', title: 'Classes'}, ...props})
    return createElement(RegeneratedToggle, {projection: controller})
  }
  const toggle = renderToStaticMarkup(createElement(Probe, {initialRegeneratedOnly: true}))
  assert.match(toggle, /data-regenerated="1"/u)
  assert.match(toggle, />1 regenerated</u)
  assert.deepEqual(
    controller.visibleRows.map(item => item.id),
    ['cart'],
  )
  renderToStaticMarkup(createElement(Probe, {initialVariedOnly: true}))
  assert.deepEqual(
    controller.visibleRows.map(item => item.id),
    ['parse'],
  )
})

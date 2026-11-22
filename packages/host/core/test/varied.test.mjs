import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {rowDetails, subjectRows, subjectVariation, useProjection, variedText} from '../dist/index.js'
import {TextView, VariedList, VariedToggle} from '../dist/ui/index.js'

const noop = () => undefined

const volatile = [{kinds: ['test'], path: '/data/durationMs', tolerance: {absolute: 50, relative: 0.2}}]
const extraction = entities => ({protocolVersion: 0, schema: 'graph/v0', volatile, entities, relationships: []})
const testItem = (id, durationMs, status = 'passed') => ({id, kind: 'test', label: id, data: {durationMs, status}})
const before = extraction([testItem('parse', 100), testItem('load', 100), testItem('save', 100), testItem('lex', 50)])
const after = extraction([testItem('parse', 130), testItem('load', 400), testItem('save', 110, 'failed'), testItem('lex', 50)])
const change = (id, status, varied) => ({id, collection: 'entities', before: [id], after: [id], status, correspondence: 'exact', varied})
const comparison = {
  protocolVersion: 0,
  changes: [
    change('load', 'modified', [{path: '/data/durationMs', within: false}]),
    change('parse', 'unchanged', [{path: '/data/durationMs', within: true}]),
    change('save', 'modified', [{path: '/data/durationMs', within: true}]),
  ],
  steps: [{kind: 'restructure', changes: ['load', 'save']}],
  variation: {within: 1, beyond: 1},
}
const subject = {mode: 'comparison', before, after, comparison}
const rows = subjectRows(subject)
const row = id => rows.find(candidate => candidate.id === id)

test('rows carry the change’s varied values, and the variation is counted', () => {
  assert.deepEqual(row('parse').varied, [{path: '/data/durationMs', within: true}])
  assert.equal(row('parse').status, 'unchanged')
  assert.equal(row('parse').step, undefined)
  assert.equal(row('lex').varied, undefined)
  assert.deepEqual(subjectVariation(subject, rows), {within: 1, beyond: 1, regenerated: 0})
  // Counted from the rows, whatever the comparison says.
  const {variation: _variation, ...undeclared} = comparison
  assert.deepEqual(subjectVariation({...subject, comparison: undeclared}, rows), {within: 1, beyond: 1, regenerated: 0})
  // Nothing varied: no count.
  const plain = {...subject, comparison: {protocolVersion: 0, changes: [], steps: []}}
  assert.equal(subjectVariation(plain, subjectRows({...plain, before: after})), undefined)
  assert.equal(subjectVariation({mode: 'extraction', extraction: after}, []), undefined)
})

test('details list each varied path with its values and tolerance, and leave it out of the changed fields', () => {
  const within = rowDetails(subject, row('parse'), rows)
  assert.deepEqual(within.varied, [
    {path: '/data/durationMs', name: 'durationMs', before: '100', after: '130', within: true, words: 'within tolerance'},
  ])
  assert.deepEqual(within.fields, [])
  assert.deepEqual(within.parts, [])
  assert.equal(variedText(within.varied[0]), 'durationMs 100 → 130 · within tolerance')

  const beyond = rowDetails(subject, row('load'), rows)
  assert.equal(variedText(beyond.varied[0]), 'durationMs 100 → 400 · beyond tolerance (volatile)')
  assert.deepEqual(beyond.fields, [])

  const save = rowDetails(subject, row('save'), rows)
  assert.deepEqual(
    save.fields.map(field => field.key),
    ['data:status'],
  )
  assert.equal(save.varied[0].within, true)

  const reasonedSubject = {
    ...subject,
    comparison: {
      ...comparison,
      changes: [change('load', 'modified', [{path: '/data/durationMs', within: false, reason: 'No spread was available.'}])],
    },
  }
  const reasonedRows = subjectRows(reasonedSubject)
  const reasoned = rowDetails(
    reasonedSubject,
    reasonedRows.find(item => item.id === 'load'),
    reasonedRows,
  )
  assert.equal(variedText(reasoned.varied[0]), 'durationMs 100 → 400 · beyond tolerance (volatile) · No spread was available.')
})

test('the details’ varied list is neutral: paths and values in the monospace font, no change colors', () => {
  const details = rowDetails(subject, row('load'), rows)
  const markup = renderToStaticMarkup(
    createElement(VariedList, {varied: [...rowDetails(subject, row('parse'), rows).varied, ...details.varied]}),
  )
  assert.match(markup, /aria-label="Volatile values"/u)
  assert.match(markup, /<code class="ph-field-name[^"]*pj:font-mono[^"]*">durationMs<\/code>/u)
  assert.match(markup, /class="ph-varied-values[^"]*pj:font-mono/u)
  assert.match(markup, /within tolerance/u)
  assert.match(markup, /beyond tolerance \(volatile\)/u)
  assert.doesNotMatch(markup, /data-change=|text-added|text-removed|text-modified|bg-added|bg-removed|bg-modified/u)
  assert.equal(renderToStaticMarkup(createElement(VariedList, {varied: []})), '')
})

/** Renders `useProjection` once and reports what the hook decided. */
function probe(options) {
  let controller
  function Probe() {
    controller = useProjection({subject, projection: {id: 'tests', title: 'Tests'}, ...options})
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return controller
}

test('"varied only" shows exactly the items that varied within tolerance, and excludes "changes only"', () => {
  const all = probe({initialChangesOnly: false})
  assert.deepEqual(all.variation, {within: 1, beyond: 1, regenerated: 0})
  assert.equal(all.variedOnly, false)
  assert.equal(all.visibleRows.length, rows.length)

  const varied = probe({initialVariedOnly: true})
  assert.equal(varied.variedOnly, true)
  assert.deepEqual(
    varied.visibleRows.map(item => item.id),
    ['parse'],
  )

  const both = probe({initialVariedOnly: true, initialChangesOnly: true})
  assert.equal(both.changesOnly, false)
  assert.deepEqual(
    both.visibleRows.map(item => item.id),
    ['parse'],
  )

  const changes = probe({initialChangesOnly: true})
  assert.deepEqual(changes.visibleRows.map(item => item.id).toSorted(), ['load', 'save'])
})

test('turning one filter on turns the other off', () => {
  const requests = []
  const record = name => value => requests.push([name, value])
  const varied = probe({changesOnly: true, onChangesOnlyChange: record('changesOnly'), onVariedOnlyChange: record('variedOnly')})
  varied.setVariedOnly(true)
  assert.deepEqual(requests, [
    ['variedOnly', true],
    ['changesOnly', false],
  ])
  requests.length = 0
  const changes = probe({
    changesOnly: false,
    variedOnly: true,
    onChangesOnlyChange: record('changesOnly'),
    onVariedOnlyChange: record('variedOnly'),
  })
  changes.setChangesOnly(true)
  assert.deepEqual(requests, [
    ['variedOnly', false],
    ['changesOnly', true],
  ])
})

test('the toolbar count shows "N varied within tolerance" as a toggle, and nothing when none varied', () => {
  const controller = {comparing: true, variation: {within: 3, beyond: 1}, variedOnly: false, setVariedOnly: noop}
  const markup = renderToStaticMarkup(createElement(VariedToggle, {projection: controller}))
  assert.match(markup, /<span>3 varied within tolerance<\/span>/u)
  assert.match(markup, /aria-pressed="false"/u)
  assert.match(markup, /pj:text-muted-foreground/u)
  assert.doesNotMatch(markup, /added|removed|modified/u)
  assert.match(renderToStaticMarkup(createElement(VariedToggle, {projection: {...controller, variedOnly: true}})), /aria-pressed="true"/u)
  for (const variation of [undefined, {within: 0, beyond: 2}]) {
    assert.equal(renderToStaticMarkup(createElement(VariedToggle, {projection: {...controller, variation}})), '')
  }
  assert.equal(renderToStaticMarkup(createElement(VariedToggle, {projection: {...controller, comparing: false}})), '')
})

test('the text view says how many unchanged items varied within tolerance', () => {
  const markup = renderToStaticMarkup(createElement(TextView, {subject, rows, selectedId: null, onSelect: noop, progress: 1}))
  assert.match(markup, /2 changes in 1 step: 0 added, 0 removed, 2 modified\. 2 items are unchanged, 1 of them varied within tolerance\./u)
})

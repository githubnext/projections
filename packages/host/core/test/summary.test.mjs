import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {
  figuresSentence,
  fitSummary,
  rowInSummary,
  sameSummaryFilter,
  subjectRows,
  summaryFigures,
  summaryFilterable,
  summaryFilterOf,
  useProjection,
} from '../dist/index.js'
import {SummaryBar} from '../dist/ui/index.js'

const entity = (id, kind) => ({id, kind, label: id})
const relationship = (id, kind, from, to) => ({id, kind, from, to})
const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const change = (id, status, collection, before, after) => ({id, status, collection, correspondence: 'exact', before, after})
const before = extraction(
  [entity('a', 'workspace'), entity('old', 'workspace'), entity('lib', 'external-package')],
  [relationship('a-lib', 'depends-on', 'a', 'lib')],
)
const after = extraction(
  [entity('a', 'workspace'), entity('new', 'workspace'), entity('lib', 'external-package')],
  [relationship('a-lib', 'depends-on', 'a', 'lib'), relationship('new-lib', 'devDependencies', 'new', 'lib')],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    change('c-old', 'removed', 'entities', ['old'], []),
    change('c-new', 'added', 'entities', [], ['new']),
    change('c-edge', 'added', 'relationships', [], ['new-lib']),
    change('c-lib', 'modified', 'entities', ['lib'], ['lib']),
  ],
  steps: [{changes: ['c-old', 'c-new', 'c-edge', 'c-lib']}],
}
const subject = {mode: 'comparison', before, after, comparison}
const words = figures => figures.map(figure => [figure.noun.plural, figure.count, figure.added, figure.removed, figure.modified])

test('without a renderer summary, the bar words every kind from its name and counts it', () => {
  assert.deepEqual(words(summaryFigures(subject)), [
    ['workspaces', 2, 1, 1, 0],
    ['external packages', 1, 0, 0, 1],
    ['dependencies', 1, 0, 0, 0],
    ['dev dependencies', 1, 1, 0, 0],
  ])
  assert.equal(
    figuresSentence(summaryFigures(subject), true, 'en-US'),
    '2 workspaces +1 \u22121 · 1 external package ~1 · 1 dependency · 1 dev dependency +1',
  )
  assert.equal(
    figuresSentence(summaryFigures({mode: 'extraction', extraction: before}), false, 'en-US'),
    '2 workspaces · 1 external package · 1 dependency',
  )
})

test('a renderer summary gives the words and order; the host keeps its own counts and merges kinds named alike', () => {
  const noun = (singular, plural) => ({singular, plural})
  const figures = summaryFigures(subject, [
    {kind: 'depends-on', noun: noun('dependency', 'dependencies'), count: 999},
    {kind: 'devDependencies', noun: noun('dependency', 'dependencies'), count: 0},
    {kind: 'workspace', noun: noun('member', 'members'), count: 1},
    {kind: 'missing', noun: noun('ghost', 'ghosts'), count: 3},
  ])
  assert.deepEqual(words(figures), [
    ['dependencies', 2, 1, 0, 0],
    ['members', 2, 1, 1, 0],
  ])
  assert.deepEqual(figures[0].kinds, [{kind: 'depends-on'}, {kind: 'devDependencies'}])
})

test('a figure filters to its items, or to one change status of them', () => {
  const rows = subjectRows(subject)
  const [workspaces] = summaryFigures(subject)
  const ids = filter =>
    rows
      .filter(row => rowInSummary(row, filter))
      .map(row => row.id)
      .sort()
  assert.deepEqual(ids(summaryFilterOf(workspaces)), ['a', 'c-new', 'c-old'])
  assert.deepEqual(ids(summaryFilterOf(workspaces, 'added')), ['c-new'])
  assert.deepEqual(ids(summaryFilterOf(workspaces, 'removed')), ['c-old'])
  assert.ok(
    sameSummaryFilter(summaryFilterOf(workspaces, 'added'), {kinds: [{kind: 'workspace', collection: 'entities'}], status: 'added'}),
  )
  assert.ok(!sameSummaryFilter(summaryFilterOf(workspaces), summaryFilterOf(workspaces, 'added')))
  assert.ok(sameSummaryFilter(null, null))
})

test('figures that do not fit collapse from the end, beside the overflow button', () => {
  assert.equal(fitSummary([100, 80, 60], 300, 20), 3)
  assert.equal(fitSummary([100, 80, 60], 239, 20), 2)
  assert.equal(fitSummary([100, 80, 60], 150, 20), 1)
  assert.equal(fitSummary([100, 80, 60], 50, 20), 0)
})

function probe(options) {
  let controller
  function Probe() {
    controller = useProjection({subject, projection: {id: 'p', title: 'P'}, ...options})
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return controller
}

test('the controller filters by a figure, within the scope rather than instead of it', () => {
  const all = probe({initialChangesOnly: false})
  const [workspaces] = all.summary
  const filtered = probe({initialChangesOnly: false, initialSummaryFilter: summaryFilterOf(workspaces, 'added')})
  assert.deepEqual(
    filtered.visibleRows.map(row => row.id),
    ['c-new'],
  )
  assert.deepEqual(filtered.stage.filter.ids, ['c-new'])
  // The Changes scope stays: the figure narrows it to its changes and their context.
  const scoped = probe({initialSummaryFilter: summaryFilterOf(workspaces)})
  assert.equal(scoped.scope, 'changes')
  assert.ok(scoped.visibleRows.every(row => row.status !== 'unchanged' || row.collection === 'entities'))
  const requests = []
  const record = name => value => requests.push([name, value])
  const controlled = probe({
    changesOnly: true,
    variedOnly: false,
    summaryFilter: null,
    onChangesOnlyChange: record('changesOnly'),
    onVariedOnlyChange: record('variedOnly'),
    onSummaryFilterChange: record('summaryFilter'),
  })
  controlled.setSummaryFilter(summaryFilterOf(workspaces))
  assert.deepEqual(requests, [['summaryFilter', summaryFilterOf(workspaces)]])
  requests.length = 0
  probe({
    changesOnly: false,
    summaryFilter: summaryFilterOf(workspaces),
    onChangesOnlyChange: record('changesOnly'),
    onSummaryFilterChange: record('summaryFilter'),
  }).setChangesOnly(true)
  assert.deepEqual(requests, [['changesOnly', true]])
})

test('the Default UI bar draws each figure with its changes as filter toggles', () => {
  const controller = probe({})
  const html = renderToStaticMarkup(createElement(SummaryBar, {projection: controller}))
  assert.match(html, /aria-label="Summary"/u)
  assert.match(html, /data-sentence="2 workspaces \+1 \u22121 · 1 external package ~1 · 1 dependency · 1 dev dependency \+1"/u)
  assert.match(html, /data-summary-delta="added"[^>]*><span class="ph-cap">\+1</u)
  assert.match(html, /aria-label="1 workspace removed"/u)
})

test('a renderer fact is a figure of its own: its count as sent, its icon and tone, and a filter by the items it names', () => {
  const noun = {singular: 'new workspace', plural: 'new workspaces'}
  const figures = summaryFigures(subject, [
    {type: 'count', kind: 'workspace', noun: {singular: 'workspace', plural: 'workspaces'}, count: 2},
    {type: 'fact', id: 'fresh', icon: 'added', count: 1, noun, tone: 'added', ids: ['new']},
    {type: 'fact', id: 'note', count: 3, noun: {singular: 'note', plural: 'notes'}},
  ])
  assert.deepEqual(
    figures.map(figure => [figure.type, figure.key, figure.count]),
    [
      ['count', 'workspaces', 2],
      ['fact', 'fact:fresh', 1],
      ['fact', 'fact:note', 3],
    ],
  )
  const [, fresh, note] = figures
  assert.equal(summaryFilterable(fresh), true)
  assert.equal(summaryFilterable(note), false)
  // The fact names item IDs; the row presenting `new` is the change `c-new`.
  const rows = subjectRows(subject)
  assert.deepEqual(
    rows.filter(row => rowInSummary(row, summaryFilterOf(fresh))).map(row => row.id),
    ['c-new'],
  )
  assert.equal(figuresSentence(figures, true, 'en-US'), '2 workspaces +1 \u22121 · 1 new workspace · 3 notes')
  const controller = probe({})
  const html = renderToStaticMarkup(createElement(SummaryBar, {projection: {...controller, summary: figures}}))
  assert.match(
    html,
    /data-summary-fact=""[\s\S]*?<button[^>]*data-tone="added"[^>]*>.*?data-icon="added".*?1 new workspace<\/span><\/button>/u,
  )
  assert.match(html, /data-summary-key="fact:note"[\s\S]*?<span[^>]*data-summary-total="3"[^>]*><span class="ph-cap">3 notes<\/span>/u)
})

test('a fact carries its changes and a description: the bar draws the changes as a count does, without filters', () => {
  const figures = summaryFigures(subject, [
    {type: 'fact', id: 'rules', count: 1, noun: {singular: 'enforcing rule', plural: 'enforcing rules'}, added: 1},
    {
      type: 'fact',
      id: 'breaking',
      icon: 'breaking',
      count: 2,
      noun: {singular: 'breaking change', plural: 'breaking changes'},
      ids: ['new'],
      description: 'Classified by the shared rules',
    },
  ])
  assert.deepEqual(words(figures), [
    ['enforcing rules', 1, 1, 0, 0],
    ['breaking changes', 2, 0, 0, 0],
  ])
  assert.equal(figures[1].description, 'Classified by the shared rules')
  // The same sentence as the bar's, changes included in a comparison and left out for one revision.
  assert.equal(figuresSentence(figures, true, 'en-US'), '1 enforcing rule +1 · 2 breaking changes')
  assert.equal(figuresSentence(figures, false, 'en-US'), '1 enforcing rule · 2 breaking changes')
  const controller = probe({})
  const html = renderToStaticMarkup(createElement(SummaryBar, {projection: {...controller, summary: figures}}))
  assert.match(
    html,
    /data-summary-key="fact:rules"[\s\S]*?<span[^>]*data-summary-delta="added"[^>]*><span aria-hidden="true" class="ph-cap">\+1<\/span><span class="pj:sr-only">1 added<\/span>/u,
  )
  assert.doesNotMatch(
    html,
    /<button[^>]*data-summary-delta="added"[^>]*>(<span[^>]*>)?\+1(<\/span>)?<\/button><\/li><li[^>]*data-summary-key="fact:breaking"/u,
  )
  assert.match(
    html,
    /<button[^>]*aria-description="Classified by the shared rules"[^>]*title="Classified by the shared rules\nShow only the breaking changes"/u,
  )
})

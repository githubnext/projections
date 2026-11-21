import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {comparisonModel, extractionModel, stepEmphasis} from '@githubnext/projections-renderer-kit'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime'
import {buildModel, entries, findingsOf} from '../node_modules/.cache/test/model.js'
import {agenticWorkflowsFacts} from '../node_modules/.cache/test/summary.js'
import {AgenticWorkflowsView} from '../node_modules/.cache/test/view.js'
import {plain} from '../../kit/test/markup.mjs'

const noop = () => undefined

const runtime = createRulesRuntime()
const rules = new Uint8Array(
  readFileSync(new URL('../../../comparators/agentic-workflows/agentic-workflows.comparator.yaml', import.meta.url)),
)
const fixture = name =>
  JSON.parse(readFileSync(new URL(`../../../extractors/github-agentic-workflows/tests/fixtures/${name}`, import.meta.url), 'utf8'))
const before = fixture('docs-bot/before.expected.json')
const after = fixture('docs-bot/after.expected.json')

// The agentic-workflows rules, run in the rules interpreter as hosts run them.
const interpreted = (a = before, b = after) => runtime.compare(rules, {protocolVersion: 0, before: a, after: b, baseline: {}, options: {}})

function props(model, init, overrides = {}) {
  return {
    init,
    model,
    comparing: init.mode === 'comparison',
    diff: init.mode === 'comparison' && init.comparisonMode === 'diff',
    comparisonMode: init.comparisonMode,
    progress: 1,
    highlighting: init.mode === 'comparison' ? 1 : 0,
    emphasis: stepEmphasis([], 1, init.mode === 'comparison' ? 1 : 0),
    direction: 1,
    schedule: [],
    rendererName: 'agentic-workflows',
    selectedId: null,
    hoveredId: null,
    onSelect: noop,
    onOpen: noop,
    reportSteps: noop,
    controls: {view: 'cards'},
    declareControls: noop,
    onAction: () => noop,
    reportLegend: noop,
    options: {},
    viewport: undefined,
    reducedMotion: false,
    locale: 'en',
    ...overrides,
  }
}

const value = (key, text) => ({key, text})

test('entries say what arrived, left or changed in place, in the diff and in each pane', () => {
  const was = [value('a', '`a`'), value('b', '`b` max 1'), value('c', '`c`')]
  const now = [value('a', '`a`'), value('b', '`b` max 3'), value('d', '`d`')]
  assert.deepEqual(
    entries(was, now, 'diff').map(entry => [entry.key, entry.mark, entry.was]),
    [
      ['a', 'unchanged', undefined],
      ['b', 'modified', '`b` max 1'],
      ['d', 'added', undefined],
      ['c', 'removed', undefined],
    ],
  )
  assert.deepEqual(
    entries(was, now, 'before').map(entry => [entry.key, entry.mark]),
    [
      ['a', 'unchanged'],
      ['b', 'modified'],
      ['c', 'removed'],
    ],
  )
  // A workflow on one side only marks nothing: its card states its change.
  assert.deepEqual(
    entries(undefined, now, 'diff').map(entry => entry.mark),
    ['unchanged', 'unchanged', 'unchanged'],
  )
})

test('one revision groups workflows, reads their sections and lists the matrix columns, gates first', () => {
  const view = buildModel(extractionModel(after), 'after')
  assert.equal(view.interpreted, false)
  assert.deepEqual(
    view.groups.map(group => [group.title, group.workflows.map(item => item.entity.label)]),
    [
      ['docs-bot', ['docs-bot', 'docs-bot-digest', 'docs-bot-examples', 'docs-bot-links']],
      ['Other workflows', ['issue-triage']],
    ],
  )
  const bot = view.groups[0].workflows[0]
  const section = id => bot.sections.find(section => section.spec.id === id)
  assert.deepEqual(
    section('repos').entries.map(entry => entry.text),
    ['`${{ github.repository }}`', '`octo-org/docs-site`'],
  )
  assert.deepEqual(
    section('outputs').entries.map(entry => entry.text),
    [
      '`create-issue` max `3`',
      '`create-pull-request` max `1` (default), to `octo-org/docs-site`',
      '`dispatch-workflow` max `3`, starts `docs-bot-links`, `docs-bot-examples`, `docs-bot-digest`',
    ],
  )
  // Default roles go without saying.
  assert.deepEqual(
    section('triggers').entries.map(entry => entry.text),
    ['`schedule` weekly on monday', '`workflow_dispatch`'],
  )
  const loads = view.categories.find(category => category.section === 'loads')
  assert.deepEqual(
    loads.columns.map(column => [column.label, column.gate]),
    [
      ['`skills/check-links`', true],
      ['`skills/check-style`', true],
      ['`shared/docs-common.md`', false],
      ['`skills/digest-format`', false],
    ],
  )
})

test('the comparator says in which direction each section moved', async () => {
  const comparison = await interpreted()
  const view = buildModel(comparisonModel(before, after, comparison), 'diff', comparison.metadata)
  assert.equal(view.interpreted, true)
  const workflow = label => view.groups.flatMap(group => group.workflows).find(item => item.entity.label === label)
  const directions = label =>
    Object.fromEntries(
      workflow(label)
        .sections.filter(section => section.directions.length)
        .map(section => [section.spec.id, section.directions]),
    )
  assert.deepEqual(directions('docs-bot'), {
    tools: ['widened'],
    repos: ['widened'],
    permissions: ['widened'],
    outputs: ['widened'],
    budgets: ['widened'],
    loads: ['widened'],
  })
  assert.deepEqual(directions('docs-bot-links'), {bash: ['widened'], network: ['widened']})
  assert.deepEqual(directions('docs-bot-examples'), {network: ['narrowed'], budgets: ['narrowed']})
  const loads = workflow('docs-bot').sections.find(section => section.spec.id === 'loads')
  assert.deepEqual(
    loads.entries.filter(entry => entry.mark !== 'unchanged').map(entry => [entry.mark, entry.text]),
    [['removed', 'skill `skills/check-links` · `guardrail`']],
  )
  // Comparator metadata is untrusted: anything malformed is left out.
  assert.equal(findingsOf({}), undefined)
  assert.deepEqual(
    findingsOf({agenticWorkflows: {interpretations: {a: [{name: 3}, {name: 'x', level: 'warning', items: [1, 'y']}]}}}).get('a'),
    [{name: 'x', level: 'warning', items: ['y']}],
  )
})

test('the summary counts lock files out of date and the comparator’s widenings, each a filter', async () => {
  const comparison = await interpreted()
  const init = {mode: 'comparison', comparisonMode: 'diff', comparison, before, after}
  const facts = agenticWorkflowsFacts({init, model: comparisonModel(before, after, comparison)})
  assert.deepEqual(
    facts.map(fact => [fact.id, fact.count]),
    [
      ['lock-stale', 1],
      ['gate-removed', 1],
      ['repos-widened', 1],
      ['permissions-widened', 1],
      ['bash-widened', 1],
      ['network-widened', 1],
      ['outputs-widened', 2],
      ['tools-widened', 1],
      ['budget-raised', 1],
    ],
  )
  assert.deepEqual(facts[0].ids, ['workflow:.github/workflows/issue-triage.md'])
})

test('cards and the matrix draw the comparison, and an empty revision says so', async () => {
  const comparison = await interpreted()
  const model = comparisonModel(before, after, comparison)
  const init = {mode: 'comparison', comparisonMode: 'diff', comparison, before, after}
  const cards = plain(renderToStaticMarkup(createElement(AgenticWorkflowsView, props(model, init))))
  for (const text of ['Widened', 'Narrowed', 'Lock stale', 'octo-org/docs-site', 'is stale: its front matter or imports changed']) {
    assert.ok(cards.includes(text), text)
  }
  const matrix = renderToStaticMarkup(createElement(AgenticWorkflowsView, props(model, init, {controls: {view: 'matrix'}})))
  assert.match(matrix, /data-cell="removed"/)
  assert.match(plain(matrix), /Capabilities/)
  const empty = {protocolVersion: 0, schema: 'architecture/v0', vocabularies: ['agentic-workflows/v0'], entities: [], relationships: []}
  const none = renderToStaticMarkup(
    createElement(AgenticWorkflowsView, props(extractionModel(empty), {mode: 'extraction', extraction: empty})),
  )
  assert.match(plain(none), /No agentic workflows/)
})

test('a card says what changed beyond its entries: engine, strict mode, lock, defaults and no permissions', async () => {
  const extraction = data => ({
    protocolVersion: 0,
    schema: 'architecture/v0',
    vocabularies: ['agentic-workflows/v0'],
    entities: [
      {id: 'workflow:.github/workflows/a.md', kind: 'workflow', label: 'a', data: {path: '.github/workflows/a.md', name: 'Ask', ...data}},
    ],
    relationships: [],
  })
  const old = extraction({
    engine: {id: 'copilot'},
    strict: true,
    lock: {status: 'current'},
    permissions: {},
    limits: {timeoutMinutes: {value: 10, declared: true}, maxAiCredits: {value: 1000, declared: false}},
  })
  const now = extraction({
    engine: {id: 'claude'},
    strict: false,
    lock: {status: 'stale'},
    permissions: null,
    limits: {timeoutMinutes: {value: 20, declared: false}, maxAiCredits: {value: 1000, declared: true}},
  })
  const comparison = await interpreted(old, now)
  const model = comparisonModel(old, now, comparison)
  const card = view => view.groups[0].workflows[0]
  const section = (view, id) => card(view).sections.find(item => item.spec.id === id)
  const diff = buildModel(model, 'diff')
  // A budget declared on either side keeps its default counterpart, so a change moves from or to it.
  assert.deepEqual(
    section(diff, 'budgets').entries.map(entry => [entry.mark, entry.was, entry.text]),
    [
      ['modified', 'timeout `10 min`', 'timeout `20 min` (default)'],
      ['modified', 'AI credits per run `1,000` (default)', 'AI credits per run `1,000`'],
    ],
  )
  // `permissions: {}` grants nothing, unlike inheriting GitHub's defaults.
  assert.deepEqual(
    section(diff, 'permissions').entries.map(entry => [entry.mark, entry.text]),
    [['removed', 'none (`permissions: {}`)']],
  )
  const init = {mode: 'comparison', comparisonMode: 'diff', comparison, before: old, after: now}
  const markup = renderToStaticMarkup(createElement(AgenticWorkflowsView, props(model, init)))
  // A named workflow still shows its path; the meta line reads old → new.
  assert.match(plain(markup), /\.github\/workflows\/a\.md/)
  const meta = plain(markup.match(/<p class="aw-meta">.*?<\/p>/)[0])
  for (const text of ['was copilot, now claude', 'was strict mode on, now strict mode off', 'was Lock current, now Lock stale']) {
    assert.ok(meta.replace(/→/g, '').includes(text), `${text} in ${meta}`)
  }
  // Side by side, an entry changed in place takes its pane's hue while highlighted.
  const pane = progress =>
    renderToStaticMarkup(
      createElement(AgenticWorkflowsView, props(model, {...init, comparisonMode: 'side-by-side'}, {diff: false, progress})),
    )
  assert.match(pane(0), /data-change="removed"[^>]*>(?:(?!<\/li>).)*timeout/)
  assert.match(pane(1), /data-change="added"[^>]*>(?:(?!<\/li>).)*timeout/)
})

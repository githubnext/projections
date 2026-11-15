import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel, createGraphTransition, extractionModel, scheduleSteps} from '@githubnext/projections-renderer-kit'
import {architectureView, collapseAbove} from '../node_modules/.cache/test/architecture/collapse.js'

const engine = createNativeEngine()
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const large = async () => {
  const before = fixture('large-architecture-before'),
    after = fixture('large-architecture-after')
  return comparisonModel(before, after, await engine.compare(before, after))
}
const cards = view => view.model.entities.filter(row => row.id.startsWith('boundary:'))
const shows = (view, id) => view.model.entities.some(row => row.id === id)

test('a large comparison collapses every unchanged boundary and keeps the changed one open', async () => {
  const model = await large()
  const view = architectureView(model, new Set(), new Set())
  assert.ok(view.collapsible)
  // Billing has every change; the rest of the boundaries are unchanged.
  assert.ok(shows(view, 'billing/invoicing') && shows(view, 'billing/service-01'))
  // Shared holds both hubs, which a changed relationship touches.
  assert.deepEqual(
    cards(view).map(row => row.id),
    ['analytics', 'apps', 'catalog', 'extractors', 'gateway', 'identity', 'messaging', 'search', 'storage'].map(id => `boundary:${id}`),
  )
  const extractors = cards(view).find(row => row.id === 'boundary:extractors')
  assert.equal(extractors.after.label, 'extractors')
  assert.equal(extractors.after.data.count, 30)
  // Far fewer cards to lay out, and every relationship ends at a card that is drawn.
  assert.ok(view.model.entities.length < model.entities.length / 2, `${view.model.entities.length} cards`)
  const drawn = new Set(view.model.entities.map(row => row.id))
  for (const row of view.model.relationships) {
    const relationship = row.after ?? row.before
    assert.ok(drawn.has(relationship.from) && drawn.has(relationship.to), row.id)
  }
  // Relationships into a collapsed boundary join its card once per pair of cards.
  const joined = view.model.relationships.filter(row => row.id.startsWith('boundary-link:'))
  assert.equal(new Set(joined.map(row => `${row.after.from}->${row.after.to}`)).size, joined.length)
  assert.ok(joined.every(row => row.status === 'unchanged'))
})

test('a boundary holding a changed relationship stays open, and a pinned entity opens its boundary', async () => {
  const model = await large()
  // service-03 itself is unchanged; only its dependency moved to the other hub, which keeps both hubs' boundary open.
  const view = architectureView(model, new Set(), new Set(['catalog/service-05']))
  assert.ok(shows(view, 'billing/service-03'))
  assert.ok(shows(view, 'shared/sdk') && shows(view, 'shared/schemas'))
  assert.ok(shows(view, 'catalog/service-05'), 'pinned')
  assert.ok(!shows(view, 'boundary:catalog'))
})

test('an expanded boundary shows its components with a card to collapse it again', async () => {
  const model = await large()
  const view = architectureView(model, new Set(['search']), new Set())
  assert.ok(shows(view, 'search/service-01'))
  const closer = view.cards.get('boundary-collapse:search')
  assert.deepEqual(closer, {boundary: 'search', count: 16, open: true})
  assert.equal(architectureView(model, 'all', new Set()).model, model)
})

test('a small architecture, or one revision of a large one, collapses as its size says', async () => {
  const small = fixture('platform-before')
  assert.ok(small.entities.length <= collapseAbove)
  const view = architectureView(extractionModel(small), new Set(), new Set())
  assert.equal(view.model.entities.length, small.entities.length)
  const one = architectureView(extractionModel(fixture('large-architecture-after')), new Set(), new Set())
  assert.ok(one.collapsible)
  assert.ok(cards(one).length >= 10, 'every boundary collapses in one revision')
})

test('the collapsed large architecture lays out', async () => {
  const model = await large()
  const view = architectureView(model, new Set(), new Set())
  const transition = await createGraphTransition(view.model, scheduleSteps(view.model), {compound: true, footer: true})
  assert.ok(transition.diff.nodes.some(node => node.id === 'boundary:extractors' && !node.group))
  assert.ok(transition.diff.nodes.some(node => node.id === 'billing' && node.group))
})

test("a summary card carries its boundary's own data, so it can be described and sized like a card", async () => {
  const model = await large()
  const described = {
    ...model,
    entities: model.entities.map(row =>
      row.id === 'extractors'
        ? {
            ...row,
            before: {...row.before, data: {description: 'Every extractor', code: 18000}},
            after: {...row.after, data: {description: 'Every extractor', code: 18000}},
          }
        : row,
    ),
  }
  const card = cards(architectureView(described, new Set(), new Set())).find(row => row.id === 'boundary:extractors')
  assert.deepEqual(card.after.data, {description: 'Every extractor', code: 18000, count: 30, collapsed: true})
})

test('a boundary open for its changes shows its unchanged components as one card, which opens it whole', async () => {
  const model = await large()
  const view = architectureView(model, new Set(), new Set())
  const rest = view.model.entities.find(row => row.id === 'boundary-rest:shared')
  assert.deepEqual([rest.after.kind, rest.after.label], ['unchanged', '4 components'])
  assert.deepEqual(view.cards.get('boundary-rest:shared'), {boundary: 'shared', count: 4, open: false, rest: true})
  // Its components are hidden behind it, their relationships joined to it, and it sits inside the boundary.
  const hiddenHere = [...view.hidden].filter(([, boundary]) => boundary === 'shared').map(([id]) => id)
  assert.equal(hiddenHere.length, 4)
  assert.ok(hiddenHere.every(id => !shows(view, id)))
  assert.ok(
    view.model.relationships.some(
      row => row.after?.kind === 'contains' && row.after.from === 'shared' && row.after.to === 'boundary-rest:shared',
    ),
  )
  // Opened, every component shows, with a card that closes the unchanged ones again.
  const opened = architectureView(model, new Set(['shared']), new Set())
  assert.ok(hiddenHere.every(id => shows(opened, id)))
  assert.deepEqual(opened.cards.get('boundary-collapse:shared'), {boundary: 'shared', count: 4, open: true, rest: true})
})

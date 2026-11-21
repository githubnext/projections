import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {stepEmphasis} from '@githubnext/projections-renderer-kit'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {createDiDiff} from '../node_modules/.cache/test/diff-model.js'
import {diFacts} from '../node_modules/.cache/test/facts.js'
import {
  diMetrics,
  diCardText,
  dependencyLines,
  facetLines,
  lineRoom,
  monoAdvance,
  registrationWidth,
  sansAdvance,
} from '../node_modules/.cache/test/geometry.js'
import {layoutDiModel} from '../node_modules/.cache/test/layout.js'
import {buildDiModel} from '../node_modules/.cache/test/model.js'
import {dependencyWords, facetWords, unitStatusParts, unitTone} from '../node_modules/.cache/test/diff.js'
import {DependencyInjectionRenderer} from '../node_modules/.cache/test/renderer.js'
import {compared} from './engine.mjs'
import {loadPair, scenarios} from './fixtures.mjs'

const noop = () => undefined

const diffOf = async scenario => {
  const {before, after} = loadPair(scenario)
  const {model} = await compared(before, after)
  return {model, diff: createDiDiff(model)}
}
const facts = model => diFacts(model).map(fact => `${fact.count} ${fact.count === 1 ? fact.noun.singular : fact.noun.plural}`)
const card = (diff, id) => diff.units.find(unit => unit.id === id)

test("the summary bar's facts say what changed about units in both revisions; additions and links are kind counts", async () => {
  const expected = {
    orders: ['1 lifetime changed'],
    scoring: ['1 lifetime changed'],
    'nestjs-orders': ['1 implementation changed', '1 lifetime changed'],
    'spring-orders': ['1 implementation changed', '1 lifetime changed'],
  }
  for (const scenario of scenarios) {
    const {model} = await diffOf(scenario)
    assert.deepEqual(facts(model), expected[scenario], scenario)
    for (const fact of diFacts(model)) {
      assert.equal(fact.icon, 'changed')
      // Each fact filters to the entities its units fold in, which the comparison presents.
      for (const id of fact.ids) {
        assert.ok(
          model.entities.some(row => row.id === id),
          `${scenario}: ${id}`,
        )
      }
    }
  }
  // An unchanged comparison has nothing to say.
  const {after} = loadPair('orders')
  const {model} = await compared(after, after)
  assert.deepEqual(diFacts(model), [])
})

test('a modified card names what changed, the old value and the new, in the data’s own words', async () => {
  const {diff} = await diffOf('orders')
  const repository = card(diff, 'service:Orders:IOrderRepository:unkeyed')
  assert.equal(repository.status, 'modified')
  assert.deepEqual(repository.facets, [{facet: 'lifetime', before: 'Scoped', after: 'Singleton', identifier: false}])
  assert.equal(facetWords(repository.facets), 'Lifetime changed')
  assert.deepEqual(
    unitStatusParts(repository).map(part => [part.status, part.label]),
    [['modified', 'Lifetime changed']],
  )
  // Spring keeps its own scope name for the old lifetime; the implementation swap is named after the type.
  const spring = (await diffOf('spring-orders')).diff
  assert.deepEqual(
    card(spring, 'service:auditLog').facets.map(facet => [facet.facet, facet.before, facet.after]),
    [['lifetime', 'prototype', 'Singleton']],
  )
  assert.deepEqual(
    card(spring, 'service:paymentGateway').facets.map(facet => [facet.facet, facet.before, facet.after]),
    [['implementation', 'StripeGateway', 'AdyenGateway']],
  )
  assert.equal(facetWords(card(spring, 'service:paymentGateway').facets), 'Implementation changed')
  assert.equal(
    facetWords([
      {facet: 'lifetime', before: 'a', after: 'b'},
      {facet: 'implementation', before: 'a', after: 'b'},
    ]),
    'Lifetime and implementation changed',
  )
  // Added and removed cards use the comparison's own words.
  assert.deepEqual(
    unitStatusParts(card(diff, 'service:Orders:IPricing:unkeyed')).map(part => part.label),
    ['Removed'],
  )
  assert.deepEqual(
    unitStatusParts(card(diff, 'service:Orders:IPriceCalculator:unkeyed')).map(part => part.label),
    ['Added'],
  )
})

test('a card that gained or lost links lists them, and a rewired dependency shows both links', async () => {
  const {diff} = await diffOf('orders')
  const service = card(diff, 'service:Orders:IOrderService:unkeyed')
  assert.equal(service.status, 'unchanged')
  assert.deepEqual(
    service.dependencies.map(item => [item.change, item.kind, item.name]),
    [
      ['removed', 'dependency', 'IPricing'],
      ['added', 'dependency', 'IPriceCalculator'],
    ],
  )
  // An otherwise unchanged card lists its links under its name, in the modified hue, and says which changed.
  assert.equal(unitTone(service), 'modified')
  assert.deepEqual(
    unitStatusParts(service).map(part => [part.status, part.label]),
    [['modified', 'Dependencies changed']],
  )
  assert.equal(dependencyWords(card(diff, 'service:Orders:OrdersController:unkeyed').dependencies), 'Runtime resolution added')
  assert.equal(unitTone(card(diff, 'service:Orders:ILogger:unkeyed')), undefined)
  assert.deepEqual(
    card(diff, 'service:Orders:OrdersController:unkeyed').dependencies.map(item => [item.change, item.kind, item.name]),
    [['added', 'runtime resolution', 'IClock']],
  )
  // Added and removed cards don't repeat their own links.
  assert.deepEqual(card(diff, 'service:Orders:IPriceCalculator:unkeyed').dependencies, [])
  const statuses = new Map(diff.links.map(link => [link.key, link.status]))
  assert.equal(statuses.get('dependsOn:OrderService:pricing'), 'removed')
  assert.equal(statuses.get('dependsOn:OrderService:prices'), 'added')
  const scoring = (await diffOf('scoring')).diff
  assert.deepEqual(
    card(scoring, 'service:Scoring:IEvaluator:unkeyed').dependencies.map(item => `${item.change} ${item.name}`),
    ['removed IModelClient', 'added IScoreNormalizer'],
  )
})

test('the diff is the transition’s union layout: every unit once, nothing overlapping, change lines pushing layers down', async () => {
  for (const scenario of scenarios) {
    const {model, diff} = await diffOf(scenario)
    const ids = new Set(
      [...buildDiModel(model.before).units, ...buildDiModel(model.after).units].map(
        unit => model.entityRow.after.get(unit.id) ?? model.entityRow.before.get(unit.id) ?? unit.id,
      ),
    )
    assert.equal(diff.units.length, ids.size, scenario)
    const boxes = diff.units.map(unit => ({
      id: unit.id,
      left: unit.x - diMetrics.width / 2,
      right: unit.x + diMetrics.width / 2,
      top: unit.y - diMetrics.height / 2,
      bottom: unit.y - diMetrics.height / 2 + unit.height,
    }))
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${scenario}: ${a.id} overlaps ${b.id}`)
      }
    }
    // Every link starts at its card's bottom, below any change lines, and ends at the top of the card it points at.
    const byId = new Map(diff.units.map(unit => [unit.id, unit]))
    for (const link of diff.links) {
      assert.equal(link.from.y, byId.get(link.fromId).y - diMetrics.height / 2 + byId.get(link.fromId).height)
      assert.equal(link.to.y, byId.get(link.toId).y - diMetrics.height / 2)
    }
  }
  // With no change lines, positions are exactly the layout's.
  const {after} = loadPair('orders')
  const {model} = await compared(after, after)
  const positions = layoutDiModel(buildDiModel(after))
  for (const unit of createDiDiff(model).units) assert.deepEqual([unit.x, unit.y], [positions.get(unit.id).x, positions.get(unit.id).y])
})

const diffProps = (model, highlighting) => ({
  init: {},
  model,
  comparing: true,
  diff: true,
  comparisonMode: 'diff',
  pane: undefined,
  progress: 1,
  highlighting,
  direction: 1,
  schedule: [],
  selectedId: null,
  onSelect: noop,
  onOpen: noop,
  reportSteps: noop,
  reportLegend: noop,
  controls: {},
  declareControls: noop,
  emphasis: stepEmphasis([], 1, highlighting),
  onAction: () => noop,
  options: {},
  viewport: undefined,
  reducedMotion: false,
  locale: 'en-US',
})

test('diff mode marks every change in place and says it in words, leaving the summary to the host', async () => {
  const {model} = await diffOf('orders')
  const props = highlighting => diffProps(model, highlighting)
  const html = renderToStaticMarkup(createElement(DependencyInjectionRenderer, props(1)))
  assert.doesNotMatch(html, /pk-diff-summary|di-summary/)
  assert.match(
    html,
    /data-unit-id="service:Orders:IPricing:unkeyed" data-entity-id="service:Orders:IPricing:unkeyed"[^>]*data-change="removed"/,
  )
  assert.match(html, /data-unit-id="service:Orders:IPriceCalculator:unkeyed"[^>]*data-change="added"/)
  assert.match(html, /data-unit-id="service:Orders:IOrderRepository:unkeyed"[^>]*data-change="modified"/)
  // The registration that changed is marked and says so.
  assert.match(
    html,
    /data-entity-id="service:Orders:IOrderRepository:unkeyed:registration:0" role="button" tabindex="0" aria-label="Inspect registration of IOrderRepository, [^"]*, Modified, lifetime changed, was Scoped, now Singleton"[^>]*data-change="modified"/,
  )
  assert.match(html, /<tspan class="di-was">Scoped<\/tspan><tspan class="di-arrow"> → <\/tspan><tspan class="di-now">Singleton<\/tspan>/)
  assert.match(html, /<text[^>]*>Lifetime changed<\/text>/)
  assert.match(
    html,
    /aria-label="Inspect implementation OrderService, [^"]*, Unchanged, dependency removed: IPricing, dependency added: IPriceCalculator"/,
  )
  // A removed link is dashed even with highlighting off; changes keep their marks, drawn plain.
  assert.match(html, /data-edge-key="dependsOn:OrderService:pricing"[^>]*data-change="removed"/)
  const plain = renderToStaticMarkup(createElement(DependencyInjectionRenderer, props(0)))
  assert.doesNotMatch(plain, /pk-svg-status|node-footer-band/)
  assert.match(plain, /data-edge-key="dependsOn:OrderService:pricing"[^]*?stroke-dasharray="5 3"/)
  assert.match(plain, /--emphasis:0/)
})

/** The `orders` pair with a contract, its implementation (in both revisions) and a key renamed to long identifiers. */
const longNames = {
  contract: 'IOrderRepository_for_the_regional_fulfilment_and_settlement_pipeline',
  before: 'SqlOrderRepository_backed_by_the_legacy_settlement_ledger_tables',
  after: 'CosmosOrderRepository_with_partitioned_settlement_ledger_documents',
  key: 'orders-with-a-very-long-container-key/regional-settlement',
}
const lengthened = () => {
  const pair = loadPair('orders')
  for (const [side, extraction] of Object.entries(pair)) {
    for (const entity of extraction.entities) {
      if (entity.id === 'service:Orders:IOrderRepository:unkeyed') entity.label = longNames.contract
      if (entity.id === 'implementation:Orders:SqlOrderRepository') entity.label = longNames[side]
      if (entity.data?.implementation === 'Orders:SqlOrderRepository') entity.data.implementation = `Orders:${longNames[side]}`
      if (entity.data?.key === 'orders') entity.data.key = longNames.key
    }
  }
  return pair
}

test('a diff card shows long names and values whole, wrapping them and growing to hold them', async () => {
  const {before, after} = lengthened()
  const {model} = await compared(before, after)
  const diff = createDiDiff(model)
  const repository = diff.units.find(unit => unit.unit.contract === longNames.contract)
  assert.ok(repository, 'the renamed contract has a card')
  const joined = line => line.spans.map(span => span.text).join('')
  const text = role => repository.text.lines.filter(line => line.role === role)
  // The contract reads whole on more than one line, the lifetime label beside its last line or under it.
  assert.ok(text('contract').length > 1)
  assert.equal(text('contract').map(joined).join(''), longNames.contract)
  // No line is longer than the text column holds.
  for (const line of text('contract')) assert.ok(joined(line).length * monoAdvance <= lineRoom + 1e-6, joined(line))
  // The implementation change names both values whole, in place: the old struck through, then the new.
  const names = text('implementation').flatMap(line => line.spans)
  for (const [tone, value] of [
    ['was', longNames.before],
    ['now', longNames.after],
  ]) {
    assert.equal(
      names
        .filter(span => span.tone === tone)
        .map(span => span.text)
        .join(''),
      value,
    )
  }
  // The card grows to hold its text, above its footer, and the layer below moves down so nothing overlaps.
  assert.ok(repository.height > diMetrics.height)
  assert.equal(repository.height, Math.max(...repository.text.lines.map(line => line.y)) + 15 + diMetrics.footer)
  const boxes = diff.units.map(unit => ({
    id: unit.id,
    left: unit.x - diMetrics.width / 2,
    right: unit.x + diMetrics.width / 2,
    top: unit.y - diMetrics.height / 2,
    bottom: unit.y - diMetrics.height / 2 + unit.height,
  }))
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.id} overlaps ${b.id}`)
    }
  }
  // The keyed card shows its whole key.
  const keyed = diff.units.find(unit => unit.unit.key === longNames.key)
  assert.equal(
    keyed.text.lines
      .filter(line => line.role === 'note')
      .map(joined)
      .join(''),
    `key ${longNames.key}`,
  )
  // The markup draws all of it, and nothing is cut short with an ellipsis.
  const html = renderToStaticMarkup(createElement(DependencyInjectionRenderer, diffProps(model, 1)))
  assert.doesNotMatch(html, /…/)
  for (const line of text('contract')) assert.ok(html.includes(`>${joined(line)}</text>`), joined(line))
})

test('diff markup never cuts text short', async () => {
  for (const scenario of scenarios) {
    const {model} = await diffOf(scenario)
    const html = renderToStaticMarkup(createElement(DependencyInjectionRenderer, diffProps(model, 1)))
    assert.doesNotMatch(html, /…/, scenario)
  }
})

test('card text sits in a kit card’s places, and text that doesn’t fit beside other text takes its own line', () => {
  const base = {implementation: 'OrderService', facets: [], dependencies: []}
  const plain = {after: 'Singleton', code: false}
  const rows = text => text.lines.map(line => [line.role, line.anchor, line.y, line.spans.map(span => span.text).join('')])
  // Short text: the kind line and the lifetime at its right, then the name and the key at its right; the card is a
  // kit card's height.
  const short = diCardText({...base, contract: 'IOrderService', lifetime: plain, note: {prefix: 'key ', text: 'orders', code: true}})
  assert.equal(short.height, diMetrics.height)
  assert.deepEqual(rows(short), [
    ['contract', 'start', 21, 'IOrderService'],
    ['lifetime', 'end', 21, 'Singleton'],
    ['implementation', 'start', 41, 'OrderService'],
    ['note', 'end', 41, 'key orders'],
  ])
  assert.deepEqual(short.split, 28)
  // The registration's part is the lifetime's corner of the kind line.
  assert.deepEqual(short.registration, {
    x: diMetrics.width - registrationWidth('Singleton'.length * sansAdvance),
    y: 0,
    width: registrationWidth('Singleton'.length * sansAdvance),
    height: 28,
  })
  // A card registered as its own type says so in words.
  assert.deepEqual(rows(diCardText({...base, lifetime: plain}))[0], ['self', 'start', 21, 'Self-registered'])
  // A changed lifetime shows both values, beside the kind line when they fit, otherwise on a line of their own.
  const changed = {before: 'Scoped', after: 'Singleton', code: false}
  assert.deepEqual(
    diCardText({...base, contract: 'ICache', lifetime: changed}).lines[1].spans.map(span => [span.tone, span.text]),
    [
      ['was', 'Scoped'],
      ['arrow', ' → '],
      ['now', 'Singleton'],
    ],
  )
  const own = diCardText({...base, contract: 'IOrderFulfilmentCoordinator', lifetime: changed})
  assert.deepEqual(rows(own).slice(0, 3), [
    ['contract', 'start', 21, 'IOrderFulfilmentCoordinator'],
    ['lifetime', 'start', 35, 'Scoped → Singleton'],
    ['implementation', 'start', 55, 'OrderService'],
  ])
  assert.equal(own.registration.y, 25)
  // A scope name too long to sit beside the name takes its own line.
  const scope = diCardText({...base, contract: 'IOrderFulfilmentCoordinator', lifetime: {after: 'request-scoped-per-tenant', code: true}})
  assert.deepEqual(
    scope.lines.filter(line => line.role === 'lifetime').map(line => [line.anchor, line.y]),
    [['start', 35]],
  )
  // A long implementation wraps, and the note stays clear below it.
  const alone = diCardText({...base, implementation: longNames.after, lifetime: plain, note: {text: '×2', code: false}})
  const implementations = alone.lines.filter(line => line.role === 'implementation')
  assert.ok(implementations.length > 1)
  assert.equal(implementations.map(line => line.spans[0].text).join(''), longNames.after)
  assert.ok(alone.lines.find(line => line.role === 'note').y > implementations.at(-1).y)
  // Other facets and the links a unit gained and lost are listed under the name, and the card grows to hold them.
  const listed = diCardText({
    ...base,
    contract: 'IOrderService',
    lifetime: plain,
    facets: [{key: 'Registration count', before: '1', after: '2', identifier: false}],
    dependencies: [{name: 'IPricing'}],
  })
  assert.deepEqual(rows(listed).at(-1), ['facet', 'start', 61, 'Registration count 1 → 2'])
  assert.deepEqual(
    listed.dependencies.map(line => line.y),
    [81],
  )
  assert.equal(listed.height, 81 + 15 + diMetrics.footer)
})

test('change lines flow whole: a facet keeps its name and both values, and dependencies wrap to more lines', () => {
  assert.deepEqual(facetLines({key: 'Lifetime', before: 'Scoped', after: 'Singleton', identifier: false}), [
    [
      {part: 'key', text: 'Lifetime '},
      {part: 'was', text: 'Scoped'},
      {part: 'arrow', text: ' → '},
      {part: 'now', text: 'Singleton'},
    ],
  ])
  const long = facetLines({key: 'Implementation', before: longNames.before, after: longNames.after, identifier: true})
  assert.ok(long.length > 1)
  for (const line of long) {
    const width = line.reduce(
      (sum, piece) => sum + piece.text.trimEnd().length * (/was|now/.test(piece.part) ? monoAdvance : sansAdvance),
      0,
    )
    assert.ok(width <= lineRoom + 1e-6, JSON.stringify(line))
  }
  const pieces = long.flat()
  assert.equal(pieces[0].text, 'Implementation ')
  for (const [part, value] of [
    ['was', longNames.before],
    ['now', longNames.after],
  ]) {
    assert.equal(
      pieces
        .filter(piece => piece.part === part)
        .map(piece => piece.text)
        .join(''),
      value,
    )
  }
  const names = ['IPriceCalculator', 'IInventoryReservations', 'IShippingQuotes', 'ITaxRules', longNames.contract]
  const lines = dependencyLines(names.map(name => ({name})))
  assert.ok(lines.length > 1)
  for (const [index, name] of names.entries()) {
    assert.equal(
      lines
        .flat()
        .filter(piece => piece.index === index)
        .map(piece => piece.text)
        .join(''),
      name,
    )
  }
})

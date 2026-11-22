import {test} from 'node:test'
import {stepEmphasis} from '@githubnext/projections-renderer-kit'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {buildDiModel} from '../node_modules/.cache/test/model.js'
import {createDiTransition} from '../node_modules/.cache/test/transition.js'
import {layoutDiModel} from '../node_modules/.cache/test/layout.js'
import {lifetimeDash, lifetimeMark, markSpan} from '../node_modules/.cache/test/lifetime-mark.js'
import {DependencyInjectionRenderer, diLegend} from '../node_modules/.cache/test/renderer.js'
import {compared, extractionModel, scheduleSteps, stepEnds, stepHolds} from './engine.mjs'
import {loadFixture, loadPair, scenarios} from './fixtures.mjs'
import {checkTransitionFrame} from './invariants.mjs'

const before = loadFixture('before')
const after = loadFixture('after')
const unitId = name => `service:Orders:${name}:unkeyed`

test('a registration triple composes into one unit, and the last registration wins', () => {
  const model = buildDiModel(before)
  assert.deepEqual(model.units.map(unit => unit.implementation).sort(), [
    'ConsoleLogger',
    'LegacyPricing',
    'OrderFlags',
    'OrderService',
    'OrderValidator',
    'OrdersController',
    'SqlConnectionFactory',
    'SqlOrderRepository',
    'SystemClock',
  ])
  const controller = model.units.find(unit => unit.id === unitId('OrdersController'))
  assert.equal(controller.contract, undefined, 'a self-registered type has no separate contract')
  const validators = model.units.find(unit => unit.id === unitId('IValidator'))
  assert.equal(validators.registrations, 2)
  assert.equal(validators.implementation, 'OrderValidator')
  const flags = model.units.find(unit => unit.id === 'service:Orders:IFeatureFlags:orders')
  assert.equal(flags.key, 'orders')
  const repository = model.units.find(unit => unit.id === unitId('IOrderRepository'))
  assert.deepEqual(
    [repository.contract, repository.implementation, repository.lifetime],
    ['IOrderRepository', 'SqlOrderRepository', 'scoped'],
  )
  const collection = model.links.find(link => link.parameter === 'validators')
  assert.equal(collection.collection, true)
  // An unregistered implementation is still a unit.
  const orphan = buildDiModel({entities: [{id: 'implementation:Orphan', kind: 'implementation', label: 'Orphan'}], relationships: []})
  assert.deepEqual(
    orphan.units.map(unit => [unit.implementation, unit.lifetime]),
    [['Orphan', 'unknown']],
  )
})

test('the layered layout puts every unit below the units that construct it, without overlap', () => {
  const model = buildDiModel(after)
  const positions = layoutDiModel(model)
  for (const link of model.links) assert.ok(positions.get(link.to).y > positions.get(link.from).y, `${link.from} → ${link.to}`)
  const rows = new Map()
  for (const position of positions.values()) (rows.get(position.y) ?? rows.set(position.y, []).get(position.y)).push(position.x)
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b)
    for (let index = 1; index < xs.length; index++) assert.ok(xs[index] - xs[index - 1] >= 320 - 1e-9)
  }
})

/** The renderer's props for a comparison at `progress`, with the host's highlighting at `highlighting`. */
const rendererProps = (model, schedule = scheduleSteps(model), progress = 1, highlighting = 0) => ({
  init: {},
  model,
  comparing: true,
  progress,
  highlighting,
  direction: 1,
  schedule,
  rendererName: 'dependency-injection',
  selectedId: null,
  onSelect() {},
  onOpen() {},
  reportSteps() {},
  controls: {},
  declareControls() {},
  get emphasis() {
    return stepEmphasis(this.schedule ?? [], this.progress, this.highlighting)
  },
  onAction: () => () => {},
  options: {},
  viewport: undefined,
  reducedMotion: false,
  locale: 'en-US',
})

const staged = model => {
  const schedule = scheduleSteps(model)
  return {schedule, ends: stepEnds(schedule), transition: createDiTransition(model, schedule)}
}
/** Moves the steps that change any of `ids` to the front, keeping the rest in order (like the priority-order example comparator). */
const prioritize = (comparison, ids) => {
  const first = comparison.steps.filter(step => step.changes.some(change => ids.includes(change)))
  return {...comparison, steps: [...first, ...comparison.steps.filter(step => !first.includes(step))]}
}
const added = [unitId('IPriceCalculator'), unitId('IRateCache')]
const removed = unitId('IPricing')
const byId = frame => new Map(frame.units.map(unit => [unit.id, unit]))
const links = frame => new Map(frame.links.map(link => [link.key, link]))
const arrivedLink = 'dependsOn:OrderService:prices'
const retiredLink = 'dependsOn:OrderService:pricing'

test("a rewired dependency's old route leaves with the card it pointed to, emphasized as removed", async () => {
  // OrderService's pricing dependency moves from the removed IPricing to IPriceCalculator: one relationship, rewired.
  const rewired = {
    ...after,
    relationships: after.relationships.map(row => (row.id === arrivedLink ? {...row, id: retiredLink} : row)),
  }
  const {comparison} = await compared(before, rewired)
  // IPricing's removal first, the rewiring later, as a comparison may order them.
  const {model} = await compared(before, rewired, prioritize(comparison, [removed]))
  const {schedule, transition} = staged(model)
  const stepOf = id => schedule.findIndex(step => [...step.entities, ...step.relationships].includes(id))
  assert.ok(stepOf(transition.stepRow(removed)) < stepOf(retiredLink), 'the card leaves before the rewiring step')
  // The old route follows the card's step, and the new one the step that brings it.
  assert.equal(transition.linkStepRow(`${retiredLink}:before`), transition.stepRow(removed))
  const newRow = transition.linkStepRow(`${retiredLink}:after`)
  assert.ok(stepOf(newRow) >= stepOf(retiredLink), 'the new route comes no earlier than the rewiring')
  // While the card leaves (after its step's reading lead), its old route is drawn removed and fades with it.
  const window = schedule[stepOf(transition.stepRow(removed))]
  const middle = transition(window.time + window.radius * 0.7)
  const route = links(middle).get(`${retiredLink}:before`)
  assert.equal(route.status, 'removed')
  assert.ok(route.opacity > 0 && route.opacity < 1, 'it fades out in the step that removes the card')
  assert.equal(route.opacity, byId(middle).get(removed).opacity, 'once, with the card, not twice')
})

test('units and links follow the comparison steps, with identity only from the comparison', async () => {
  const {model} = await compared(before, after)
  const {transition, ends} = staged(model)
  const ids = frame => frame.units.map(unit => unit.id).sort()
  assert.deepEqual(
    ids(transition(0)),
    buildDiModel(before)
      .units.map(unit => unit.id)
      .sort(),
  )
  assert.deepEqual(
    ids(transition(1)),
    buildDiModel(after)
      .units.map(unit => unit.id)
      .sort(),
  )
  for (const progress of [0, 1]) for (const unit of transition(progress).units) assert.equal(unit.opacity, 1)
  // The default order removes, then restructures, then adds.
  assert.equal(ends.length, 3)
  const removedStep = transition(ends[0])
  assert.equal(byId(removedStep).has(removed), false)
  assert.equal(links(removedStep).has(retiredLink), false)
  for (const id of added) assert.equal(byId(removedStep).has(id), false)
  const restructured = transition(ends[1])
  assert.equal(byId(restructured).get(unitId('IOrderRepository')).lifetime, 'singleton')
  for (const id of added) assert.equal(byId(restructured).has(id), false)
  const arrived = transition(ends[2])
  for (const id of added) assert.equal(byId(arrived).get(id).opacity, 1)
  assert.equal(links(arrived).get(arrivedLink).opacity, 1)

  const status = id => [0.5, 1, 0].map(progress => transition(progress).units.find(unit => unit.id === id)).find(Boolean).status
  assert.equal(status(unitId('IOrderRepository')), 'modified', 'a lifetime change modifies the unit')
  assert.equal(status(unitId('IClock')), 'unchanged')
  assert.equal(status(added[0]), 'added')
  assert.equal(status(removed), 'removed')
})

test('a custom comparator order changes the visual order', async () => {
  const {model: baseline, comparison} = await compared(before, after)
  const {model} = await compared(before, after, prioritize(comparison, [added[0]]))
  assert.notDeepEqual(
    model.steps.map(step => step.kind),
    baseline.steps.map(step => step.kind),
  )
  const {transition, ends} = staged(model)
  const first = transition(ends[0])
  for (const id of added) assert.equal(byId(first).get(id).opacity, 1, 'arrivals come first when the comparator says so')
  assert.equal(byId(first).get(removed).opacity, 1, 'the retired unit has not left yet')
  assert.equal(links(first).get(retiredLink).opacity, 1)
  assert.equal(links(first).get(arrivedLink).opacity, 1)
  assert.equal(byId(transition(ends[1])).has(removed), false)
})

test('nothing moves inside the holds between steps', async () => {
  for (const scenario of scenarios) {
    const {before: scenarioBefore, after: scenarioAfter} = loadPair(scenario)
    const {model} = await compared(scenarioBefore, scenarioAfter)
    const {transition, schedule} = staged(model)
    const holds = stepHolds(schedule)
    assert.equal(holds.length, schedule.length + 1)
    for (const {start, end} of holds) {
      // Boundaries belong to both a hold and a window; sample the open interval.
      const reference = JSON.stringify(transition((start + end) / 2))
      for (let index = 1; index < 10; index++) {
        assert.equal(
          JSON.stringify(transition(start + ((end - start) * index) / 10)),
          reference,
          `${scenario}: motion inside the hold ${start}..${end}`,
        )
      }
    }
    // Every step moves something, so steps are visible as distinct settled frames.
    const settled = [0, ...stepEnds(schedule)].map(progress => JSON.stringify(transition(progress)))
    assert.equal(new Set(settled).size, settled.length, `${scenario}: a step changed nothing`)
    assert.equal(settled.at(-1), JSON.stringify(transition(1)), `${scenario}: the last step ends in the After state`)
  }
})

test('an explicit reverse order plays backward in its own order', async () => {
  const {comparison} = await compared(before, after)
  const explicit = {...comparison, order: {reverse: 'explicit'}, reverseSteps: [...comparison.steps]}
  const {model} = await compared(before, after, explicit)
  const backward = scheduleSteps(model, -1)
  const transition = createDiTransition(model, backward)
  const ends = stepEnds(backward, -1)
  // Leaving progress 1, the first reverse step (restoring the removed pricing unit) happens first.
  assert.equal(byId(transition(ends.at(-1))).get(removed).opacity, 1)
  for (const id of added) assert.equal(byId(transition(ends.at(-1))).get(id).opacity, 1, 'arrivals have not been undone yet')
  for (const id of added) assert.equal(byId(transition(ends[0])).has(id), false)
  // Both schedules agree at the endpoints.
  const forward = createDiTransition(model, scheduleSteps(model, 1))
  for (const progress of [0, 1]) assert.equal(JSON.stringify(transition(progress)), JSON.stringify(forward(progress)))
})

test('every frame is coherent, positions never move, and scrubbing is deterministic in both directions', async () => {
  const pairs = scenarios.flatMap(scenario => {
    const {before: scenarioBefore, after: scenarioAfter} = loadPair(scenario)
    return [
      [scenarioBefore, scenarioAfter],
      [scenarioAfter, scenarioBefore],
    ]
  })
  for (const [from, to] of pairs) {
    const {model} = await compared(from, to)
    const {transition} = staged(model)
    const positions = new Map()
    const frames = new Map()
    const values = [
      ...Array.from({length: 1001}, (_, index) => index / 1000),
      ...Array.from({length: 1001}, (_, index) => 1 - index / 1000),
      0.7,
      0.25,
      1,
      0.01,
      0.5,
    ]
    for (const progress of values) {
      const frame = transition(progress)
      assert.deepEqual(checkTransitionFrame(frame), [], `frame at ${progress}`)
      for (const unit of frame.units) {
        const known = positions.get(unit.id)
        if (known) assert.deepEqual([unit.x, unit.y], known, `${unit.id} moved at ${progress}`)
        else positions.set(unit.id, [unit.x, unit.y])
      }
      const serialized = JSON.stringify(frame)
      if (frames.has(progress)) assert.equal(serialized, frames.get(progress), `frame at ${progress} differs between visits`)
      else frames.set(progress, serialized)
    }
  }
})

test('a changed lifetime morphs its mark and crossfades its label inside its own step', async () => {
  const {model} = await compared(before, after)
  const {transition, schedule} = staged(model)
  const unit = progress => transition(progress).units.find(item => item.id === unitId('IOrderRepository'))
  const step = schedule.find(item => item.entities.includes(`${unitId('IOrderRepository')}:registration:0`))
  for (const progress of [0, step.time - step.radius]) assert.deepEqual([unit(progress).local, unit(progress).lifetime], [0, 'scoped'])
  for (const progress of [step.time + step.radius, 1]) assert.deepEqual([unit(progress).local, unit(progress).lifetime], [1, 'singleton'])
  assert.ok(unit(step.time).local > 0 && unit(step.time).local < 1)
  // The mark's dash pattern runs from scoped's dashes to singleton's solid stroke, exactly either outside the step.
  const length = markSpan.bottom - markSpan.top
  for (const progress of [0, step.time - step.radius]) assert.deepEqual(unit(progress).dash, lifetimeDash('scoped', length))
  for (const progress of [step.time + step.radius, 1]) assert.deepEqual(unit(progress).dash, lifetimeDash('singleton', length))
  const [scoped, singleton, mid] = [lifetimeDash('scoped', length), lifetimeDash('singleton', length), unit(step.time).dash]
  assert.ok(mid[0] > scoped[0] && mid[0] < singleton[0] && mid[1] < scoped[1] && mid[1] > singleton[1])
  // Both labels are drawn while it crossfades, the old fading out as the new fades in.
  const html = renderToStaticMarkup(createElement(DependencyInjectionRenderer, rendererProps(model, schedule, step.time, 1)))
  const card = html.slice(html.indexOf(`data-unit-id="${unitId('IOrderRepository')}"`))
  assert.match(card, /class="node-detail di-lifetime-label[^"]*"[^>]*opacity="0\.\d+"[^>]*>Scoped</)
  assert.match(card, /class="node-detail di-lifetime-label[^"]*"[^>]*opacity="0\.\d+"[^>]*>Singleton</)
})

test('the lifetime mark is solid for a singleton, dashed for scoped and dotted for transient, end to end', () => {
  for (const length of [markSpan.bottom - markSpan.top, 60]) {
    const run = length - lifetimeMark.stroke
    assert.deepEqual(lifetimeDash('singleton', length), [run, 0])
    // Dashes, longer than the stroke is wide, end exactly at both ends of the mark.
    const [dash, gap] = lifetimeDash('scoped', length)
    const dashes = Math.round((run + gap) / (dash + gap))
    assert.ok(dashes >= 2 && dash > lifetimeMark.stroke * 2)
    assert.ok(Math.abs(dashes * dash + (dashes - 1) * gap - run) < 1e-9)
    // Round dots (zero-length dashes with round caps), one at each end.
    for (const lifetime of ['transient', 'unknown']) {
      const [dot, spacing] = lifetimeDash(lifetime, length)
      assert.equal(dot, 0)
      assert.ok(Math.abs(run / spacing - Math.round(run / spacing)) < 1e-9 && spacing > lifetimeMark.stroke)
    }
  }
})

test('endpoints render with no change emphasis, and the midpoint marks what changed', async () => {
  const {model} = await compared(before, after)
  const props = (progress, highlighting) => rendererProps(model, scheduleSteps(model), progress, highlighting)
  for (const progress of [0, 1]) {
    const html = renderToStaticMarkup(createElement(DependencyInjectionRenderer, props(progress, 0)))
    assert.doesNotMatch(html, /node-emphasis|node-status|di-link-emphasis|pk-svg-status/)
  }
  // Just after the last (adding) step, with the host's highlighting at full strength.
  const mid = renderToStaticMarkup(createElement(DependencyInjectionRenderer, props(stepEnds(scheduleSteps(model)).at(-1), 1)))
  assert.match(mid, /node-emphasis added/)
  assert.match(mid, /node-emphasis modified/)
  assert.match(mid, /node-footer-band added/)
  // Changed cards state their status as text (an icon and a word) in the reserved footer band, saying what changed
  // about a modified card; every card keeps the same box.
  assert.match(
    mid,
    /class="pk-svg-status"[^>]*><g class="pk-status-part added"[^>]*><g class="pk-svg-icon" data-icon="added" aria-hidden="true"><\/g><text[^>]*>Added<\/text>/,
  )
  assert.match(
    mid,
    /class="pk-svg-status"[^>]*><g class="pk-status-part modified"[^>]*><g class="pk-svg-icon" data-icon="modified" aria-hidden="true"><\/g><text[^>]*>Lifetime changed<\/text>/,
  )
  const surfaces = html =>
    new Set([...html.matchAll(/<rect class="di-card-surface" data-projections-edge="" ([^>]*?)\/?>/g)].map(match => match[1]))
  assert.deepEqual([...surfaces(mid)], [`x="-132" y="-37" width="264" height="74" rx="6"`])
  assert.deepEqual(
    surfaces(mid),
    surfaces(renderToStaticMarkup(createElement(DependencyInjectionRenderer, props(stepEnds(scheduleSteps(model)).at(-1), 0)))),
  )
  assert.match(mid, /aria-label="Inspect registration of IOrderRepository, Singleton: [^"]*, Modified"/)
  assert.match(mid, /aria-label="Inspect implementation PriceCalculator/)
  // A single revision is the same composition with nothing changed.
  const single = renderToStaticMarkup(
    createElement(DependencyInjectionRenderer, {...props(1, 0), model: extractionModel(after), comparing: false}),
  )
  assert.equal((single.match(/class="di-card /g) ?? []).length, buildDiModel(after).units.length)
  // Without a comparison a card reserves no status footer, as the kit's graph cards don't.
  assert.match(single, /<rect class="di-card-surface" data-projections-edge="" x="-132" y="-28" width="264" height="56" rx="6"/)
  // The key is the host's: none in the frame, and the renderer's legend names the runtime-resolution line.
  assert.doesNotMatch(single, /legend/i)
  assert.ok(createDiTransition(extractionModel(after), []).runtimeResolution)
  assert.deepEqual(
    diLegend(true).items.map(item => [item.shape, item.token]),
    [
      ['line', 'color-fg'],
      ['dashed', 'color-fg'],
      ['dotted', 'color-fg'],
      ['dashed', 'color-fg-muted'],
    ],
  )
  assert.match(diLegend(true).items.at(-1).label, /^Resolved at runtime/)
  // One line of short words: no title, and no item says how its line is drawn; its swatch (the card's lifetime mark,
  // or the link's line) shows it.
  assert.equal(diLegend(true, true).title, undefined)
  assert.doesNotMatch(
    diLegend(true, true)
      .items.map(item => item.label)
      .join(' '),
    /dotted|dashed/,
  )
  assert.equal(diLegend(false).items.length, 3)
  // Type names and keys are identifiers (monospace); the lifetime stays sans.
  assert.match(single, /<text class="node-kind di-contract"[^>]*data-projections-identifier=""[^>]*>IOrderRepository</)
  assert.match(single, /<text class="node-label di-implementation"[^>]*data-projections-identifier=""[^>]*>OrderService</)
  assert.match(single, /class="node-detail di-key"[^>]*>key <tspan data-projections-identifier="">orders</)
  // A card registered as its own type says so in words, in the kind line.
  assert.match(single, /<text class="node-kind di-self"(?![^>]*data-projections-identifier)[^>]*>Self-registered</)
  assert.doesNotMatch(single, /class="node-detail di-lifetime-label[^"]*"[^>]*data-projections-identifier/)
})

test('a unit inserted into a constructor chain arrives in its own step, and the chain rewires in its own', async () => {
  const {before: scoringBefore, after: scoringAfter} = loadPair('scoring')
  const {model} = await compared(scoringBefore, scoringAfter)
  const {transition, ends} = staged(model)
  const id = name => `service:Scoring:${name}:unkeyed`
  const keys = frame => new Set(frame.links.map(link => `${link.fromId}>${link.toId}`))
  // The default order drops the evaluator's direct model link first, then adds the normalizer with its links.
  const rewired = transition(ends[0])
  assert.ok(!keys(rewired).has(`${id('IEvaluator')}>${id('IModelClient')}`))
  assert.equal(
    rewired.units.some(unit => unit.id === id('IScoreNormalizer')),
    false,
  )
  const arrived = transition(ends[1])
  assert.equal(arrived.units.find(unit => unit.id === id('IScoreNormalizer')).opacity, 1)
  assert.ok(keys(arrived).has(`${id('IEvaluator')}>${id('IScoreNormalizer')}`))
  assert.ok(keys(arrived).has(`${id('IScoreNormalizer')}>${id('IModelClient')}`))
  // The model client already sits below where the normalizer will be, so it never moves.
  const y = frame => frame.units.find(unit => unit.id === id('IModelClient')).y
  const normalizer = transition(1).units.find(unit => unit.id === id('IScoreNormalizer'))
  assert.equal(y(transition(0)), y(transition(1)))
  assert.ok(y(transition(0)) > normalizer.y)
})

test('three containers fold into one model: Nest modules and aliases, Spring scopes and bean names', () => {
  const nest = buildDiModel(loadPair('nestjs-orders').before)
  const nestUnit = id => nest.units.find(unit => unit.id === id)
  // useExisting forwards one token to another: the card names its target and draws an alias, not an injection.
  const alias = nestUnit('service:PaymentsModule:string:PAYMENTS')
  assert.deepEqual([alias.contract, alias.implementation, alias.aliasOf], ['PAYMENTS', 'PaymentGateway', 'PaymentGateway'])
  assert.deepEqual(
    nest.links.filter(link => link.alias).map(link => [link.from, link.to]),
    [['service:PaymentsModule:string:PAYMENTS', 'service:PaymentsModule:class:PaymentGateway']],
  )
  // A request-scoped provider says so, in the data's own casing; a default-scoped controller that injects it is scoped, and declared a singleton.
  assert.deepEqual(
    [nestUnit('service:OrdersModule:class:RequestContext').scope, nestUnit('service:OrdersModule:class:RequestContext').lifetime],
    ['REQUEST', 'scoped'],
  )
  const controller = nestUnit('service:OrdersModule:class:OrdersController')
  assert.deepEqual([controller.lifetime, controller.declaredLifetime, controller.scope], ['scoped', 'singleton', undefined])
  // Nest services are module-scoped: the card names its module.
  assert.equal(nestUnit('service:OrdersModule:class:OrdersService').note, 'OrdersModule')

  const spring = buildDiModel(loadPair('spring-orders').before)
  const bean = name => spring.units.find(unit => unit.id === `service:${name}`)
  assert.deepEqual([bean('auditLog').scope, bean('auditLog').lifetime], ['prototype', 'transient'])
  assert.deepEqual([bean('requestContext').scope, bean('requestContext').lifetime], ['request', 'scoped'])
  assert.equal(bean('ordersService').scope, undefined, 'singleton says nothing more than its lifetime')
  // A @Bean method's return type is the contract; the instance's class is the implementation.
  assert.deepEqual(
    [bean('paymentGateway').contract, bean('paymentGateway').implementation, bean('paymentGateway').note],
    ['PaymentGateway', 'StripeGateway', undefined],
  )
  // Two Clock beans would read the same; their bean names tell them apart.
  assert.deepEqual([bean('systemClock').note, bean('utcClock').note], ['systemClock', 'utcClock'])
  // Collections and qualified candidates resolve to the beans Spring chose.
  assert.deepEqual(
    spring.links
      .filter(link => link.parameter === 'validators')
      .map(link => link.to)
      .sort(),
    ['service:amountValidator', 'service:stockValidator'],
  )
  assert.ok(spring.links.some(link => link.from === 'service:reportService' && link.to === 'service:utcClock'))
})

test('the dependency-injection card shows container scope names, and an alias is in the legend', async () => {
  const render = async scenario => {
    const pair = loadPair(scenario)
    const {model} = await compared(pair.before, pair.after)
    return renderToStaticMarkup(
      createElement(DependencyInjectionRenderer, {
        init: {},
        model,
        comparing: true,
        progress: 0,
        highlighting: 0,
        direction: 1,
        schedule: scheduleSteps(model),
        rendererName: 'dependency-injection',
        selectedId: null,
        onSelect() {},
        onOpen() {},
        reportSteps() {},
        controls: {},
        declareControls() {},
        emphasis: () => 0,
        onAction: () => () => {},
        options: {},
        viewport: undefined,
        reducedMotion: false,
        locale: 'en-US',
      }),
    )
  }
  const nest = await render('nestjs-orders')
  // The container's own scope name, exactly as the data has it.
  assert.match(nest, /data-projections-identifier="">REQUEST</)
  // The key is the host's; the renderer's legend gains the alias line when an alias is drawn.
  const {before: nestBefore, after: nestAfter} = loadPair('nestjs-orders')
  const {model} = await compared(nestBefore, nestAfter)
  assert.ok(createDiTransition(model, []).aliases)
  assert.deepEqual(
    [diLegend(false, true).items.at(-1).label, diLegend(false, true).items.at(-1).shape],
    ['Alias: the same instance', 'dotted'],
  )
  assert.equal(diLegend(false).items.length, 3)
  assert.match(nest, /an alias of PaymentGateway/)
  assert.match(nest, /declared Singleton but re-created with the scoped services it injects/)
  assert.match(await render('spring-orders'), /data-projections-identifier="">prototype</)
})

test('a name shown only to tell lookalike cards apart never marks the card changed', async () => {
  const {before: full} = loadPair('spring-orders')
  const gone = id => !id.startsWith('service:utcClock') && !id.startsWith('implementation:utcClock')
  const trimmed = {
    ...full,
    entities: full.entities.filter(item => gone(item.id)),
    relationships: full.relationships.filter(item => gone(item.id) && gone(item.from) && gone(item.to)),
  }
  const {model} = await compared(trimmed, full)
  const clock = createDiTransition(model, scheduleSteps(model))(1).units.find(unit => unit.id === 'service:systemClock')
  assert.equal(clock.unit.note, 'systemClock', 'the second Clock bean makes the name worth showing')
  assert.equal(clock.status, 'unchanged')
})

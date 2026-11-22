import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  comparisonModel,
  compileTimeline,
  createGraphTransition,
  createStagedTimeline,
  DirectionLatch,
  scheduleSteps,
  stepEnds,
  stepHoldShare,
  stepHolds,
  stepProgress,
  timelineSlots,
} from '../dist/index.js'
import {compare, entity, extraction, relationship} from './engine.mjs'

const star = ids =>
  extraction(
    'graph/v0',
    [entity('root'), entity('keep'), ...ids.map(id => entity(id))],
    [relationship('edge:keep', 'root', 'keep'), ...ids.map(id => relationship(`edge:${id}`, 'root', id))],
  )
/** A spine of persistent nodes with changes hanging off successive depths: many layers, many steps. */
const layered = ids => {
  const spine = ['root', 'a', 'b', 'c', 'd', 'e']
  return extraction(
    'graph/v0',
    [...spine, ...ids].map(id => entity(id)),
    [
      ...spine.slice(1).map((id, index) => relationship(`edge:${id}`, spine[index], id)),
      ...ids.map((id, index) => relationship(`edge:${id}`, spine[index % spine.length], id)),
    ],
  )
}
const shapes = [
  [0, 0],
  [1, 1],
  [5, 0],
  [0, 5],
  [3, 3],
  [5, 5],
  [4, 2],
  [3, 7],
  [7, 7],
  [13, 4],
  [10, 10],
]
const build = shape => (removed, added) => ({
  before: shape(Array.from({length: removed}, (_, index) => `old${index}`)),
  after: shape(Array.from({length: added}, (_, index) => `new${index}`)),
})
const fixtures = [
  ['peers', build(star)],
  ['layers', build(layered)],
]
/**
 * The schedule without reading time. Reading is deliberately one-sided (a removal is read before it leaves, an
 * arrival after it lands), so the reverse comparison mirrors the layout motion, not the reading.
 */
const unread = model => compileTimeline(model.steps).map(step => ({...step, travel: 1}))
async function transitions(before, after) {
  const forward = comparisonModel(before, after, await compare(before, after))
  const reverse = comparisonModel(after, before, await compare(after, before))
  return {
    forward: await createGraphTransition(forward, scheduleSteps(forward)),
    motion: await createGraphTransition(forward, unread(forward)),
    reverse: await createGraphTransition(reverse, unread(reverse)),
    model: forward,
  }
}

test('compiled step windows never overlap and stay inside [0, 1]', () => {
  for (let count = 0; count <= 12; count++) {
    const schedule = compileTimeline(Array.from({length: count}, (_, index) => ({index})))
    for (const step of schedule) {
      assert.ok(step.radius >= 0)
      assert.ok(step.time - step.radius >= 0 && step.time + step.radius <= 1)
    }
    for (let index = 1; index < schedule.length; index++) {
      // Consecutive windows are separated by exactly one hold.
      const gap = schedule[index].time - schedule[index].radius - (schedule[index - 1].time + schedule[index - 1].radius)
      assert.ok(Math.abs(gap - schedule[index].hold) < 1e-12)
      assert.ok(Math.abs(schedule[index].hold - (schedule[index].time - schedule[index - 1].time) * stepHoldShare) < 1e-12)
    }
    // The headroom before the first and after the last step is at least one hold.
    if (count) assert.ok(schedule[0].time - schedule[0].radius >= schedule[0].hold - 1e-12)
    // Reversing a sequence mirrors its timeline.
    for (const [index, step] of schedule.entries()) {
      assert.ok(Math.abs(step.time - (1 - schedule[count - 1 - index].time)) < 1e-12)
    }
  }
})

test('entities move continuously and the reverse comparison mirrors the motion exactly', async () => {
  for (const [fixture, states] of fixtures) {
    for (const [removed, added] of shapes) {
      const {before, after} = states(removed, added)
      const shape = `${fixture} ${removed}/${added}`
      const {forward, motion, reverse} = await transitions(before, after)
      let worst = 0
      let previous = new Map(forward(0).nodes.map(node => [node.id, node]))
      for (let index = 1; index <= 2000; index++) {
        const t = index / 2000
        const frame = forward(t)
        for (const node of frame.nodes) {
          const last = previous.get(node.id)
          if (last) worst = Math.max(worst, Math.hypot(node.x - last.x, node.y - last.y))
        }
        previous = new Map(frame.nodes.map(node => [node.id, node]))
        if (index % 10) continue
        const left = new Map(motion(t).nodes.map(node => [node.id, node]))
        const right = new Map(reverse(1 - t).nodes.map(node => [node.id, node]))
        assert.deepEqual([...left.keys()].sort(), [...right.keys()].sort(), `${shape}: presence differs at mirrored ${t}`)
        for (const [id, node] of left) {
          const mirrored = right.get(id)
          assert.ok(Math.abs(node.opacity - mirrored.opacity) < 1e-9, `${shape}: ${id} opacity not mirrored at ${t}`)
          assert.ok(Math.hypot(node.x - mirrored.x, node.y - mirrored.y) < 1e-6, `${shape}: ${id} position not mirrored at ${t}`)
        }
      }
      // A full lane is 228px wide; a teleport shows up as a jump of that magnitude.
      assert.ok(worst < 48, `${shape}: nodes jumped ${worst.toFixed(1)}px in one 1/2000 step`)
    }
  }
})

test('visible cards never overlap while the layout reflows, in either orientation', async () => {
  const file = name => entity(`file:src/${name}.ts`, 'file', {label: `src/${name}.ts`})
  const reference = (from, to) => relationship(`${from}->${to}`, `file:src/${from}.ts`, `file:src/${to}.ts`, 'references')
  const persistent = [
    reference('cli', 'api'),
    reference('cli', 'report'),
    reference('worker', 'metrics'),
    reference('report', 'batch'),
    reference('batch', 'scoring'),
    reference('scoring', 'rules'),
  ]
  const before = extraction('graph/v0', ['api', 'batch', 'cli', 'metrics', 'report', 'rules', 'scoring', 'worker'].map(file), [
    ...persistent,
    reference('api', 'scoring'),
    reference('worker', 'batch'),
  ])
  const after = extraction(
    'graph/v0',
    [...before.entities, file('cache'), file('queue')],
    [...persistent, reference('api', 'cache'), reference('cache', 'scoring'), reference('worker', 'queue'), reference('queue', 'batch')],
  )
  const model = comparisonModel(before, after, await compare(before, after))
  const mirror = comparisonModel(after, before, await compare(after, before))
  for (const orientation of ['vertical', 'horizontal']) {
    const forward = await createGraphTransition(model, scheduleSteps(model), {orientation})
    const motion = await createGraphTransition(model, unread(model), {orientation})
    const reverse = await createGraphTransition(mirror, unread(mirror), {orientation})
    for (let step = 0; step <= 500; step++) {
      const progress = step / 500
      const frame = forward(progress),
        mirrored = reverse(1 - progress)
      for (const node of motion(progress).nodes) {
        const other = mirrored.nodes.find(candidate => candidate.id === node.id)
        assert.ok(Math.hypot(node.x - other.x, node.y - other.y) < 1e-8)
      }
      const cards = frame.nodes.filter(node => node.opacity > 0.01)
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i],
            b = cards[j]
          assert.ok(
            Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
            `${orientation} collision at ${progress}: ${a.id} / ${b.id}`,
          )
        }
      }
    }
  }
})

test('step ends follow the schedule, and explicit reverse order latches per direction', async () => {
  const {before, after} = build(layered)(3, 3)
  const comparison = await compare(before, after)
  const model = comparisonModel(before, after, comparison)
  const forward = scheduleSteps(model, 1)
  // Each end is the middle of the hold after its step, where every motion has settled.
  assert.deepEqual(
    stepEnds(forward, 1),
    forward.map(step => Math.round((step.time + step.radius + step.hold / 2) * 1e9) / 1e9),
  )
  for (const [index, end] of stepEnds(forward, 1).entries()) {
    assert.equal(stepProgress(forward[index], end), 1)
    if (forward[index + 1]) assert.equal(stepProgress(forward[index + 1], end), 0)
  }
  // Mirror order: the same hold points, travelled the other way.
  assert.deepEqual(stepEnds(forward, -1).slice(1), stepEnds(forward, 1).slice(0, -1))
  // Mirror order: backward uses the same timeline.
  assert.deepEqual(scheduleSteps(model, -1), forward)
  // Explicit order: the first reverse step happens first when leaving progress 1.
  const explicit = comparisonModel(before, after, {...comparison, order: {reverse: 'explicit'}, reverseSteps: comparison.steps})
  const backward = scheduleSteps(explicit, -1)
  assert.equal(backward.at(-1).index, 0)
  assert.ok(backward.at(-1).time > backward[0].time)
  const latch = new DirectionLatch()
  assert.equal(latch.update(1, -1), -1)
  assert.equal(latch.update(0.6, 1), -1, 'reversing mid-transition keeps the presented timeline')
  assert.equal(latch.update(0, -1), 1)
  assert.equal(latch.update(0.4, -1), 1)
})

test('endpoints show exactly one side and steps without a declared kind still animate', async () => {
  const {before, after} = build(star)(2, 3)
  const comparison = await compare(before, after)
  const unlabeled = {...comparison, steps: comparison.steps.map(({kind: _kind, ...step}) => step)}
  for (const candidate of [comparison, unlabeled]) {
    const model = comparisonModel(before, after, candidate)
    const transition = await createGraphTransition(model, scheduleSteps(model))
    assert.deepEqual(
      transition(0)
        .nodes.map(node => node.id)
        .sort(),
      before.entities.map(item => item.id).sort(),
    )
    assert.deepEqual(
      transition(1)
        .nodes.map(node => node.id)
        .sort(),
      after.entities.map(item => item.id).sort(),
    )
    for (const node of [...transition(0).nodes, ...transition(1).nodes]) assert.equal(node.opacity, 1)
  }
})

test('list rows collapse after fading out and open before fading in', async () => {
  const {before, after} = build(star)(1, 1)
  const model = comparisonModel(before, after, await compare(before, after))
  const timeline = createStagedTimeline(model, scheduleSteps(model))
  const samples = Array.from({length: 1001}, (_, index) => index / 1000)
  for (const t of samples) {
    const leaving = timeline.rowPresence('old0', t),
      arriving = timeline.rowPresence('new0', t)
    assert.ok(leaving.size >= leaving.opacity - 1e-9, 'a leaving row keeps its slot until it has faded')
    assert.ok(arriving.size >= arriving.opacity - 1e-9, 'an arriving row has room before it appears')
    assert.deepEqual(timeline.rowPresence('keep', t), {size: 1, opacity: 1})
  }
  assert.deepEqual(timeline.rowPresence('old0', 0), {size: 1, opacity: 1})
  assert.deepEqual(timeline.rowPresence('old0', 1), {size: 0, opacity: 0})
  assert.deepEqual(timeline.rowPresence('new0', 0), {size: 0, opacity: 0})
  assert.deepEqual(timeline.rowPresence('new0', 1), {size: 1, opacity: 1})
})

test('dropping a link between survivors never strands a card in a rank neither revision has', async () => {
  const {pipeline, fileReflow, architectureModules} = await import('../browser/fixtures.ts')
  for (const {name, before, after} of [pipeline(), fileReflow(), architectureModules()]) {
    const model = comparisonModel(before, after, await compare(before, after))
    const transition = await createGraphTransition(model, scheduleSteps(model), {compound: before.schema === 'architecture/v0'})
    const survivors = model.entities.filter(row => row.before && row.after).map(row => row.id)
    for (const id of survivors) {
      const ys = Array.from({length: 401}, (_, index) => transition(index / 400).nodes.find(node => node.id === id).y)
      const rising = ys.some((y, index) => index && y < ys[index - 1] - 0.5)
      const falling = ys.some((y, index) => index && y > ys[index - 1] + 0.5)
      assert.ok(!(rising && falling), `${name}: ${id} moves vertically one way and then back`)
    }
    // Framing from the transition's layouts contains every frame.
    const boxes = transition.layouts.flatMap(layout => [...layout.points].map(([id, point]) => ({...point, ...layout.sizes.get(id)})))
    const left = Math.min(...boxes.map(box => box.x - box.width / 2)),
      right = Math.max(...boxes.map(box => box.x + box.width / 2))
    const top = Math.min(...boxes.map(box => box.y - box.height / 2)),
      bottom = Math.max(...boxes.map(box => box.y + box.height / 2))
    for (let index = 0; index <= 400; index++) {
      for (const node of transition(index / 400).nodes) {
        assert.ok(
          node.x - node.width / 2 >= left - 1e-6 &&
            node.x + node.width / 2 <= right + 1e-6 &&
            node.y - node.height / 2 >= top - 1e-6 &&
            node.y + node.height / 2 <= bottom + 1e-6,
          `${name}: ${node.id} leaves the framing`,
        )
      }
    }
  }
})

test('holds produce zero motion: graph and staged frames are constant inside every hold', async () => {
  for (const [fixture, states] of fixtures) {
    for (const [removed, added] of [
      [3, 3],
      [5, 0],
      [0, 5],
      [4, 2],
    ]) {
      const {before, after} = states(removed, added)
      const model = comparisonModel(before, after, await compare(before, after))
      const schedule = scheduleSteps(model)
      const graph = await createGraphTransition(model, schedule)
      const staged = createStagedTimeline(model, schedule)
      const holds = stepHolds(schedule)
      assert.equal(holds.length, schedule.length + 1)
      const stagedFrame = t =>
        JSON.stringify({at: staged.at(t), rows: model.entities.map(row => [staged.rowPresence(row.id, t), staged.local(row.id, t)])})
      for (const {start, end} of holds) {
        // Boundaries belong to both a hold and a window; sample the open interval.
        const graphAt = JSON.stringify(graph((start + end) / 2)),
          stagedAt = stagedFrame((start + end) / 2)
        for (let index = 1; index < 20; index++) {
          const t = start + ((end - start) * index) / 20
          assert.equal(JSON.stringify(graph(t)), graphAt, `${fixture} ${removed}/${added}: graph moves inside the hold at ${t}`)
          assert.equal(stagedFrame(t), stagedAt, `${fixture} ${removed}/${added}: staged rows move inside the hold at ${t}`)
        }
      }
    }
  }
})

test('a custom comparator order changes the visual order', async () => {
  const {before, after} = build(star)(2, 2)
  const comparison = await compare(before, after)
  assert.deepEqual(
    comparison.steps.map(step => step.kind),
    ['remove', 'add'],
  )
  // As the priority-order example comparator would: the step changing new0 first.
  const reordered = {...comparison, steps: [...comparison.steps].reverse()}
  for (const [candidate, first] of [
    [comparison, 'remove'],
    [reordered, 'add'],
  ]) {
    const model = comparisonModel(before, after, candidate)
    const schedule = scheduleSteps(model)
    const graph = await createGraphTransition(model, schedule)
    const visible = t =>
      new Set(
        graph(t)
          .nodes.filter(node => node.opacity > 0.999)
          .map(node => node.id),
      )
    const settled = visible(stepEnds(schedule)[0])
    if (first === 'remove') assert.ok(!settled.has('old0') && !settled.has('new0'), 'removals first')
    else assert.ok(settled.has('old0') && settled.has('new0'), 'arrivals first, departures after')
  }
})

test('an explicit reverse order is presented when playing backward, through the direction latch', async () => {
  const {before, after} = build(star)(2, 2)
  const comparison = await compare(before, after)
  // Backward, undo the removal first (restore old*), then remove the arrivals.
  const remove = comparison.steps.find(step => step.kind === 'remove'),
    add = comparison.steps.find(step => step.kind === 'add')
  const explicit = {
    ...comparison,
    order: {reverse: 'explicit'},
    reverseSteps: [
      {...remove, kind: 'add'},
      {...add, kind: 'remove'},
    ],
  }
  const model = comparisonModel(before, after, explicit)
  const latch = new DirectionLatch()
  const direction = latch.update(1, -1)
  const schedule = scheduleSteps(model, direction)
  const graph = await createGraphTransition(model, schedule)
  const visible = t =>
    new Set(
      graph(t)
        .nodes.filter(node => node.opacity > 0.999)
        .map(node => node.id),
    )
  const ends = stepEnds(schedule, -1)
  // Leaving progress 1, the first hold point shows old* restored while new* is still present.
  const first = visible(ends.at(-1))
  assert.ok(first.has('old0') && first.has('new0'))
  const second = visible(ends[0])
  assert.ok(second.has('old0') && !second.has('new0'))
  // The mirror order presents the opposite at the same point: removals undone last, so neither side shows.
  const mirror = await createGraphTransition(
    comparisonModel(before, after, comparison),
    scheduleSteps(comparisonModel(before, after, comparison), -1),
  )
  const mirrored = new Set(
    mirror(ends.at(-1))
      .nodes.filter(node => node.opacity > 0.999)
      .map(node => node.id),
  )
  assert.ok(!mirrored.has('old0') && !mirrored.has('new0'))
  // Endpoints agree whichever schedule is presented.
  for (const t of [0, 1]) {
    assert.equal(
      JSON.stringify(graph(t).nodes.map(node => [node.id, node.opacity])),
      JSON.stringify((await createGraphTransition(model, scheduleSteps(model, 1)))(t).nodes.map(node => [node.id, node.opacity])),
    )
  }
  assert.equal(latch.update(0.5, 1), -1, 'the latch keeps the backward timeline until an endpoint')
})

test("change emphasis is scoped to each change's own step, neutral at the endpoints and mirrored for explicit reverse order", async () => {
  const {stepEmphasis} = await import('../dist/index.js')
  const {diffEmphasis} = await import('@githubnext/projections-renderer-sdk/presentation')
  const {before, after} = build(star)(2, 2)
  const comparison = await compare(before, after)
  const model = comparisonModel(before, after, comparison)
  const schedule = scheduleSteps(model)
  const [removal, addition] = schedule
  const row = id => model.entities.find(item => item.id === id)
  for (let index = 0; index <= 200; index++) {
    const t = index / 200
    const emphasis = stepEmphasis(schedule, t, diffEmphasis(t))
    if (t < addition.time - addition.radius) assert.equal(emphasis(row('new0')), 0, `an arrival is not tinted before its step at ${t}`)
    if (t < removal.time - removal.radius) assert.equal(emphasis(row('old0')), 0, `a removal is not tinted before its step at ${t}`)
    if (t > addition.time - addition.radius * 0.4 && t < 0.88) {
      assert.ok(emphasis(row('new0')) > 0.99 * diffEmphasis(t), `rises with its window at ${t}`)
    }
    assert.equal(emphasis(row('keep')), 0, 'unchanged rows are never tinted')
  }
  for (const t of [0, 1]) {
    for (const id of ['old0', 'new0']) assert.equal(stepEmphasis(schedule, t, diffEmphasis(t))(row(id)), 0, `neutral at ${t}`)
  }
  // Explicit reverse order: travelling backward, a change is untinted until its backward step begins.
  const explicit = comparisonModel(before, after, {...comparison, order: {reverse: 'explicit'}, reverseSteps: [...comparison.steps]})
  const backward = scheduleSteps(explicit, -1)
  const restore = backward.find(step => step.entities.includes('old0'))
  assert.equal(restore.travel, -1)
  const late = restore.time + restore.radius + 0.01
  assert.equal(stepEmphasis(backward, late, 1)(row('old0')), 0, 'leaving progress 1, the removal is not tinted before its backward step')
  assert.equal(stepEmphasis(backward, restore.time - restore.radius - 0.01, 1)(row('old0')), 1)
  // The mirror order is direction-independent: the same rule as forward.
  assert.equal(stepEmphasis(scheduleSteps(model, -1), late, 1)(row('old0')), stepEmphasis(schedule, late, 1)(row('old0')))
})

test('a removal is emphasized and fully present for a readable hold before it leaves, then the layout closes', async () => {
  const {stepEmphasis} = await import('../dist/index.js')
  const {diffEmphasis} = await import('@githubnext/projections-renderer-sdk/presentation')
  for (const [fixture, states] of fixtures) {
    const {before, after} = states(2, 2)
    const model = comparisonModel(before, after, await compare(before, after))
    const schedule = scheduleSteps(model)
    const removal = schedule.find(step => step.entities.includes('old0'))
    assert.ok(removal.lead > 0, `${fixture}: a removing step reads before it moves`)
    assert.ok(
      schedule.every(step => step.lead > 0 === step.removes && step.tail === 0),
      `${fixture}: only removals read`,
    )
    const graph = await createGraphTransition(model, schedule)
    const staged = createStagedTimeline(model, schedule)
    const row = model.entities.find(item => item.id === 'old0')
    const edge = model.relationships.find(item => item.id === 'edge:old0')
    let emphasized, fading, edgeFading, closing
    for (let index = 0; index <= 4000; index++) {
      const t = index / 4000
      const emphasis = stepEmphasis(schedule, t, diffEmphasis(t))
      const frame = graph(t)
      const node = frame.nodes.find(item => item.id === 'old0')
      const link = frame.edges.find(item => item.id === 'edge:old0')
      if (emphasized === undefined && emphasis(row) > 0 && emphasis(row) >= 0.99 * diffEmphasis(t)) {
        emphasized = t
        assert.ok(emphasis(edge) >= 0.99 * diffEmphasis(t), `${fixture}: the removed edge is emphasized with its endpoint`)
      }
      fading ??= !node || node.opacity < 1 ? t : undefined
      edgeFading ??= !link || link.opacity < 1 ? t : undefined
      closing ??= staged.rowPresence('old0', t).size < 1 ? t : undefined
      if (fading === undefined) assert.equal(staged.rowPresence('old0', t).opacity, 1, `${fixture}: staged rows fade with graph cards`)
    }
    // At least half a second at the host's default travel: 1.5 s per slot, between 4.5 and 20 s (`defaultDuration`).
    const travel = Math.min(20000, Math.max(4500, timelineSlots(schedule) * 1500))
    assert.ok((fading - emphasized) * travel >= 500, `${fixture}: fully emphasized from ${emphasized}, fading from ${fading}`)
    assert.ok(edgeFading >= fading - 1e-9, `${fixture}: the removed edge leaves with its card, not before`)
    assert.ok(closing > fading, `${fixture}: the gap closes only after the card has faded`)
  }
})

test('compiled windows with reading leads never overlap, keep one hold between them and mirror on reversal', () => {
  for (let count = 1; count <= 12; count++) {
    const steps = Array.from({length: count}, (_, index) => ({index, lead: index % 3 !== 1, tail: index % 2 === 1}))
    const options = {lead: step => step.lead, tail: step => step.tail}
    const schedule = compileTimeline(steps, options)
    const mirrored = compileTimeline([...steps].reverse(), options)
    for (const [index, step] of schedule.entries()) {
      assert.ok(step.time - step.radius >= 0 && step.time + step.radius <= 1)
      assert.ok(steps[index].lead ? step.lead > 0 : step.lead === 0)
      assert.ok(steps[index].tail ? step.tail > 0 : step.tail === 0)
      assert.ok(step.lead + step.tail < 2 * step.radius, 'every window keeps room to move')
      assert.ok(Math.abs(step.time - (1 - mirrored[count - 1 - index].time)) < 1e-12)
      if (index) {
        const gap = step.time - step.radius - (schedule[index - 1].time + schedule[index - 1].radius)
        assert.ok(Math.abs(gap - step.hold) < 1e-12)
      }
    }
    if (count) assert.ok(schedule[0].time - schedule[0].radius >= schedule[0].hold - 1e-12)
  }
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  compileTimeline,
  createFrame,
  DirectionLatch,
  hasTestCounts,
  presentComparison,
  scheduleSteps,
  statisticsCount,
  statisticsRows,
  stepEnds,
  stepHoldShare,
  stepHolds,
  stepProgress,
  timelineSlots,
} from '../dist/presentation.js'

const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const entity = (id, data) => ({id, kind: 'service', label: id, ...(data ? {data} : {})})
const before = extraction([entity('a'), entity('b')], [{id: 'ab', kind: 'calls', from: 'a', to: 'b'}])
const after = extraction([entity('a'), entity('c')], [{id: 'ac', kind: 'calls', from: 'a', to: 'c'}])
const comparison = {
  protocolVersion: 0,
  changes: [
    {id: 'b', collection: 'entities', before: ['b'], after: [], status: 'removed', correspondence: 'none'},
    {id: 'ab', collection: 'relationships', before: ['ab'], after: [], status: 'removed', correspondence: 'none'},
    {id: 'c', collection: 'entities', before: [], after: ['c'], status: 'added', correspondence: 'none'},
    {id: 'ac', collection: 'relationships', before: [], after: ['ac'], status: 'added', correspondence: 'none'},
  ],
  steps: [
    {changes: ['b', 'ab'], kind: 'remove'},
    {changes: ['c', 'ac'], kind: 'add'},
  ],
}
const visible = frame =>
  frame.nodes
    .filter(node => node.opacity > 0.999)
    .map(node => node.id)
    .toSorted()

test('presented changes carry the comparison steps resolved to rows', () => {
  const presented = presentComparison(before, after, comparison)
  assert.deepEqual(
    presented.steps.map(step => [step.kind, step.entities, step.relationships]),
    [
      ['remove', ['b'], ['ab']],
      ['add', ['c'], ['ac']],
    ],
  )
  assert.equal(presented.reverse, 'mirror')
})

test('the hold policy separates step windows and step ends land in the holds', () => {
  const schedule = compileTimeline([{}, {}, {}])
  for (let index = 1; index < schedule.length; index++) {
    const gap = schedule[index].time - schedule[index].radius - schedule[index - 1].time - schedule[index - 1].radius
    assert.ok(Math.abs(gap - schedule[index].hold) < 1e-12)
    assert.ok(Math.abs(schedule[index].hold - (schedule[index].time - schedule[index - 1].time) * stepHoldShare) < 1e-12)
  }
  const ends = stepEnds(schedule)
  for (const [index, end] of ends.entries()) assert.equal(stepProgress(schedule[index], end), 1)
})

test('frames follow the comparison steps and hold still between them', () => {
  const presented = presentComparison(before, after, comparison)
  const schedule = scheduleSteps(presented)
  const [removed, added] = stepEnds(schedule)
  assert.deepEqual(visible(createFrame(after, presented, 0)), ['a', 'b'])
  assert.deepEqual(visible(createFrame(after, presented, removed)), ['a'])
  assert.deepEqual(visible(createFrame(after, presented, added)), ['a', 'c'])
  for (const {start, end} of stepHolds(schedule)) {
    const still = t => {
      const {nodes, edges, staged} = createFrame(after, presented, t)
      return JSON.stringify({
        staged,
        nodes: nodes.map(({emphasis: _, ...node}) => node),
        edges: edges.map(({emphasis: _, ...edge}) => edge),
      })
    }
    const reference = still((start + end) / 2)
    for (let index = 1; index < 10; index++) {
      assert.equal(still(start + ((end - start) * index) / 10), reference, `motion inside ${start}..${end}`)
    }
  }
  // Relationships never outlive their endpoints.
  for (let index = 0; index <= 100; index++) {
    const frame = createFrame(after, presented, index / 100)
    const opacity = new Map(frame.nodes.map(node => [node.id, node.opacity]))
    for (const edge of frame.edges) assert.ok(edge.opacity <= Math.min(opacity.get(edge.from) ?? 0, opacity.get(edge.to) ?? 0) + 1e-9)
  }
})

/**
 * Samples `presented` densely and returns, for an item, the progress at which its emphasis first reaches full
 * strength and the progress at which its opacity first drops, travelling forward from 0.
 */
function reading(presented, id, collection = 'nodes', options = {}) {
  let emphasized, fading
  for (let index = 0; index <= 4000; index++) {
    const t = index / 4000
    const frame = createFrame(after, presented, t, options)
    const item = frame[collection].find(entry => entry.id === id)
    if (!item) break
    if (emphasized === undefined && item.emphasis >= 0.99 * frame.emphasis && item.emphasis > 0) emphasized = t
    if (item.opacity < 1) {
      fading = t
      break
    }
  }
  return {emphasized, fading}
}

test('a removal is emphasized and fully present for a readable hold before it starts to leave', () => {
  const presented = presentComparison(before, after, comparison)
  const [removal, addition] = scheduleSteps(presented)
  assert.ok(removal.lead > 0, 'a step that removes something reads before it moves')
  assert.equal(addition.lead, 0, 'an addition needs no reading lead')
  assert.equal(addition.tail, 0, 'nor a reading tail: it stays emphasized through the hold after its step')
  // The host's default pace counts the reading lead's slots, so reading never speeds up the motion.
  assert.equal(timelineSlots(scheduleSteps(presented)), 3)
  // The host's default travel: 1.5 s per slot, at least 4.5 s and at most 20 s (`defaultDuration`).
  const travel = Math.min(20000, Math.max(4500, timelineSlots(scheduleSteps(presented)) * 1500))
  for (const [id, collection] of [
    ['b', 'nodes'],
    ['ab', 'edges'],
  ]) {
    const {emphasized, fading} = reading(presented, id, collection)
    assert.ok(emphasized !== undefined && fading !== undefined, `${id} is emphasized, then leaves`)
    assert.ok((fading - emphasized) * travel >= 500, `${id} is fully emphasized from ${emphasized} but starts fading at ${fading}`)
  }
  // Nothing moves in the lead: it is a still frame with emphasis rising, then held.
  const motion = t => {
    const {nodes, edges, staged} = createFrame(after, presented, t)
    return JSON.stringify({
      staged,
      nodes: nodes.map(({emphasis: _e, rise: _r, ...node}) => node),
      edges: edges.map(({emphasis: _e, rise: _r, ...edge}) => edge),
    })
  }
  const start = removal.time - removal.radius
  for (let index = 1; index < 10; index++) assert.equal(motion(start + (removal.lead * index) / 10), motion(start + removal.lead / 2))
  // An addition fades in emphasized, and its emphasis outlasts the fade-in.
  const arrival = t => createFrame(after, presented, t).nodes.find(node => node.id === 'c')
  const shown = stepEnds(scheduleSteps(presented))[1]
  assert.equal(arrival(shown).opacity, 1)
  assert.ok(arrival(shown).emphasis > 0.99, 'an arrival keeps its emphasis after it has faded in')
  // The end state carries no diff highlighting.
  assert.ok(createFrame(after, presented, 1).nodes.every(node => node.emphasis === 0))
})

test('an explicit reverse order reads what it takes away travelling backward', () => {
  const explicit = presentComparison(before, after, {
    ...comparison,
    order: {reverse: 'explicit'},
    reverseSteps: comparison.steps.toReversed(),
  })
  const backward = scheduleSteps(explicit, -1)
  const unadd = backward.find(step => step.entities.includes('c'))
  const unremove = backward.find(step => step.entities.includes('b'))
  // Backward, the arrival is what leaves: it is read in the tail, the part of its window backward travel enters first.
  assert.ok(unadd.tail > 0 && unadd.lead === 0 && unremove.lead === 0 && unremove.tail === 0)
  // Leaving progress 1, c is emphasized and present through the reading part at the high end of its window.
  const top = unadd.time + unadd.radius
  const frame = t => createFrame(after, explicit, t, {direction: -1}).nodes.find(node => node.id === 'c')
  const held = top - unadd.tail * 0.5
  assert.equal(frame(held).opacity, 1)
  assert.ok(frame(held).rise > 0.99)
  assert.ok(frame(top - unadd.tail - 0.02).opacity < 1, 'c leaves after it has been read')
})

test('a custom comparator order changes the visual order, and an explicit reverse order is followed backward', () => {
  const reordered = presentComparison(before, after, {...comparison, steps: comparison.steps.toReversed()})
  const [first] = stepEnds(scheduleSteps(reordered))
  assert.deepEqual(visible(createFrame(after, reordered, first)), ['a', 'b', 'c'], 'c arrives before b leaves')

  const explicit = presentComparison(before, after, {...comparison, order: {reverse: 'explicit'}, reverseSteps: [...comparison.steps]})
  const latch = new DirectionLatch()
  const direction = latch.update(1, -1)
  const backward = scheduleSteps(explicit, direction)
  const leaving = stepEnds(backward, -1).at(-1)
  assert.deepEqual(visible(createFrame(after, explicit, leaving, {direction})), ['a', 'b', 'c'], 'backward, b returns before c leaves')
  assert.deepEqual(visible(createFrame(after, explicit, leaving)), ['a'], 'the mirror order removes c first')
})

test('hand-built pairs without steps change together in one step; extractions are complete', () => {
  const {steps: _steps, reverse: _reverse, ...pairs} = presentComparison(before, after, comparison)
  assert.deepEqual(visible(createFrame(after, pairs, 0)), ['a', 'b'])
  assert.deepEqual(visible(createFrame(after, pairs, 1)), ['a', 'c'])
  assert.equal(createFrame(after, pairs, 0.5).schedule.length, 1)
  const single = createFrame(after)
  assert.deepEqual([single.progress, single.staged, single.schedule.length], [1, 1, 0])
  assert.ok(single.nodes.every(node => node.local === 1 && node.opacity === 1))
})

test('code statistics count all files, tests or the rest, each language at its own step', () => {
  const language = (id, data) => ({id, kind: 'language', label: id, data})
  const ts = data => language('ts', data)
  const statsBefore = {
    ...extraction([ts({files: 10, code: 100, testFiles: 4, testCode: 40}), language('go', {files: 2, code: 20})]),
    schema: 'metrics/v0',
  }
  const statsAfter = {
    ...extraction([ts({files: 12, code: 160, testFiles: 6, testCode: 90}), language('go', {files: 2, code: 30})]),
    schema: 'metrics/v0',
  }
  assert.equal(statisticsCount(statsBefore.entities[0], 'code', 'tests'), 40)
  assert.equal(statisticsCount(statsBefore.entities[0], 'code', 'other'), 60)
  assert.equal(statisticsCount(statsBefore.entities[1], 'code', 'tests'), undefined, 'no test counts is unknown, not zero')
  assert.equal(hasTestCounts(statsBefore.entities), true)
  assert.equal(hasTestCounts([statsBefore.entities[1]]), false)
  const changes = {
    protocolVersion: 0,
    changes: [
      {id: 'ts', collection: 'entities', before: ['ts'], after: ['ts'], status: 'modified', correspondence: 'exact'},
      {id: 'go', collection: 'entities', before: ['go'], after: ['go'], status: 'modified', correspondence: 'exact'},
    ],
    steps: [{changes: ['go']}, {changes: ['ts']}],
  }
  const presented = presentComparison(statsBefore, statsAfter, changes)
  const [goDone] = stepEnds(scheduleSteps(presented))
  const rows = statisticsRows(createFrame(statsAfter, presented, goDone), {
    measure: 'code',
    chart: 'bars',
    byLanguage: true,
    scope: 'other',
  })
  assert.deepEqual(
    rows.map(row => [row.id, row.value]),
    [
      ['go', undefined],
      ['ts', 60],
    ],
    'ts has not changed yet; go has no split',
  )
  const all = statisticsRows(createFrame(statsAfter, presented, goDone), {measure: 'code', chart: 'bars', byLanguage: true, scope: 'all'})
  assert.deepEqual(
    all.map(row => [row.id, row.value]),
    [
      ['go', 30],
      ['ts', 100],
    ],
  )
})

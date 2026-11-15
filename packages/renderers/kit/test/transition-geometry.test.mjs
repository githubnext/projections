import {test} from 'node:test'
import assert from 'node:assert/strict'
import {comparisonModel, compileTimeline, createGraphTransition, scheduleSteps} from '../dist/index.js'
import {compare, entity, extraction, relationship} from './engine.mjs'

const {emptiedBoundaries} = await import('../browser/fixtures.ts')

/** Both directions of a comparison, as compound graph transitions. */
/**
 * The schedule without reading time. Reading is one-sided (a removal is read before it leaves, an arrival is not
 * held), so a reverse comparison mirrors the motion and fades, not the reading.
 */
const unread = model => compileTimeline(model.steps).map(step => ({...step, travel: 1}))

async function both(before, after, schedule = scheduleSteps) {
  const result = []
  for (const [a, b] of [
    [before, after],
    [after, before],
  ]) {
    const model = comparisonModel(a, b, await compare(a, b))
    result.push({model, transition: await createGraphTransition(model, schedule(model), {compound: true})})
  }
  return result
}

/** Each boundary's members, in any layout of the transition, and whether one row contains another. */
function containment(transition) {
  const parent = new Map()
  for (const layout of transition.layouts)
    for (const [group, children] of layout.groups) for (const child of children) parent.set(child, group)
  return (child, ancestor) => {
    for (let at = parent.get(child); at !== undefined; at = parent.get(at)) if (at === ancestor) return true
    return false
  }
}

/** Visible boxes that overlap at `progress` without one containing the other. */
function collisions(transition, within, progress) {
  const nodes = transition(progress).nodes
  const found = []
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j]
      if (within(a.id, b.id) || within(b.id, a.id)) continue
      const x = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2)
      const y = Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2)
      if (x > 0.5 && y > 0.5) found.push(`${progress}: ${a.id} / ${b.id}`)
    }
  return found
}

const samples = Array.from({length: 401}, (_, index) => index / 400)

test('no boundary or card passes through another, and an emptied boundary stays a boundary', async () => {
  const {before, after} = emptiedBoundaries()
  for (const {transition} of await both(before, after)) {
    const within = containment(transition)
    const boundaries = new Set(transition.diff.nodes.filter(node => node.group).map(node => node.id))
    assert.ok(boundaries.has('ns:accounts') && boundaries.has('ns:events'), 'the fixture empties boundaries')
    for (const t of samples) {
      assert.deepEqual(collisions(transition, within, t), [])
      for (const node of transition(t).nodes) if (boundaries.has(node.id)) assert.ok(node.group, `${node.id} turns into a card at ${t}`)
    }
  }
})

test('namespaces losing and gaining methods move without collisions', async () => {
  // Deterministic variety: namespaces of methods that require scopes, with methods leaving and arriving.
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let trial = 0; trial < 8; trial++) {
    const spaces = 3 + Math.floor(random() * 5),
      scopes = 2 + Math.floor(random() * 4)
    const methods = []
    for (let space = 0; space < spaces; space++)
      for (let index = 0, count = 1 + Math.floor(random() * 3); index < count; index++)
        methods.push({
          id: `m${space}.${index}`,
          space: `ns${space}`,
          scope: `scope${Math.floor(random() * scopes)}`,
          gone: random() < 0.4,
          fresh: random() < 0.2,
        })
    const side = skip => {
      const kept = methods.filter(method => !method[skip])
      return extraction(
        'architecture/v0',
        [
          ...Array.from({length: scopes}, (_, index) => entity(`scope${index}`, 'scope')),
          ...Array.from({length: spaces}, (_, index) => entity(`ns${index}`, 'module')),
          ...kept.map(method => entity(method.id, 'method')),
        ],
        kept.flatMap(method => [
          relationship(`contains:${method.id}`, method.space, method.id, 'contains'),
          relationship(`requires:${method.id}`, method.id, method.scope, 'requires'),
        ]),
      )
    }
    for (const {transition} of await both(side('fresh'), side('gone'))) {
      const within = containment(transition)
      for (const t of samples.filter((_, index) => index % 2 === 0))
        assert.deepEqual(collisions(transition, within, t), [], `trial ${trial}`)
    }
  }
})

test('a leaving card fades evenly through its window, and its relationships never outlast it', async () => {
  const {before, after} = emptiedBoundaries()
  const [forward] = await both(before, after)
  const id = 'catalog.price'
  const percent = Array.from({length: 101}, (_, index) => index / 100)
  const opacity = (transition, t) => transition(t).nodes.find(node => node.id === id)?.opacity ?? 0
  const fading = percent.filter(t => opacity(forward.transition, t) > 0.05 && opacity(forward.transition, t) < 0.95)
  assert.ok(fading.length >= 3, `visibly translucent at 1% steps (${fading.join(', ')})`)
  const fine = samples.map(t => opacity(forward.transition, t))
  for (let index = 1; index < fine.length; index++) assert.ok(fine[index] <= fine[index - 1] + 1e-9, 'a leaving card never returns')
  // Halfway through its fade it is half there, not still nearly opaque.
  const start = samples[fine.findIndex(value => value < 1)],
    end = samples[fine.findIndex(value => value === 0)]
  assert.ok(Math.abs(opacity(forward.transition, (start + end) / 2) - 0.5) < 0.15)
  for (const t of samples) {
    const card = opacity(forward.transition, t)
    for (const edge of forward.transition(t).edges.filter(edge => edge.fromId === id || edge.toId === id))
      assert.ok(edge.opacity <= card + 1e-9, `${edge.key} outlasts its card at ${t}`)
  }
  // Without reading time, the reverse comparison draws the same fade in, mirrored.
  const [motion, mirror] = await both(before, after, unread)
  for (const t of samples) assert.ok(Math.abs(opacity(motion.transition, t) - opacity(mirror.transition, 1 - t)) < 1e-6)
})

test('Before and After draw their own boundaries, even when components move between modules', async () => {
  const contains = (from, to) => relationship(`${from}->${to}`, from, to, 'contains')
  const parts = ['web', 'api', 'db', 'blobs']
  const side = storage =>
    extraction(
      'architecture/v0',
      [entity('application', 'module'), ...(storage ? [entity('storage', 'module')] : []), ...parts.map(id => entity(id, 'component'))],
      [
        ...parts.map(id => contains(storage && (id === 'db' || id === 'blobs') ? 'storage' : 'application', id)),
        relationship('web->api', 'web', 'api', 'references'),
        relationship('api->db', 'api', 'db', 'references'),
      ],
    )
  for (const {transition} of await both(side(false), side(true)))
    for (const t of [0, 1]) {
      const groups = transition(t)
        .nodes.filter(node => node.group)
        .map(node => node.id)
        .sort()
      const expected = transition(t).nodes.some(node => node.id === 'storage') ? ['application', 'storage'] : ['application']
      assert.deepEqual(groups, expected, `boundaries at ${t}`)
    }
})

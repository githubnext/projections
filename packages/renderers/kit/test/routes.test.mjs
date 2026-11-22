import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {
  arrowEnding,
  arrowHead,
  arrowHeadLeadIn,
  arrowHeadLength,
  arrowHeadStrokeWidth,
  cardBox,
  comparisonModel,
  createGraphTransition,
  drawnEdge,
  interpolateSpline,
  layoutGraph,
  lineSpline,
  roundedSpline,
  routesCross,
  sampleSpline,
  sBend,
  scheduleSteps,
  arrowHeadReach,
  cardBorderOutset,
  routeRadius,
  sTurn,
  trackSpacing,
  portInset,
} from '../dist/index.js'
import {
  crowdedRuns,
  diagonalStraights,
  draftingIssues,
  inflections,
  largestDeviation,
  largestKink,
  largestTurn,
  minimumRadius,
  portIssues,
  straightSegments,
} from './quality.mjs'
import {cardWidths, compare, sizedNodes} from './engine.mjs'

const fixture = async name => JSON.parse(await readFile(new URL(`../../graph/fixtures/${name}.json`, import.meta.url), 'utf8'))
const infrastructure = {compound: ['module', 'resource-group', 'resource']}
const layoutOf = async (extraction, options) => layoutGraph(await sizedNodes(extraction.entities), extraction.relationships, options)
const unit = (a, b) => {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return length < 1e-6 ? undefined : {x: (b.x - a.x) / length, y: (b.y - a.y) / length}
}

/** Joins where a route turns abruptly: the tangent leaving one segment differs from the one entering the next. */
function kinks(route) {
  const found = []
  for (let index = 3; index + 1 < route.length; index += 3) {
    const before = unit(route[index - 1], route[index]) ?? unit(route[index - 3], route[index])
    const after = unit(route[index], route[index + 1]) ?? unit(route[index], route[index + 3])
    if (before && after && before.x * after.x + before.y * after.y < Math.cos((10 * Math.PI) / 180)) found.push(route[index])
  }
  return found
}

test('rounded orthogonal routes are one smooth chain through every corner of the polyline', () => {
  const polyline = [
    {x: 0, y: 0},
    {x: 0, y: 40},
    {x: 0, y: 40},
    {x: 120, y: 40},
    {x: 120, y: 44},
    {x: 126, y: 44},
    {x: 126, y: 140},
  ]
  const route = roundedSpline(polyline)
  assert.equal((route.length - 1) % 3, 0)
  assert.deepEqual(route[0], polyline[0])
  assert.deepEqual(route.at(-1), polyline.at(-1))
  assert.deepEqual(kinks(route), [])
  // A short jog stays a small wave: no point strays outside the polyline's bounds.
  for (const point of route) assert.ok(point.x >= -1e-9 && point.x <= 126 + 1e-9 && point.y >= -1e-9 && point.y <= 140 + 1e-9)
})

test('compound layouts route every relationship as one smooth curve, with no stitched kinks or stair-steps', async () => {
  for (const name of ['terraform-before', 'terraform-after', 'azure-before', 'azure-after', 'platform-before', 'platform-after']) {
    const layout = await layoutOf(await fixture(name), name.startsWith('platform') ? {compound: true} : infrastructure)
    for (const [id, route] of layout.routes) assert.deepEqual(kinks(route), [], `${name}: ${id}`)
  }
})

const scenarios = [
  ['terraform', infrastructure],
  ['azure', infrastructure],
  ['service-platform', {}],
  ['platform', {compound: true}],
  ['nuget', {orientation: 'horizontal'}],
]
const axisOf = options => (options.orientation === 'horizontal' ? {x: 1, y: 0} : {x: 0, y: 1})

/** Cards a route passes through (other than its own), or within the router's clearance of. */
function crossedCards(layout, route, own) {
  const samples = sampleSpline(route, 3)
  return [...layout.points.keys()]
    .filter(id => !layout.groups.has(id) && !own.includes(id))
    .filter(id => {
      const point = layout.points.get(id),
        size = layout.sizes.get(id)
      return samples.some(sample => Math.abs(sample.x - point.x) < size.width / 2 + 2 && Math.abs(sample.y - point.y) < size.height / 2 + 2)
    })
}

/** The S a direct route was drawn as (see `RoutePorts.bend`), or undefined for a route around cards. */
function turnOf(route, ports, axis) {
  if (!ports?.bend) return undefined
  const start = route[0],
    end = route.at(-1)
  const span = (end.x - start.x) * axis.x + (end.y - start.y) * axis.y - arrowHeadReach
  return sTurn(start, end, axis, {band: [ports.bend[0], span - ports.bend[1]], track: ports.track ?? 0})
}

test('every route is drafted: perpendicular stubs, quarter-circle turns as wide as the gap allows, runs square to the layers, one inflection unless cards stand in the way', async () => {
  for (const [name, options] of scenarios) {
    for (const side of ['before', 'after']) {
      const extraction = await fixture(`${name}-${side}`)
      const layout = await layoutOf(extraction, options)
      const axis = axisOf(options)
      for (const edge of extraction.relationships) {
        const route = layout.routes.get(edge.id)
        if (!route) continue
        const label = `${name}-${side} ${edge.id}`
        assert.ok(largestKink(route) < 0.5, `${label}: kink of ${largestKink(route).toFixed(2)}°`)
        // No straight stretch is diagonal, and the route never doubles back against its direction of travel.
        assert.deepEqual(diagonalStraights(route), [], `${label}: diagonal straight`)
        assert.ok(largestDeviation(route, axis) <= 90.5, `${label}: doubles back (${largestDeviation(route, axis).toFixed(1)}°)`)
        // It leaves its source and enters its target perpendicular to their faces.
        const [first] = straightSegments(route.slice(0, 4)),
          [last] = straightSegments(route.slice(-4))
        if (first) {
          assert.ok(Math.abs(first.direction.x * axis.x + first.direction.y * axis.y) > 0.9999, `${label}: tail stub not perpendicular`)
        }
        assert.ok(last && Math.abs(last.direction.x * axis.x + last.direction.y * axis.y) > 0.9999, `${label}: lead not perpendicular`)
        const turn = turnOf(route, layout.ports.get(edge.id), axis)
        if (turn) {
          // Both turns have the S's radius: the largest the gap allows, up to the kit's.
          const limit = Math.min(routeRadius, turn.middle - turn.band[0], turn.band[1] - turn.middle)
          assert.ok(minimumRadius(route) >= limit - 0.5, `${label}: radius ${minimumRadius(route).toFixed(1)} < ${limit.toFixed(1)}`)
          // Quarter circles, unless the offset is under two radii (then two shallower arcs meet, with no run between).
          if (Math.abs(turn.across) >= 2 * turn.radius + 0.5) {
            assert.ok(Math.abs(largestTurn(route) - 90) < 1, `${label}: turns ${largestTurn(route).toFixed(1)}°, not 90°`)
          }
        } else if (route.length > 4) assert.ok(minimumRadius(route) >= 4, `${label}: radius ${minimumRadius(route).toFixed(1)}`)
        if (inflections(route) <= 1) continue
        // More than one inflection only where a single S between the same ports would cross a card.
        const single = sBend(route[0], route.at(-1), axis)
        assert.ok(!single || crossedCards(layout, single, [edge.from, edge.to]).length, `${label}: needless detour`)
      }
    }
  }
})

test("an S crosses its gap in the gap's middle (shifted only by a track it shares), not against its target", async () => {
  let checked = 0
  for (const [name, options] of scenarios) {
    const extraction = await fixture(`${name}-before`)
    const layout = await layoutOf(extraction, options)
    const axis = axisOf(options)
    for (const edge of extraction.relationships) {
      const route = layout.routes.get(edge.id),
        ports = layout.ports.get(edge.id)
      const turn = route && turnOf(route, ports, axis)
      if (!turn || Math.abs(turn.across) < 2 * turn.radius + 0.5) continue
      // The run across: the one straight stretch square to the axis.
      const run = straightSegments(route).find(segment => Math.abs(segment.direction.x * axis.x + segment.direction.y * axis.y) < 1e-6)
      assert.ok(run, `${name} ${edge.id}: no run across`)
      const along = (run.from.x - route[0].x) * axis.x + (run.from.y - route[0].y) * axis.y
      assert.ok(
        Math.abs(along - turn.middle) < 0.5,
        `${name} ${edge.id}: run at ${along.toFixed(1)}, not its middle ${turn.middle.toFixed(1)}`,
      )
      // Alone in its gap, it crosses at the middle of the room it may turn in.
      if (!ports.track) {
        assert.ok(Math.abs(turn.middle - (turn.band[0] + turn.band[1]) / 2) < 0.5, `${name} ${edge.id}: run off its band's middle`)
      }
      checked++
    }
  }
  assert.ok(checked >= 10, `${checked} routes with a run`)
})

test('routes converging on one card never cross each other', async () => {
  for (const [name, options] of scenarios) {
    for (const side of ['before', 'after']) {
      const extraction = await fixture(`${name}-${side}`)
      const layout = await layoutOf(extraction, options)
      const into = new Map()
      for (const edge of extraction.relationships) {
        if (!layout.routes.has(edge.id)) continue
        into.set(edge.to, [...(into.get(edge.to) ?? []), edge])
      }
      for (const [target, edges] of into) {
        for (let i = 0; i < edges.length; i++) {
          for (let j = i + 1; j < edges.length; j++) {
            const [a, b] = [layout.routes.get(edges[i].id), layout.routes.get(edges[j].id)]
            const shared = edges[i].from === edges[j].from ? [a[0]] : []
            assert.ok(
              !routesCross(a, b, [a.at(-1), b.at(-1), ...shared], shared.length ? 6 : 3),
              `${name}-${side}: into ${target}, ${edges[i].id} crosses ${edges[j].id}`,
            )
          }
        }
        // Ports into one card are distinct.
        const ends = edges.map(edge => layout.routes.get(edge.id).at(-1))
        assert.equal(
          new Set(ends.map(end => `${end.x.toFixed(1)},${end.y.toFixed(1)}`)).size,
          ends.length,
          `${name}-${side}: shared ports into ${target}`,
        )
      }
    }
  }
})

test('while scrubbing, every visible route stays tangent-continuous and never wiggles more than it does at rest', async () => {
  for (const [name, options] of scenarios) {
    const [before, after] = await Promise.all([fixture(`${name}-before`), fixture(`${name}-after`)])
    for (const [from, to] of [
      [before, after],
      [after, before],
    ]) {
      const model = comparisonModel(from, to, await compare(from, to))
      const transition = await createGraphTransition(model, scheduleSteps(model), {
        ...options,
        widths: await cardWidths(model.entities, true),
      })
      const atRest = new Map()
      for (const layout of transition.layouts) {
        for (const [key, route] of layout.routes) atRest.set(key, Math.max(atRest.get(key) ?? 0, inflections(route)))
      }
      const issues = new Set()
      for (let index = 0; index <= 200; index++) {
        for (const edge of transition(index / 200).edges) {
          if (edge.containment || edge.opacity < 0.05) continue
          const kink = largestKink(edge.points)
          if (kink >= 0.5) issues.add(`${edge.key}: kink ${kink.toFixed(2)}° at ${index / 200}`)
          const allowed = Math.max(1, atRest.get(edge.key) ?? atRest.get(edge.id) ?? 0)
          if (inflections(edge.points) > allowed) issues.add(`${edge.key}: ${inflections(edge.points)} inflections at ${index / 200}`)
          // No frame doubles a route back on itself: no cusp, hairpin or reversal.
          const deviation = largestDeviation(edge.points, axisOf(options))
          if (deviation > 90.5) issues.add(`${edge.key}: doubles back (${deviation.toFixed(0)}°) at ${index / 200}`)
        }
      }
      assert.deepEqual([...issues].slice(0, 8), [], `${name}${from === after ? ' (reverse)' : ''}`)
    }
  }
})

test('route morphs pair stretches by position along the route, symmetrically', () => {
  const bend = roundedSpline([
    {x: 0, y: 0},
    {x: 0, y: 100},
    {x: 100, y: 100},
  ])
  const straight = lineSpline({x: 0, y: 0}, {x: 100, y: 100})
  const forward = interpolateSpline(bend, straight, 0.3)
  const backward = interpolateSpline(straight, bend, 0.7)
  assert.equal(forward.length, backward.length)
  forward.forEach((point, index) => assert.ok(Math.hypot(point.x - backward[index].x, point.y - backward[index].y) < 1e-9))
  assert.equal((forward.length - 1) % 3, 0)
  // The bend's corner (half way along it) morphs toward the line's middle, not toward one of its ends.
  const middle = interpolateSpline(bend, straight, 0.5)
  const centre = middle[Math.floor(middle.length / 6) * 3]
  assert.ok(Math.hypot(centre.x - 37.5, centre.y - 62.5) < 20, JSON.stringify(centre))
})

/** The geometry every drawn relationship must have where it meets its arrowhead. */
function arrowIssues(name, drawn, box, tolerance = 1e-6, outset = 0) {
  const issues = []
  const route = drawn.points
  const end = route.at(-1),
    lead = route.at(-4)
  // The shaft ends exactly at the middle of the head's flat base, an arrowhead's length from the tip.
  if (Math.hypot(end.x - drawn.base.x, end.y - drawn.base.y) > tolerance) issues.push(`${name}: shaft ends off the base`)
  if (Math.abs(Math.hypot(drawn.tip.x - drawn.base.x, drawn.tip.y - drawn.base.y) - arrowHeadLength) > 1e-6) {
    issues.push(`${name}: head length`)
  }
  // Its last stretch is straight, collinear with the head's axis, and at least the lead-in long.
  const axis = drawn.direction
  for (const point of route.slice(-4)) {
    const cross = (point.x - drawn.base.x) * axis.y - (point.y - drawn.base.y) * axis.x
    if (Math.abs(cross) > tolerance) issues.push(`${name}: last stretch leaves the head's axis`)
  }
  if (Math.hypot(end.x - lead.x, end.y - lead.y) < arrowHeadLeadIn - outset - tolerance) issues.push(`${name}: lead-in too short`)
  // The head points into the face its tip touches: `outset` outside the box, where the card's border ends.
  const faces = [
    [Math.abs(drawn.tip.y - (box.y - outset)), 0, 1],
    [Math.abs(drawn.tip.y - (box.y + box.height + outset)), 0, -1],
    [Math.abs(drawn.tip.x - (box.x - outset)), 1, 0],
    [Math.abs(drawn.tip.x - (box.x + box.width + outset)), -1, 0],
  ]
  const [distance, nx, ny] = faces.reduce((best, face) => (face[0] < best[0] ? face : best))
  if (distance > 1e-6) issues.push(`${name}: tip off the card's face`)
  if (axis.x * nx + axis.y * ny < 1 - 1e-9) issues.push(`${name}: head not along the face's inward normal`)
  return issues
}

test('arrowheads: the shaft runs straight along the head axis into the middle of the base, for straight, curved and orthogonal routes', () => {
  const box = {x: 100, y: 200, width: 200, height: 84}
  const routes = {
    straight: lineSpline({x: 200, y: 40}, {x: 200, y: 200}),
    // Arrives at an angle: the route must bend into the straight lead-in, not the head.
    curved: [
      {x: 20, y: 20},
      {x: 60, y: 120},
      {x: 180, y: 150},
      {x: 230, y: 200},
    ],
    orthogonal: roundedSpline([
      {x: 40, y: 40},
      {x: 40, y: 150},
      {x: 260, y: 150},
      {x: 260, y: 200},
    ]),
    // Too short a final leg for the lead-in: the route curves earlier.
    'short final leg': roundedSpline([
      {x: 40, y: 40},
      {x: 40, y: 195},
      {x: 260, y: 195},
      {x: 260, y: 200},
    ]),
  }
  for (const [name, route] of Object.entries(routes)) {
    // Touching a border drawn on the box (none outside it), half outside it (a kit card's centred stroke), or wholly outside.
    for (const outset of [0, 0.5, 1]) {
      const ending = arrowEnding(route, box, outset)
      assert.deepEqual(arrowIssues(`${name} (outset ${outset})`, {...ending, points: ending.shaft}, box, 1e-6, outset), [])
      assert.equal((ending.shaft.length - 1) % 3, 0)
      assert.deepEqual(ending.shaft[0], route[0])
    }
  }
  // The head is an equilateral triangle: its inner outline's three sides are equal.
  const head = arrowHead({x: 0, y: 0}, {x: 0, y: 1})
  const corners = [...head.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
  const sides = corners.map((point, index) => Math.hypot(point.x - corners[(index + 1) % 3].x, point.y - corners[(index + 1) % 3].y))
  for (const side of sides) assert.ok(Math.abs(side - sides[0]) < 0.02, JSON.stringify(sides))
  // Rounded by the stroke, its tip touches the target and its flat base is an arrowhead's length back.
  assert.ok(Math.abs(corners[0].y + arrowHeadStrokeWidth / 2 - head.tip.y) < 0.01)
  assert.ok(Math.abs(corners[1].y - arrowHeadStrokeWidth / 2 - head.base.y) < 0.01)
})

test('arrowheads stay attached through every frame of every graph scenario, in both directions', async () => {
  const cases = [
    ['terraform', infrastructure],
    ['azure', infrastructure],
    ['platform', {compound: true}],
    ['service-platform', {}],
  ]
  for (const [name, options] of cases) {
    const [before, after] = await Promise.all([fixture(`${name}-before`), fixture(`${name}-after`)])
    for (const [from, to] of [
      [before, after],
      [after, before],
    ]) {
      const model = comparisonModel(from, to, await compare(from, to))
      const transition = await createGraphTransition(model, scheduleSteps(model), {
        ...options,
        widths: await cardWidths(model.entities, true),
      })
      const issues = new Set()
      for (let index = 0; index <= 200; index++) {
        const frame = transition(index / 200)
        const nodes = new Map(frame.nodes.map(node => [node.id, node]))
        for (const edge of frame.edges.filter(
          candidate => !candidate.containment && nodes.has(candidate.fromId) && nodes.has(candidate.toId),
        )) {
          const target = nodes.get(edge.toId)
          if (target.group || nodes.get(edge.fromId).group) continue
          const drawn = drawnEdge(edge, nodes.get(edge.fromId), target)
          const shaft = [...drawn.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
          // The drawn path is rounded to hundredths.
          const end = shaft.at(-1),
            previous = shaft.at(-2)
          if (Math.hypot(end.x - drawn.base.x, end.y - drawn.base.y) > 0.01) issues.add(`${edge.key} ends off its base at ${index / 200}`)
          const length = Math.hypot(end.x - previous.x, end.y - previous.y)
          if (length > 0.5 && (drawn.direction.x * (end.x - previous.x) + drawn.direction.y * (end.y - previous.y)) / length < 0.999) {
            issues.add(`${edge.key} enters its head at an angle at ${index / 200}`)
          }
          for (const issue of arrowIssues(
            `${edge.key} at ${index / 200}`,
            {...drawn, points: shaftOf(drawn)},
            cardBox(target),
            0.02,
            cardBorderOutset(),
          )) {
            issues.add(issue)
          }
        }
      }
      assert.deepEqual([...issues].slice(0, 8), [], `${name}${from === after ? ' (reverse)' : ''}`)
    }
  }
})

test('scrubbing never slants a straight run: a route whose morph would is redrawn instead, in both directions', async () => {
  const cases = [
    ['terraform', infrastructure],
    ['azure', infrastructure],
    ['platform', {compound: true}],
    ['service-platform', {}],
  ]
  for (const [name, options] of cases) {
    const [before, after] = await Promise.all([fixture(`${name}-before`), fixture(`${name}-after`)])
    for (const [from, to] of [
      [before, after],
      [after, before],
    ]) {
      const model = comparisonModel(from, to, await compare(from, to))
      const transition = await createGraphTransition(model, scheduleSteps(model), {
        ...options,
        widths: await cardWidths(model.entities, true),
      })
      const issues = new Set()
      for (let index = 0; index <= 100; index++) {
        for (const edge of transition(index / 100).edges) {
          if (edge.containment || edge.opacity < 0.05) continue
          // Cards dragging a route a few units may tilt a long run slightly; a slanted stretch is something else.
          const slanted = diagonalStraights(edge.points).filter(
            segment =>
              segment.length > 12 && Math.min(Math.abs(segment.direction.x), Math.abs(segment.direction.y)) > Math.sin(Math.PI / 60),
          )
          if (slanted.length) issues.add(`${edge.key} at ${index / 100}`)
        }
      }
      assert.deepEqual([...issues].slice(0, 8), [], `${name}${from === after ? ' (reverse)' : ''}`)
    }
  }
})

/** A drawn shaft's control points, recovered from its path (`M` then `C` triples). */
function shaftOf(drawn) {
  return [...drawn.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
}

test('diff mode draws the union with the same drafted routes and touching arrowheads, every scenario', async () => {
  for (const [name, options] of scenarios) {
    const [before, after] = await Promise.all([fixture(`${name}-before`), fixture(`${name}-after`)])
    const model = comparisonModel(before, after, await compare(before, after))
    const transition = await createGraphTransition(model, scheduleSteps(model), {
      ...options,
      diffOnly: {},
      widths: await cardWidths(model.entities, true),
    })
    const frame = transition.diff
    const nodes = new Map(frame.nodes.map(node => [node.id, node]))
    const axis = axisOf(options)
    const issues = []
    let drawn = 0
    for (const edge of frame.edges) {
      if (edge.containment || !nodes.has(edge.fromId) || !nodes.has(edge.toId)) continue
      const route = edge.points,
        label = `${name} diff ${edge.key}`
      if (largestKink(route) >= 0.5) issues.push(`${label}: kink`)
      if (diagonalStraights(route).length) issues.push(`${label}: diagonal straight`)
      if (largestDeviation(route, axis) > 90.5) issues.push(`${label}: doubles back`)
      const [last] = straightSegments(route.slice(-4))
      if (!last || Math.abs(last.direction.x * axis.x + last.direction.y * axis.y) < 0.9999) issues.push(`${label}: lead not perpendicular`)
      const target = nodes.get(edge.toId)
      if (target.group || nodes.get(edge.fromId).group) continue
      const arrow = drawnEdge(edge, nodes.get(edge.fromId), target)
      issues.push(...arrowIssues(label, {...arrow, points: shaftOf(arrow)}, cardBox(target), 0.02, cardBorderOutset()))
      drawn++
    }
    assert.ok(drawn > 0, `${name}: no arrows in the diff`)
    assert.deepEqual(issues.slice(0, 8), [], name)
  }
})

test("diff mode, as drafted: every stretch an axis-aligned line or a quarter circle at the standard radius, parallel runs a track apart, no crossings among a card's own routes", async () => {
  const subjects = [
    ['terraform', infrastructure],
    ['azure', infrastructure],
    ['platform', {compound: true}],
    ['service-platform', {}],
  ]
  for (const [name, options] of subjects) {
    const [before, after] = await Promise.all([fixture(`${name}-before`), fixture(`${name}-after`)])
    const model = comparisonModel(before, after, await compare(before, after))
    const transition = await createGraphTransition(model, scheduleSteps(model), {
      ...options,
      diffOnly: {},
      widths: await cardWidths(model.entities, true),
    })
    const edges = transition.diff.edges.filter(edge => !edge.containment)
    const issues = []
    for (const edge of edges) for (const issue of draftingIssues(edge.points, routeRadius)) issues.push(`${edge.key}: ${issue}`)
    issues.push(...crowdedRuns(edges, trackSpacing))
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [a, b] = [edges[i], edges[j]]
        if (a.fromId !== b.fromId) continue
        const shared = [a.points[0], b.points[0], ...(a.toId === b.toId ? [a.points.at(-1), b.points.at(-1)] : [])]
        if (routesCross(a.points, b.points, shared, 6)) issues.push(`${a.key} crosses ${b.key}, which leaves the same card`)
      }
    }
    assert.deepEqual(issues.slice(0, 8), [], name)
  }
})

test('ports on a side divide it evenly (two routes enter at its thirds), clear of its corners, in the order the routes come from; a lone route meets the middle', async () => {
  const subjects = [...scenarios, ['nuget', {orientation: 'horizontal'}]]
  for (const [name, options] of subjects) {
    const axis = axisOf(options)
    const across = point => (axis.y ? point.x : point.y)
    const [before, after] = await Promise.all([fixture(`${name}-before`), fixture(`${name}-after`)])
    const model = comparisonModel(before, after, await compare(before, after))
    const transition = await createGraphTransition(model, scheduleSteps(model), {
      ...options,
      diffOnly: {},
      widths: await cardWidths(model.entities, true),
    })
    const layouts = [
      ['before', await layoutOf(before, options), before.relationships],
      ['after', await layoutOf(after, options), after.relationships],
      [
        'diff',
        transition.layouts[0],
        transition.diff.edges.filter(edge => !edge.containment).map(edge => ({id: edge.key, from: edge.fromId, to: edge.toId})),
      ],
    ]
    for (const [label, layout, edges] of layouts) {
      const into = new Map()
      for (const edge of edges) {
        const route = layout.routes.get(edge.id)
        if (!route || layout.groups.has(edge.to)) continue
        into.set(edge.to, [...(into.get(edge.to) ?? []), {edge, route}])
      }
      for (const [target, list] of into) {
        const point = layout.points.get(target),
          size = layout.sizes.get(target)
        // In the order the routes come from: where they leave their sources.
        const ordered = [...list].toSorted((a, b) => across(a.route[0]) - across(b.route[0]))
        const ports = ordered.map(({route}) => across(route.at(-1)))
        // Routes from one source share a port and may take either order.
        const distinct = ordered.every(
          (item, index) => !index || Math.abs(across(item.route[0]) - across(ordered[index - 1].route[0])) > 0.5,
        )
        const length = axis.y ? size.width : size.height
        const issues = portIssues(
          distinct ? ports : ports.toSorted((a, b) => a - b),
          across(point),
          length,
          length / (ports.length + 1),
          portInset,
        )
        // As far apart as the side allows: its equal parts, or as many as fit between the corners' insets.
        const sorted = ports.toSorted((a, b) => a - b)
        const step = Math.min(length / (ports.length + 1), (length - 2 * portInset) / (ports.length - 1))
        if (ports.length > 1 && Math.abs(sorted[1] - sorted[0] - step) > 0.5) {
          issues.push(`spacing ${(sorted[1] - sorted[0]).toFixed(1)}, not ${step.toFixed(1)}`)
        }
        assert.deepEqual(issues, [], `${name} ${label}: into ${target}`)
      }
    }
  }
})

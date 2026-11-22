import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {
  cardHeight,
  cardWidth,
  comparisonModel,
  arrowHeadLength,
  createGraphTransition,
  extractionModel,
  inflections,
  layoutGraph,
  columnGap,
  nodeSpacing,
  sampleSpline,
  scheduleSteps,
} from '../dist/index.js'
import {cardWidths, compare, entity, extraction, relationship, sizedNodes} from './engine.mjs'

const renderers = new URL('../../', import.meta.url)
const options = {
  graph: {},
  'graph-horizontal': {orientation: 'horizontal'},
  dag: {},
  architecture: {compound: true},
  infrastructure: {compound: ['module', 'resource-group', 'resource']},
}

/**
 * Every revision of every graph, DAG, architecture and infrastructure scenario, as the renderers lay it out.
 * Dependency graph scenarios are left out: that presentation lays out its own collapsed view of the
 * document, and the graph renderer's tests check it.
 */
async function scenarioGraphs() {
  const graphs = []
  for (const bundle of ['graph']) {
    const directory = new URL(`${bundle}/`, renderers)
    const {scenarios} = JSON.parse(await readFile(new URL('scenarios.json', directory), 'utf8'))
    const load = async value => (typeof value === 'string' ? JSON.parse(await readFile(new URL(value, directory), 'utf8')) : value)
    for (const scenario of scenarios) {
      const renderer = scenario.renderer ?? bundle
      if (renderer === 'dependencies') continue
      for (const side of ['before', 'after', 'extraction']) {
        if (!scenario[side]) continue
        const extraction = await load(scenario[side])
        const junctions =
          side === 'extraction' && extraction.schema === 'dag/v0' && extraction.entities.every(entity => entity.kind === 'job')
        graphs.push({name: `${bundle}/${scenario.id} ${side}`, scenario, renderer, extraction, options: {...options[renderer], junctions}})
      }
    }
  }
  return graphs
}

/** A scenario as the renderers lay it out: cards as wide as the graph's text needs (see `graphCardsWidth`). */
const layoutOf = async ({extraction, options}) => layoutGraph(await sizedNodes(extraction.entities), extraction.relationships, options)
const box = (layout, id) => {
  const point = layout.points.get(id),
    size = layout.sizes.get(id)
  return {
    left: point.x - size.width / 2,
    right: point.x + size.width / 2,
    top: point.y - size.height / 2,
    bottom: point.y + size.height / 2,
  }
}

/** Problems with one layout: relationships through cards, and ends off the faces that face along the layers. */
function layoutIssues(layout, edges, orientation) {
  const issues = []
  const cards = [...layout.points.keys()].filter(id => !layout.groups.has(id))
  for (const edge of edges) {
    const route = layout.routes.get(edge.id)
    if (!route) continue
    const [start, end] = [route[0], route.at(-1)]
    for (const [point, id, name] of [
      [start, edge.from, 'leaves'],
      [end, edge.to, 'enters'],
    ]) {
      const card = box(layout, id)
      const onFace =
        orientation === 'horizontal'
          ? (Math.abs(point.x - card.left) < 0.5 || Math.abs(point.x - card.right) < 0.5) &&
            point.y >= card.top - 0.5 &&
            point.y <= card.bottom + 0.5
          : (Math.abs(point.y - card.top) < 0.5 || Math.abs(point.y - card.bottom) < 0.5) &&
            point.x >= card.left - 0.5 &&
            point.x <= card.right + 0.5
      if (!onFace) issues.push(`${edge.id} ${name} ${id} off its ${orientation === 'horizontal' ? 'left/right' : 'top/bottom'} faces`)
    }
    for (const id of cards) {
      // A route may touch its own cards' faces; it never passes through any card.
      const card = box(layout, id),
        inset = id === edge.from || id === edge.to ? 1 : -2
      if (
        sampleSpline(route, 2).some(
          point =>
            point.x > card.left + inset && point.x < card.right - inset && point.y > card.top + inset && point.y < card.bottom - inset,
        )
      ) {
        issues.push(`${edge.id} crosses ${id}`)
      }
    }
  }
  return issues
}

test('scenario layouts route every relationship around the cards, between the faces that face along the layers', async () => {
  for (const graph of await scenarioGraphs()) {
    const layout = await layoutOf(graph)
    const edges = graph.extraction.relationships.filter(edge => !(edge.kind === 'contains' && layout.groups.has(edge.from)))
    assert.equal(layout.routes.size, edges.length, `${graph.name}: every relationship has a route`)
    assert.deepEqual(layoutIssues(layout, edges, graph.options.orientation ?? 'vertical'), [], graph.name)
  }
})

test('a graph whose routes into one card include some with their ends in line, which have no run to trade, lays out', async () => {
  // 43 modules and 84 imports where crossing routes into one card were swapped with trunks that included straight routes.
  const extraction = JSON.parse(await readFile(new URL('fixtures/in-line-trunks.json', import.meta.url), 'utf8'))
  const layout = await layoutGraph(await sizedNodes(extraction.entities), extraction.relationships, {})
  assert.equal(layout.routes.size, extraction.relationships.length)
})

test('layout is deterministic: the same graph in any input order produces the same geometry', async () => {
  for (const graph of await scenarioGraphs()) {
    const shuffled = {
      ...graph,
      extraction: {
        ...graph.extraction,
        entities: [...graph.extraction.entities].reverse(),
        relationships: [...graph.extraction.relationships].reverse(),
      },
    }
    const [a, b] = [await layoutOf(graph), await layoutOf(shuffled)]
    const geometry = layout => JSON.stringify([[...layout.points].sort(), [...layout.routes].sort()])
    assert.equal(geometry(a), geometry(b), graph.name)
  }
})

test('service platform: the gateway sits over one of its children, so that relationship runs straight down', async () => {
  for (const graph of (await scenarioGraphs()).filter(graph => graph.name.startsWith('graph/service-platform '))) {
    const layout = await layoutOf(graph)
    const gateway = layout.points.get('gateway')
    const below = graph.extraction.relationships.filter(edge => edge.from === 'gateway')
    const straight = below.filter(edge => Math.abs(layout.points.get(edge.to).x - gateway.x) < 0.5)
    assert.equal(straight.length, 1, `${graph.name}: gateway ${gateway.x} vs children ${below.map(edge => layout.points.get(edge.to).x)}`)
    const route = layout.routes.get(straight[0].id)
    assert.ok(Math.abs(route[0].x - route.at(-1).x) < 0.5 && Math.abs(route[0].x - gateway.x) < 0.5, `${graph.name}: straight`)
    // And above them, with the children in the layer just below.
    for (const edge of below) {
      assert.ok(box(layout, edge.to).top > box(layout, 'gateway').bottom)
    }
  }
})

/** The flow-wise extent of a card: its top and bottom, or its left and right in a left-to-right layout. */
const flowSpan = (layout, id, orientation) => {
  const card = box(layout, id)
  return orientation === 'horizontal' ? [card.left, card.right] : [card.top, card.bottom]
}

test('every layer has one baseline: cards side by side in a layer share their top (their left, left to right)', async () => {
  for (const graph of (await scenarioGraphs()).filter(graph => !graph.options.compound)) {
    const layout = await layoutOf(graph)
    const orientation = graph.options.orientation ?? 'vertical'
    const cards = [...layout.points.keys()]
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const [a, b] = [flowSpan(layout, cards[i], orientation), flowSpan(layout, cards[j], orientation)]
        if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) <= 0) continue
        assert.ok(Math.abs(a[0] - b[0]) < 0.5, `${graph.name}: ${cards[i]} at ${a[0]}, ${cards[j]} at ${b[0]}`)
      }
    }
  }
})

/**
 * Cards in a layer share its depth (see `layerBands`): b is taller than c (wider, left to right), and c grows to it.
 * The depths come from the union, so no card resizes while scrubbing, either way.
 */
test('cards in a layer share its depth, the same at every progress of a transition', async () => {
  const graph = (ids, links) =>
    extraction(
      'graph/v0',
      ids.map(id => entity(id)),
      links.map(([from, to]) => relationship(`${from}->${to}`, from, to)),
    )
  const before = graph(
    ['a', 'b', 'c'],
    [
      ['a', 'b'],
      ['a', 'c'],
    ],
  )
  const after = graph(
    ['a', 'b', 'c', 'e'],
    [
      ['a', 'b'],
      ['a', 'c'],
      ['c', 'e'],
    ],
  )
  const model = comparisonModel(before, after, await compare(before, after))
  for (const orientation of ['vertical', 'horizontal']) {
    const depth = orientation === 'vertical' ? 'height' : 'width'
    const grown = orientation === 'vertical' ? {grow: new Map([['b', 40]])} : {widths: new Map([['b', 280]])}
    const transition = await createGraphTransition(model, scheduleSteps(model), {orientation, ...grown})
    const sizes = new Map()
    for (let index = 0; index <= 40; index++) {
      const nodes = new Map(transition(index / 40).nodes.map(node => [node.id, node]))
      assert.equal(nodes.get('c')[depth], nodes.get('b')[depth], `${orientation} at ${index / 40}: c is as deep as b`)
      for (const [id, node] of nodes) sizes.set(id, new Set([...(sizes.get(id) ?? []), `${node.width}x${node.height}`]))
    }
    for (const [id, seen] of sizes) assert.equal(seen.size, 1, `${orientation}: ${id} keeps one size (${[...seen]})`)
    assert.ok(transition(1).nodes.find(node => node.id === 'a')[depth] < transition(1).nodes.find(node => node.id === 'b')[depth])
  }
})

/**
 * Three teams over the flags they own: design over dark-mode, payments over checkout-v2, identity over passkeys,
 * which payments co-owns. As one revision (no status footers), as the After of a comparison, and with dark-mode's card
 * taller than the rest of its layer (as diff mode sizes cards to their text).
 */
test('feature flags: level rows, each team over its flag with a straight route, and passkeys takes its two owners at its thirds', async () => {
  const graph = JSON.parse(await readFile(new URL('graph/fixtures/feature-flags-after.json', renderers), 'utf8'))
  const nodes = await sizedNodes(graph.entities)
  const variants = [
    ['one revision', nodes.map(node => ({...node, height: cardHeight(node.kind, false)}))],
    ['comparison', nodes],
    ['taller dark-mode', nodes.map(node => (node.id === 'flag:dark-mode' ? {...node, height: cardHeight(node.kind) + 26} : node))],
  ]
  for (const [name, variant] of variants) {
    const layout = await layoutGraph(variant, graph.relationships)
    const top = id => box(layout, id).top
    for (const row of [
      ['team:design', 'team:payments', 'team:identity'],
      ['flag:dark-mode', 'flag:checkout-v2', 'flag:passkeys'],
    ]) {
      for (const id of row) assert.ok(Math.abs(top(id) - top(row[0])) < 0.5, `${name}: ${id} top ${top(id)} vs ${top(row[0])}`)
      // In this order, left to right, with equal gaps.
      const xs = row.map(id => layout.points.get(id).x)
      assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `${name}: ${row} in order`)
      assert.ok(Math.abs(xs[1] - xs[0] - (xs[2] - xs[1])) < 0.5, `${name}: ${row} evenly spaced`)
    }
    for (const [team, flag] of [
      ['design', 'dark-mode'],
      ['payments', 'checkout-v2'],
      ['identity', 'passkeys'],
    ]) {
      const [parent, child] = [layout.points.get(`team:${team}`), layout.points.get(`flag:${flag}`)]
      assert.ok(Math.abs(parent.x - child.x) < 0.5, `${name}: ${team} over ${flag} (${parent.x} vs ${child.x})`)
      // Straight down: no bend at all.
      const route = layout.routes.get(`owns:${team}:${flag}`)
      for (const point of route) assert.ok(Math.abs(point.x - route[0].x) < 0.5, `${name}: ${team} → ${flag} is straight`)
    }
    // payments → passkeys needs one S and no more, leaving with payments → checkout-v2 as one trunk.
    const across = layout.routes.get('owns:payments:passkeys')
    assert.equal(inflections(across), 1, `${name}: payments → passkeys is one S`)
    assert.ok(Math.abs(across[0].x - layout.points.get('team:payments').x) < 0.5, `${name}: payments → passkeys leaves the middle`)
    // Arrowheads into passkeys at its thirds, payments' on the left, far apart.
    const tips = ['owns:payments:passkeys', 'owns:identity:passkeys'].map(id => layout.routes.get(id).at(-1))
    const card = box(layout, 'flag:passkeys')
    const third = (card.right - card.left) / 3
    assert.ok(Math.abs(tips[0].x - (card.left + third)) < 0.5 && Math.abs(tips[1].x - (card.right - third)) < 0.5, `${name}: thirds`)
    for (const tip of tips) assert.ok(Math.abs(tip.y - card.top) < 0.5, `${name}: tips touch passkeys`)
    assert.ok(tips[1].x - tips[0].x >= 4 * arrowHeadLength, `${name}: arrowheads ${tips[1].x - tips[0].x} apart`)
  }
})

test("a pipeline's shared prerequisites join and split at one point", async () => {
  const graph = (await scenarioGraphs()).find(graph => graph.name === 'graph/release-workflow extraction')
  const layout = await layoutOf(graph)
  assert.ok(layout.junctions.length > 0, 'the release workflow has a complete shared-prerequisite stage')
  for (const id of layout.shared) {
    const route = layout.routes.get(id)
    assert.ok(
      layout.junctions.some(junction => route.some(point => Math.hypot(point.x - junction.x, point.y - junction.y) < 1)),
      `${id} passes its junction`,
    )
  }
})

test('comparison layouts keep each relationship around the cards at Before, at After and while holding between steps', async () => {
  for (const graph of (await scenarioGraphs()).filter(graph => graph.name.endsWith(' before'))) {
    const after = (await scenarioGraphs()).find(other => other.name === graph.name.replace(/ before$/u, ' after'))
    const model = comparisonModel(graph.extraction, after.extraction, await compare(graph.extraction, after.extraction))
    const transition = await createGraphTransition(model, scheduleSteps(model), graph.options)
    for (const [index, layout] of transition.layouts.entries()) {
      const edges = [...layout.routes.keys()].map(id => {
        const relationship = model.relationships.find(row => row.id === id.replace(/:(before|after)$/u, ''))
        const side = id.endsWith(':before') ? relationship.before : (relationship.after ?? relationship.before)
        const rows = id.endsWith(':before') ? model.entityRow.before : relationship.after ? model.entityRow.after : model.entityRow.before
        return {id, from: rows.get(side.from), to: rows.get(side.to)}
      })
      assert.deepEqual(layoutIssues(layout, edges, graph.options.orientation ?? 'vertical'), [], `${graph.name} layout ${index}`)
    }
  }
})

test('extractions lay out once and never move', async () => {
  const graph = (await scenarioGraphs()).find(graph => graph.name === 'graph/snapshot extraction')
  const model = extractionModel(graph.extraction)
  const transition = await createGraphTransition(model, [])
  assert.equal(transition.layouts.length, 1)
  assert.equal(JSON.stringify(transition(0)), JSON.stringify(transition(1)))
})

test('while scrubbing, no visible relationship passes through a visible card, in either direction', async () => {
  const graphs = await scenarioGraphs()
  for (const graph of graphs.filter(graph => graph.name.endsWith(' before'))) {
    const after = graphs.find(other => other.name === graph.name.replace(/ before$/u, ' after'))
    for (const [from, to] of [
      [graph.extraction, after.extraction],
      [after.extraction, graph.extraction],
    ]) {
      const model = comparisonModel(from, to, await compare(from, to))
      const transition = await createGraphTransition(model, scheduleSteps(model), {
        ...graph.options,
        widths: await cardWidths(model.entities, true),
      })
      const failures = new Set()
      for (let index = 0; index <= 400; index++) {
        const frame = transition(index / 400)
        const cards = frame.nodes.filter(node => !node.group && node.opacity > 0.5)
        for (const edge of frame.edges.filter(edge => !edge.containment && edge.opacity > 0.5)) {
          const points = sampleSpline(edge.points, 3)
          for (const card of cards) {
            if (card.id === edge.fromId || card.id === edge.toId) continue
            const [left, right, top, bottom] = [
              card.x - card.width / 2 + 2,
              card.x + card.width / 2 - 2,
              card.y - card.height / 2 + 2,
              card.y + card.height / 2 - 2,
            ]
            if (points.some(point => point.x > left && point.x < right && point.y > top && point.y < bottom)) {
              failures.add(`${edge.key} through ${card.id} at ${index / 400}`)
            }
          }
        }
      }
      assert.deepEqual([...failures].slice(0, 8), [], `${graph.name}${from === after.extraction ? ' (reverse)' : ''}`)
    }
  }
})

const unlinkedGraph = unlinked => {
  const linked = ['a', 'b', 'c', 'd']
  return extraction(
    'graph/v0',
    [...linked, ...unlinked].map(id => entity(id)),
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['a', 'c'],
    ].map(([from, to]) => relationship(`${from}->${to}`, from, to)),
  )
}

test('cards with no relationships take places on the layers of the rest, clear of it, without moving it', async () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const [flowStart, acrossStart, acrossEnd] = orientation === 'horizontal' ? ['left', 'top', 'bottom'] : ['top', 'left', 'right']
    const flowEnd = orientation === 'horizontal' ? 'right' : 'bottom'
    const axis = orientation === 'horizontal' ? 'y' : 'x'
    for (const unlinked of [
      ['x', 'y'],
      ['p', 'q', 'r', 's', 't', 'u', 'v'],
    ]) {
      for (const width of [cardWidth, 136]) {
        const name = `${orientation}, ${unlinked.length} unlinked, ${width} wide`
        const lay = async graph =>
          layoutGraph(
            graph.entities.map(node => ({...node, width})),
            graph.relationships,
            {orientation},
          )
        const alone = await lay(unlinkedGraph([]))
        const layout = await lay(unlinkedGraph(unlinked))
        const rest = ['a', 'b', 'c', 'd'].map(id => ({id, ...box(layout, id)}))
        // Nothing ELK placed moves to make room.
        for (const card of rest) assert.deepEqual(card, {id: card.id, ...box(alone, card.id)}, `${name}: ${card.id} stays put`)
        const layers = new Set(rest.map(card => card[flowStart]))
        assert.equal(layers.size, 4, `${name}: the rest has four layers`)
        const placed = unlinked.map(id => ({id, ...box(layout, id)}))
        const routes = [...layout.routes.values()].flatMap(route => sampleSpline(route, 2))
        for (const card of placed) {
          // On the rest's layer grid: its leading edge is a layer's, never between two.
          assert.ok(
            [...layers].some(start => Math.abs(start - card[flowStart]) < 0.5),
            `${name}: ${card.id} at ${card[flowStart]} is on a layer of ${[...layers]}`,
          )
          // As far from every other card in its layer, and from every route across it, as cards in a layer are.
          for (const other of [...rest, ...placed]) {
            if (other === card || other[flowStart] >= card[flowEnd] || other[flowEnd] <= card[flowStart]) continue
            const gap = Math.max(other[acrossStart] - card[acrossEnd], card[acrossStart] - other[acrossEnd])
            assert.ok(gap >= nodeSpacing - 0.5, `${name}: ${card.id} is ${gap} from ${other.id}`)
          }
          const near = routes.filter(
            point =>
              point[axis === 'y' ? 'x' : 'y'] > card[flowStart] &&
              point[axis === 'y' ? 'x' : 'y'] < card[flowEnd] &&
              point[axis] > card[acrossStart] - nodeSpacing + 2 &&
              point[axis] < card[acrossEnd] + nodeSpacing - 2,
          )
          assert.deepEqual(near, [], `${name}: routes keep clear of ${card.id}`)
        }
      }
    }
  }
})

test('a card with no relationships takes free room beside the roots rather than a row of its own', async () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const [flowStart, acrossStart, acrossEnd] = orientation === 'horizontal' ? ['left', 'top', 'bottom'] : ['top', 'left', 'right']
    const fan = unlinked =>
      extraction(
        'graph/v0',
        ['r', 'c1', 'c2', 'c3', 'c4', ...unlinked].map(id => entity(id)),
        ['c1', 'c2', 'c3', 'c4'].map(to => relationship(`r->${to}`, 'r', to)),
      )
    const alone = await layoutGraph(fan([]).entities, fan([]).relationships, {orientation})
    const layout = await layoutGraph(fan(['z']).entities, fan(['z']).relationships, {orientation})
    assert.deepEqual([layout.width, layout.height], [alone.width, alone.height], `${orientation}: the layout doesn't grow`)
    const root = box(layout, 'r'),
      z = box(layout, 'z')
    assert.equal(z[flowStart], root[flowStart], `${orientation}: in the roots' layer`)
    const gap = Math.max(z[acrossStart] - root[acrossEnd], root[acrossStart] - z[acrossEnd])
    // On the layout's grid: a column apart, top to bottom; left to right, rows keep ELK's spacing.
    const apart = orientation === 'horizontal' ? nodeSpacing : columnGap
    assert.ok(Math.abs(gap - apart) < 0.5, `${orientation}: next to the root (${gap})`)
  }
})

test('cards with no relationships and nothing else make a grid, in ID order', async () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const [flowStart, acrossStart] = orientation === 'horizontal' ? ['left', 'top'] : ['top', 'left']
    const ids = ['e', 'a', 'c', 'b', 'd']
    const layout = await layoutGraph(
      ids.map(id => entity(id)),
      [],
      {orientation},
    )
    const cards = ids.map(id => ({id, ...box(layout, id)}))
    const layers = [...new Set(cards.map(card => card[flowStart]))].sort((a, b) => a - b)
    assert.equal(layers.length, 3, `${orientation}: √5 rounded up layers`)
    const read = [...cards].sort((a, b) => a[flowStart] - b[flowStart] || a[acrossStart] - b[acrossStart]).map(card => card.id)
    assert.deepEqual(read, ['a', 'b', 'c', 'd', 'e'], `${orientation}: in ID order, layer by layer`)
    if (orientation === 'vertical') {
      // On the layout's column grid, as cards ELK places are: a column apart, `columnGap` between neighbours.
      const pitch = cards[0].right - cards[0].left + columnGap
      for (const card of cards) assert.ok(Number.isInteger((card.left - 32) / pitch), `${card.id} at ${card.left}, off the ${pitch} grid`)
      const first = cards.filter(card => card.top === layers[0]).sort((a, b) => a.left - b.left)
      assert.equal(first[1].left - first[0].right, columnGap, 'neighbours a column gap apart')
    }
  }
})

test('a card that loses or gains its last relationship moves nothing else, and keeps beside its neighbour', async () => {
  const ids = ['a', 'b', 'c', 'd', 'x', 'r', 'c1', 'c2', 'c3']
  const graph = (extra, without = []) =>
    extraction(
      'graph/v0',
      ids.filter(id => !without.includes(id)).map(id => entity(id)),
      [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'c'], ['r', 'c1'], ['r', 'c2'], ['r', 'c3'], ...extra].map(([from, to]) =>
        relationship(`${from}->${to}`, from, to),
      ),
    )
  const linked = graph([['b', 'x']])
  const places = async (from, to, orientation) => {
    const model = comparisonModel(from, to, await compare(from, to))
    const transition = await createGraphTransition(model, scheduleSteps(model), {orientation})
    return Array.from({length: 101}, (_, index) => new Map(transition(index / 100).nodes.map(node => [node.id, node])))
  }
  for (const orientation of ['horizontal', 'vertical']) {
    for (const unlinking of [true, false]) {
      const name = `${orientation}, ${unlinking ? 'unlinking' : 'linking'}`
      const ends = (other, then) => (unlinking ? [linked, other] : [other, linked])
      // The rest moves no more than it would if the card were removed rather than left without relationships.
      const isolated = await places(...ends(graph([])), orientation)
      const removed = await places(...ends(graph([], ['x'])), orientation)
      const motion = frames =>
        ids
          .filter(id => id !== 'x')
          .reduce(
            (sum, id) => sum + Math.hypot(frames[100].get(id).x - frames[0].get(id).x, frames[100].get(id).y - frames[0].get(id).y),
            0,
          )
      assert.ok(
        motion(isolated) <= motion(removed) + 0.5,
        `${name}: the rest moves ${motion(isolated)}, removing the card ${motion(removed)}`,
      )
      // The card keeps its place beside the card nearest it, c, while c moves.
      const offsets = new Set(
        isolated.map(frame => `${Math.round(frame.get('x').x - frame.get('c').x)},${Math.round(frame.get('x').y - frame.get('c').y)}`),
      )
      assert.equal(offsets.size, 1, `${name}: x keeps beside c (${[...offsets]})`)
    }
  }
})

test('a card with no relationships a little off a column in another layer moves onto it where it fits', async () => {
  const {alignColumns, columnReach} = await import('../dist/layout/unlinked-columns.js')
  const axes = {flow: 'y', across: 'x', depth: 'height', breadth: 'width'}
  const span = (start, end) => ({start, end})
  // A card in the layer above, at 100; the unlinked card below it, at 100 + `offset`; perhaps a route beside it.
  const align = (offset, route) => {
    const above = {flow: span(0, 56), across: span(100, 300), card: true}
    const box = {x: 100 + offset, y: 120, width: 200, height: 56}
    const own = {flow: span(120, 176), across: span(box.x, box.x + 200), card: true}
    const blocks = [above, own, ...(route === undefined ? [] : [{flow: span(60, 300), across: span(route, route), card: false}])]
    const reach = alignColumns(['u'], new Map([['u', box]]), new Map([['u', own]]), blocks, axes, 400)
    return {x: box.x, reach}
  }
  assert.equal(align(15).x, 100, 'moves left onto the column')
  assert.equal(align(-15).x, 100, 'moves right onto the column')
  assert.equal(align(-15).reach, 400, 'within the layout, it stays as wide')
  assert.equal(align(columnReach + 10).x, 100 + columnReach + 10, 'too far off a column to be a slip')
  assert.equal(align(15, 90).x, 115, 'a route beside the column keeps it off')
  assert.equal(align(15, 60).x, 100, 'a route further off leaves room')
})

test('top to bottom, every card starts on a column line of one grid, in every layer of every scenario without boundaries', async () => {
  for (const graph of (await scenarioGraphs()).filter(graph => !graph.options.compound && !graph.options.orientation)) {
    const layout = await layoutOf(graph)
    const cards = [...layout.points.keys()].map(id => box(layout, id))
    const widths = cards.map(card => card.right - card.left).sort((a, b) => a - b)
    const pitch = widths[Math.floor(widths.length / 2)] + columnGap
    for (const card of cards) {
      const column = (card.left - 32) / pitch
      assert.ok(Math.abs(column - Math.round(column)) < 1e-6, `${graph.name}: a card at ${card.left} is off the ${pitch} grid`)
    }
  }
})

test('cards take the columns nearest where they were placed, in order and a column apart', async () => {
  const {placeInColumns} = await import('../dist/layout/grid.js')
  assert.deepEqual(placeInColumns([0.1, 1.2, 2.4], [1, 1, 1]), [0, 1, 2], 'each to its nearest')
  assert.deepEqual(placeInColumns([1.6, 1.7], [1, 1]), [1, 2], 'two wanting one column share the move')
  assert.deepEqual(placeInColumns([0.2, 0.3, 0.4], [1, 1, 1]), [0, 1, 2], 'never left of the first column')
  assert.deepEqual(placeInColumns([0, 1.1, 5], [2, 1, 1]), [0, 2, 5], 'a card two columns wide keeps both')
  const pressed = placeInColumns([3, 3, 3, 0.2], [1, 1, 1, 1])
  assert.ok(
    pressed.every((column, index) => index === 0 || column > pressed[index - 1]),
    `order is kept whatever they want (${pressed})`,
  )
})

test('cards with no relationships share the first layer, beside its cards, and nothing else moves', async () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const [flowStart, acrossStart, acrossEnd] = orientation === 'horizontal' ? ['left', 'top', 'bottom'] : ['top', 'left', 'right']
    // The first layer's one card, b, is placed beside its successors, leaving room before it.
    const pairs = ['a-e', 'a-f', 'a-g', 'b-c', 'b-d', 'b-f', 'c-f', 'd-e', 'e-f', 'f-g'].map(pair => pair.split('-'))
    const linked = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const relationships = pairs.map(([from, to]) => relationship(`${from}->${to}`, from, to))
    const alone = await layoutGraph(
      linked.map(id => entity(id)),
      relationships,
      {orientation},
    )
    const graph = await layoutGraph(
      [...linked, 'x'].map(id => entity(id)),
      relationships,
      {orientation},
    )
    const name = orientation
    assert.ok(Math.abs(box(graph, 'x')[flowStart] - box(graph, 'b')[flowStart]) < 0.5, `${name}: x is on the first layer`)
    const [x, b] = [box(graph, 'x'), box(graph, 'b')]
    const apart = Math.max(x[acrossStart] - b[acrossEnd], b[acrossStart] - x[acrossEnd])
    const spacing = orientation === 'horizontal' ? nodeSpacing : columnGap
    assert.ok(Math.abs(apart - spacing) < 0.5, `${name}: x is beside b, ${spacing} apart (${apart})`)
    for (const id of linked) assert.deepEqual(box(graph, id), box(alone, id), `${name}: ${id} stays where it was`)
    assert.deepEqual([graph.width, graph.height], [alone.width, alone.height], `${name}: the drawing keeps its size`)
  }
})

test('a card with no relationships keeps its place while another arrives beside it, in both directions', async () => {
  const before = unlinkedGraph(['x'])
  const after = unlinkedGraph(['w', 'x'])
  for (const [from, to] of [
    [before, after],
    [after, before],
  ]) {
    const model = comparisonModel(from, to, await compare(from, to))
    const transition = await createGraphTransition(model, scheduleSteps(model), {orientation: 'horizontal'})
    const places = new Set()
    for (let index = 0; index <= 100; index++) {
      const node = transition(index / 100).nodes.find(node => node.id === 'x')
      places.add(`${node.x},${node.y}`)
    }
    assert.equal(places.size, 1, `x stays put (${[...places]})`)
    const layout = transition.layouts.at(-1)
    const layers = new Set(['a', 'b', 'c', 'd'].map(id => box(layout, id).left))
    assert.ok(layers.has(box(layout, 'x').left), 'x stays on a layer')
  }
})

test("a fitted drawing keeps clear of the host's cover only where its fit would reach it", async () => {
  const {coveredTop, parseStageCover} = await import('../dist/index.js')
  assert.deepEqual(parseStageCover('8 6 180 18, 412 6 140 18'), [
    {x: 8, y: 6, width: 180, height: 18},
    {x: 412, y: 6, width: 140, height: 18},
  ])
  assert.deepEqual(parseStageCover('8 6 180, 0 0 0 10, nope'), [], 'malformed and empty rectangles cover nothing')
  assert.equal(parseStageCover(undefined), undefined)
  const padding = {x: 16, y: 16}
  const chip = {x: 8, y: 6, width: 180, height: 18}
  const bar = {x: 220, y: 8, width: 560, height: 42}
  const view = {width: 1000, height: 600}
  // A flat drawing fitted to the width sits centred far below a chip: it keeps its own top.
  assert.equal(coveredTop({cover: [chip, bar], view, size: {width: 1000, height: 200}, padding}), 16)
  // A tall one fitted to the height reaches the bar across its middle, but not the chip at the side.
  assert.equal(coveredTop({cover: [chip], view, size: {width: 400, height: 1000}, padding}), 16)
  assert.equal(coveredTop({cover: [chip, bar], view, size: {width: 400, height: 1000}, padding}), 58, "the bar's bottom and 8px")
  // The stage starts below a notice in the frame: the cover reaches less far into it.
  assert.equal(coveredTop({cover: [bar], view, origin: {x: 0, y: 40}, size: {width: 400, height: 1000}, padding}), 18)
})

test('a drawing drawn larger than its fit keeps clear of the bands at its ends, and moves no more than it must', async () => {
  const {scrolledPadding} = await import('../dist/index.js')
  const own = {top: 16, y: 16}
  const inset = {top: 54, bottom: 0}
  // Zoomed in, a flat drawing still sits centred well below the band: it keeps its own padding, so it doesn't move.
  assert.deepEqual(scrolledPadding({own, inset, height: 300, view: 600}), own)
  // Centred, it would reach the band: just enough more at the top that it clears it, still fitting the stage.
  assert.deepEqual(scrolledPadding({own, inset, height: 520, view: 600}), {top: 44, y: 16})
  // That much more no longer fits: it scrolls, and opens a band's height down.
  assert.deepEqual(scrolledPadding({own, inset, height: 533, view: 600}), {top: 54, y: 16})
  assert.deepEqual(scrolledPadding({own, inset, height: 2000, view: 600}), {top: 54, y: 16})
  // A band at the foot too: each end clears its own.
  assert.deepEqual(scrolledPadding({own, inset: {top: 54, bottom: 70}, height: 470, view: 600}), {top: 16, y: 26})
  assert.deepEqual(scrolledPadding({own, inset: {top: 54, bottom: 70}, height: 480, view: 600}), {top: 54, y: 70})
})

test("a fitted drawing keeps clear of a cover at the stage's foot only where its fit would reach it", async () => {
  const {coveredBottom, coveredTop} = await import('../dist/index.js')
  const padding = {x: 16, y: 16}
  const view = {width: 1000, height: 600}
  // A floating foot 12px above the stage's bottom: 61px tall, centred, 600px wide.
  const foot = {x: 200, y: 527, width: 600, height: 61}
  // A flat drawing centred well above it keeps its own bottom; a tall one opens above it, by 8px.
  assert.equal(coveredBottom({cover: [foot], view, size: {width: 1000, height: 200}, padding}), 16)
  assert.equal(coveredBottom({cover: [foot], view, size: {width: 400, height: 1000}, padding}), 81, '600 − (527 − 8)')
  // It never moves the top, and a cover at the top never moves the bottom.
  assert.equal(coveredTop({cover: [foot], view, size: {width: 400, height: 1000}, padding}), 16)
  assert.equal(coveredBottom({cover: [{x: 220, y: 8, width: 560, height: 42}], view, size: {width: 400, height: 1000}, padding}), 16)
})

test('a fitted drawing between a top cover and a foot clears both once refitted', async () => {
  const {coveredPadding} = await import('../dist/index.js')
  const bar = {x: 220, y: 12, width: 560, height: 42}
  const foot = {x: 200, y: 527, width: 600, height: 61}
  const view = {width: 1000, height: 600}
  // Raising the bottom alone for the foot (81) would recentre this drawing up under the bar.
  const {top, y} = coveredPadding({cover: [bar, foot], view, size: {width: 400, height: 450}, padding: {x: 16, y: 16}})
  const free = view.height - 450 - top - y
  const drawnTop = top + Math.max(0, free) / 2
  assert.ok(drawnTop >= bar.y + bar.height + 8, `top at ${drawnTop}`)
  assert.ok(drawnTop + 450 <= foot.y - 8 || free < 0, `bottom at ${drawnTop + 450}`)
})

test("in a content-sized frame, the host's insets place its cover, wherever the foot was measured", async () => {
  const {coveredBottom, coveredPadding} = await import('../dist/index.js')
  const padding = {x: 16, y: 16}
  const size = {width: 400, height: 380}
  const insets = {top: 0, bottom: 56}
  const foot = y => ({x: 458, y, width: 429, height: 30})
  // The foot 12px above the bottom of a 320, 448 or 646px frame (its `stage-inset-bottom` 56px), placed in a stage of
  // 448 or 646px: each is the frame's foot, even one above the stage's middle, and each pads the bottom alike.
  for (const height of [448, 646]) {
    for (const y of [277, 405, 603]) {
      assert.deepEqual(coveredPadding({cover: [foot(y)], view: {width: 1344, height}, size, padding, insets}), {top: 16, y: 56})
    }
  }
  // A chip within the top inset stays at the top, and the drawing opens below it.
  const view = {width: 1344, height: 448}
  const chip = {x: 458, y: 12, width: 200, height: 28}
  assert.deepEqual(coveredPadding({cover: [chip, foot(603)], view, size, padding, insets: {top: 52, bottom: 56}}), {top: 48, y: 56})
  // A footer below the stage that keeps clear of the inset itself takes it off the drawing's bottom.
  assert.deepEqual(coveredPadding({cover: [foot(603)], view, size, padding, insets: {...insets, below: 70}}), {top: 16, y: 16})
  assert.deepEqual(coveredPadding({cover: [foot(603)], view, size, padding, insets: {...insets, below: 20}}), {top: 16, y: 36})
  // A foot that lies beside the drawing keeps its own bottom.
  assert.equal(coveredBottom({cover: [{x: 1100, y: 405, width: 200, height: 30}], view, size, padding, insets}), 16)
})

test('fitting centres content, never magnifies it, and always fits both dimensions, however small', async () => {
  const {fitScale} = await import('../dist/index.js')
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)
  // Small content keeps its size.
  assert.deepEqual(fitScale({width: 400, height: 300}, {width: 1200, height: 800}), {scale: 1, widthFirst: 1})
  // Large content scales down to fit both dimensions, with the padding (16 by default) on every side.
  close(fitScale({width: 2000, height: 1000}, {width: 1632, height: 632}).scale, 0.6)
  // Taller than the stage: fits the height, with no readable floor (the user can zoom in).
  const tall = fitScale({width: 1000, height: 2000}, {width: 1232, height: 1032})
  close(tall.scale, 0.5)
  assert.equal(tall.widthFirst, 1, 'a content-sized host still gets the width-fitted height')
  // Wider than the stage: fits the width.
  close(fitScale({width: 4000, height: 500}, {width: 1032, height: 832}).scale, 0.25)
  // A narrow stage fits both dimensions, far below any former floor.
  const phone = fitScale({width: 700, height: 1400}, {width: 452, height: 700})
  close(phone.scale, 668 / 1400)
  close(phone.widthFirst, 420 / 700)
  close(fitScale({width: 3000, height: 1400}, {width: 358, height: 532}).scale, 326 / 3000)
  // A custom padding and maximum.
  close(fitScale({width: 500, height: 500}, {width: 600, height: 400}, {padding: 0, maxScale: 2}).scale, 0.8)
  close(fitScale({width: 100, height: 100}, {width: 600, height: 400}, {padding: 0, maxScale: 2}).scale, 2)
  // Fitted content plus its padding never exceeds the stage.
  for (const [size, stage] of [
    [
      {width: 2400, height: 1800},
      {width: 1752, height: 709},
    ],
    [
      {width: 2400, height: 1800},
      {width: 868, height: 716},
    ],
    [
      {width: 2400, height: 1800},
      {width: 358, height: 300},
    ],
    [
      {width: 300, height: 4000},
      {width: 1440, height: 700},
    ],
  ]) {
    const {scale} = fitScale(size, stage)
    assert.ok(
      size.width * scale + 32 <= stage.width + 1e-9 && size.height * scale + 32 <= stage.height + 1e-9,
      JSON.stringify({size, stage}),
    )
  }
})

test('zoom starts fitted, stops at the fit going out, and can always reach a legible size going in', async () => {
  const {clampZoom, maxZoom, zoomLimits} = await import('../dist/index.js')
  assert.equal(clampZoom(0.4, 0.6), 1, 'never below the fit')
  assert.equal(clampZoom(1 / zoomLimits.step, 0.6), 1, 'a step out from just above the fit lands on it, never skips it')
  assert.equal(clampZoom(1.5 / zoomLimits.step, 0.6), 1)
  assert.equal(clampZoom(1.5 * zoomLimits.step, 0.6), 2.25)
  assert.equal(clampZoom(2.25 / zoomLimits.step, 0.6), 1.5, 'stepping back returns exactly')
  assert.equal(maxZoom(1), zoomLimits.max)
  assert.equal(maxZoom(0.1) * 0.1, zoomLimits.readable, 'a tiny fit can zoom to a legible scale')
  assert.equal(clampZoom(100, 1), zoomLimits.max)
})

test('a stage opens fitted unless that draws text below the floor, then at the floor on its top row', async () => {
  const {contentStart, openingFloorPx, openingZoom} = await import('../dist/index.js')
  assert.equal(openingFloorPx, 8)
  // Smallest text 12 content units: the floor scale is 8 / 12.
  const floor = openingFloorPx / 12
  assert.equal(openingZoom(1, floor), 1, 'text drawn at 12 px opens fitted')
  assert.equal(openingZoom(floor, floor), 1, 'text exactly at the floor opens fitted')
  assert.equal(openingZoom(floor * 0.999, floor), 1, 'a hair below the floor still opens fitted')
  assert.ok(Math.abs(openingZoom(0.2, floor) * 0.2 * 12 - 8) < 1e-4, 'a small fit opens where the smallest text is 8 px')
  assert.equal(openingZoom(0.5, 0), 1, 'no text measured yet: fitted')
  // The top row's leftmost box, 12 units clear, at the view's top left, never the empty room the bounds begin with.
  const bounds = {x: 0, y: 0, width: 1000, height: 600}
  const start = contentStart(
    [
      {x: 600, y: 20, width: 100, height: 40},
      {x: 400, y: 30, width: 100, height: 40},
      {x: 0, y: 300, width: 100, height: 40},
    ],
    bounds,
    16,
  )
  assert.deepEqual(start({scale: 0.5}), {left: (400 - 12) * 0.5 + 16, top: (20 - 12) * 0.5 + 16})
  assert.deepEqual(start({scale: 0}), {left: 0, top: 0})
  // Centred, a top-to-bottom layout's top row is cut evenly on both sides, even when it sits to one side of the bounds.
  const boxes = [
    {x: 400, y: 30, width: 100, height: 40},
    {x: 520, y: 30, width: 100, height: 40},
    {x: 0, y: 300, width: 100, height: 40},
  ]
  const centred = contentStart(boxes, bounds, 16, 12, 'centre')
  assert.deepEqual(centred({scale: 0.5, width: 300}), {left: 510 * 0.5 + 16 - 150, top: (30 - 12) * 0.5 + 16})
  // A top row wider than the view opens from its leftmost box, 12 units clear, never centred with that box cut.
  const wide = [
    {x: 100, y: 30, width: 200, height: 40},
    {x: 340, y: 30, width: 200, height: 40},
    {x: 580, y: 30, width: 200, height: 40},
  ]
  const narrow = contentStart(wide, bounds, 16, 12, 'centre')({scale: 1, width: 400, height: 300})
  assert.deepEqual(narrow, {left: (100 - 12) * 1 + 16, top: (30 - 12) * 1 + 16})
  // Nor does a lower box the view reaches straddle its left edge: the start moves left until that box is whole.
  const lower = [...wide, {x: 60, y: 200, width: 200, height: 40}]
  assert.equal(contentStart(lower, bounds, 16, 12, 'centre')({scale: 1, width: 400, height: 300}).left, 60 - 12 + 16)
  assert.equal(contentStart(lower, bounds, 16)({scale: 1, width: 400, height: 300}).left, 60 - 12 + 16)
  // One below the view's reach leaves the start where the top row puts it.
  assert.equal(contentStart(lower, bounds, 16)({scale: 1, width: 400, height: 150}).left, 100 - 12 + 16)
  // Or right, to the nearest edge between boxes that keeps the top row's leftmost box whole.
  const between = [
    {x: 400, y: 30, width: 100, height: 40},
    {x: 150, y: 200, width: 200, height: 40},
    {x: 380, y: 200, width: 200, height: 40},
  ]
  assert.equal(contentStart(between, bounds, 16, 12, 'centre')({scale: 1, width: 300, height: 300}).left, 350 + 12 + 16)
  // Edges are chosen where the scroll range lets the view be: a start past its end would be clamped onto a card.
  const ending = [
    {x: 450, y: 30, width: 100, height: 40},
    {x: 140, y: 200, width: 100, height: 40},
    {x: 270, y: 200, width: 100, height: 40},
  ]
  const narrowBounds = {x: 0, y: 0, width: 600, height: 400}
  assert.equal(contentStart(ending, narrowBounds, 0, 12, 'centre')({scale: 1, width: 300, height: 300}).left, 270 - 12)
  // The range is the bounds and the inset on each side: an edge past a card at the range's end would cut it.
  const atEnd = [
    {x: 450, y: 30, width: 100, height: 40},
    {x: 140, y: 200, width: 100, height: 40},
    {x: 270, y: 200, width: 55, height: 40},
  ]
  assert.equal(contentStart(atEnd, narrowBounds, 16, 12, 'centre')({scale: 1, width: 300, height: 300}).left, 270 - 12 + 16)
  // Where every edge that keeps that box whole cuts one, the nearest that keeps its left side in view.
  const partly = [
    {x: 400, y: 30, width: 200, height: 40},
    {x: 150, y: 200, width: 200, height: 40},
    {x: 360, y: 200, width: 200, height: 40},
  ]
  assert.equal(contentStart(partly, bounds, 0)({scale: 1, width: 300, height: 300}).left, 150 - 12)
  // Where every edge that keeps it in view cuts one, the drawing's own left side.
  const far = {x: -500, y: 0, width: 1500, height: 600}
  const long = [...wide, {x: -300, y: 200, width: 500, height: 40}]
  assert.equal(contentStart(long, far, 16)({scale: 1, width: 400, height: 300}).left, 16)
  // A group's frame may cross the edge while the cards it holds are whole.
  const grouped = [...wide, {x: 40, y: 180, width: 300, height: 100}, {x: 120, y: 200, width: 200, height: 40}]
  assert.equal(contentStart(grouped, bounds, 16)({scale: 1, width: 400, height: 300}).left, 100 - 12 + 16)
})

test("content flush with a host's stage inset fits apart across and down, opens on its column and is capped as the host asks", async () => {
  const {contentStart, contentHeightCap, contentMinimumCap, fitScale} = await import('../dist/index.js')
  // Padding across (the host's 8 px stage inset) and down (16) apart.
  assert.equal(fitScale({width: 2000, height: 100}, {width: 1016, height: 1000}, {padding: {x: 8, y: 16}}).scale, 0.5)
  assert.equal(fitScale({width: 100, height: 2000}, {width: 1000, height: 1032}, {padding: {x: 8, y: 16}}).scale, 0.5)
  // Bounds that reach exactly to the boxes across, padded by the inset: with `clear` the same, the leftmost box opens
  // that inset from the view's left edge (scrolled to 0), where the host's column is.
  const boxes = [
    {x: 0, y: 12, width: 200, height: 40},
    {x: 240, y: 12, width: 200, height: 40},
  ]
  const bounds = {x: 0, y: 0, width: 1400, height: 400}
  assert.deepEqual(contentStart(boxes, bounds, {x: 8, y: 16}, 12, 'left', 8)({scale: 0.5, width: 300, height: 300}), {left: 0, top: 16})
  // Without it, the view starts past the padding, the box at its very edge.
  assert.equal(contentStart(boxes, bounds, {x: 8, y: 16}, 12)({scale: 0.5, width: 300, height: 300}).left, 8)
  // A content-sized stage asks for at most the host window's height, never less than the minimum.
  // Only when the host sends `stage-max-height`: in px, or in vh of its window once it has reported it.
  assert.equal(contentHeightCap(undefined, {height: 900}), undefined)
  assert.equal(contentHeightCap('100vh', undefined), undefined)
  assert.equal(contentHeightCap('100vh', {height: 900}), 900)
  assert.equal(contentHeightCap('50vh', {height: 900}), 450)
  assert.equal(contentHeightCap('640px', undefined), 640)
  assert.equal(contentHeightCap('100vh', {height: 200}), contentMinimumCap)
})

test('the dot grid stays on the content as it pans and zooms, and fades out zoomed far out', async () => {
  const {dotGrid, dotGridSpacing} = await import('../dist/index.js')
  const {units, fade} = dotGridSpacing
  const at = (scale, origin) => dotGrid(scale, origin)
  // Its spacing is the zoom's: a dot every `units` content units.
  assert.equal(at(1, {x: 0, y: 0}).spacing, units)
  assert.equal(at(2, {x: 0, y: 0}).spacing, units * 2)
  // A dot sits on the content's origin, wherever the content is drawn in its scroll container (centred, or padded).
  const placed = at(1.5, {x: 100, y: 37})
  assert.equal((100 - placed.x) % placed.spacing, 0)
  assert.equal((37 - placed.y) % placed.spacing, 0)
  assert.ok(placed.x >= 0 && placed.x < placed.spacing && placed.y >= 0 && placed.y < placed.spacing)
  // So a content point at a dot stays at a dot at another zoom: 32 units in is 2 dots at any scale.
  for (const scale of [0.75, 1, 3]) {
    const grid = at(scale, {x: 20, y: 20})
    assert.ok(Math.abs(((20 + 32 * scale - grid.x) / grid.spacing) % 1) < 1e-9, `scale ${scale}`)
  }
  // Fully drawn while the dots are far enough apart, gone before they are noise, and fading between.
  assert.equal(at(fade.from / units, {x: 0, y: 0}).opacity, 1)
  assert.equal(at(fade.to / units, {x: 0, y: 0}).opacity, 0)
  const between = at((fade.from + fade.to) / 2 / units, {x: 0, y: 0}).opacity
  assert.ok(between > 0 && between < 1, `${between}`)
  assert.equal(at(0, {x: 5, y: 5}).opacity, 0, 'not measured yet')
})

test('every arrowhead points into its target card, and its shaft arrives the same way, at every stage of every scenario', async () => {
  const {drawnEdge, cardBox, inwardNormal} = await import('../dist/index.js')
  const graphs = await scenarioGraphs()
  const failures = []
  const check = (frame, label) => {
    const nodes = new Map(frame.nodes.map(node => [node.id, node]))
    for (const edge of frame.edges.filter(edge => !edge.containment && nodes.has(edge.fromId) && nodes.has(edge.toId))) {
      const from = nodes.get(edge.fromId),
        to = nodes.get(edge.toId)
      const arrow = drawnEdge(edge, from, to)
      const box = cardBox(to)
      const normal = inwardNormal(arrow.tip, box)
      // Head: from the middle of its flat base to its tip (its inner outline's corners are a corner radius inside).
      const [tip] = [...arrow.head.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({
        x: Number(match[1]),
        y: Number(match[2]),
      }))
      const base = arrow.base
      const length = Math.hypot(tip.x - base.x, tip.y - base.y)
      const head = ((tip.x - base.x) * normal.x + (tip.y - base.y) * normal.y) / length
      // Shaft: its final tangent, at the base of the head.
      const numbers = [...arrow.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
      const [control, end] = numbers.slice(-2)
      const tangent = Math.hypot(end.x - control.x, end.y - control.y)
      const shaft = ((end.x - control.x) * normal.x + (end.y - control.y) * normal.y) / tangent
      const onFace =
        Math.min(
          Math.abs(arrow.tip.y - box.y),
          Math.abs(arrow.tip.y - box.y - box.height),
          Math.abs(arrow.tip.x - box.x),
          Math.abs(arrow.tip.x - box.x - box.width),
        ) < 0.75
      if (!(head > 0.9) || !(shaft > 0.999) || !onFace || Math.hypot(end.x - base.x, end.y - base.y) > 0.05) {
        failures.push(`${label} ${edge.key}: head ${head.toFixed(2)}, shaft ${shaft.toFixed(2)}, on face ${onFace}`)
      }
    }
  }
  for (const graph of graphs) {
    if (graph.name.endsWith(' after')) continue
    if (graph.name.endsWith(' extraction')) {
      const model = extractionModel(graph.extraction)
      check((await createGraphTransition(model, [], graph.options))(1), graph.name)
      continue
    }
    const after = graphs.find(other => other.name === graph.name.replace(/ before$/u, ' after'))
    for (const [from, to, direction] of [
      [graph.extraction, after.extraction, 'forward'],
      [after.extraction, graph.extraction, 'reverse'],
    ]) {
      const model = comparisonModel(from, to, await compare(from, to))
      const transition = await createGraphTransition(model, scheduleSteps(model), graph.options)
      for (let index = 0; index <= 100; index++) check(transition(index / 100), `${graph.name} ${direction} @${index / 100}`)
    }
  }
  assert.deepEqual(failures.slice(0, 10), [])
})

test('layout moves start and stop softly and span most of their step', async () => {
  const {motionWindow, stepWindows} = await import('../dist/index.js')
  const graphs = await scenarioGraphs()
  for (const graph of graphs.filter(graph => graph.name.endsWith(' before'))) {
    const after = graphs.find(other => other.name === graph.name.replace(/ before$/u, ' after'))
    const model = comparisonModel(graph.extraction, after.extraction, await compare(graph.extraction, after.extraction))
    const schedule = scheduleSteps(model)
    const transition = await createGraphTransition(model, schedule, graph.options)
    const rows = new Map(model.entities.map(row => [row.id, row]))
    const positions = t => new Map(transition(t).nodes.map(node => [node.id, node]))
    const travel = (a, b) =>
      Math.max(0, ...[...a].filter(([id]) => b.has(id)).map(([id, node]) => Math.hypot(node.x - b.get(id).x, node.y - b.get(id).y)))
    for (const step of schedule) {
      const {move} = stepWindows(step, rows)
      // A reading lead is still by design; the move spans most of the rest.
      assert.ok(move.radius >= motionWindow(step).radius * 0.6 - 1e-12, `${graph.name}: the move spans most of its step`)
      const [start, end] = [move.time - move.radius, move.time + move.radius]
      const total = travel(positions(start), positions(end))
      if (total < 1) continue
      const edge = (end - start) / 50
      // In the first and last 2% of the window a card covers well under 1% of its journey.
      assert.ok(travel(positions(start), positions(start + edge)) < total * 0.01, `${graph.name}: the move starts softly`)
      assert.ok(travel(positions(end - edge), positions(end)) < total * 0.01, `${graph.name}: the move stops softly`)
    }
  }
})

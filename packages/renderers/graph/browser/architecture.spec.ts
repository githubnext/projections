import {expect, test} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {architectureModules, capabilityUnits, emptiedBoundaries} from '../../kit/browser/fixtures.js'
import {scrubSuite, selectionSuite} from '../../kit/browser/suite.js'
import {paneStatusSuite, statusSuite} from '../../kit/browser/status.js'

scrubSuite([architectureModules(), emptiedBoundaries(), capabilityUnits()])
selectionSuite(architectureModules(), 'worker')
statusSuite(architectureModules())
paneStatusSuite(architectureModules())

test('module containment is a boundary around its resources, not arrows', async ({page}) => {
  const {before, after} = architectureModules()
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, progress: 0})
  await renderer.scrub([0, 0.25, 0.5, 0.75, 1], async () => {
    const outside = await renderer.frame.locator('.pk').evaluate(root => {
      const group = root.querySelector('.graph-group .node-surface')!.getBoundingClientRect()
      return [...root.querySelectorAll<SVGGElement>('.graph-node:not(.graph-group)')]
        .filter(node => Number(node.getAttribute('opacity')) > 0.01)
        .filter(node => {
          const box = node.querySelector('.node-surface')!.getBoundingClientRect()
          return box.left < group.left - 1 || box.right > group.right + 1 || box.top < group.top - 1 || box.bottom > group.bottom + 1
        })
        .map(node => node.dataset.entityId)
    })
    expect(outside).toEqual([])
    await expect(renderer.frame.locator('.graph-link[data-from="root"]')).toHaveCount(0)
  })
  // The host's summary bar counts the components by kind; containment is the boundary, no figure. No legend lists them.
  await expect
    .poll(async () => ((await renderer.state()).summary ?? []).map(item => (item.type === 'fact' ? item.id : item.kind)))
    .toEqual(['resource', 'module', 'references'])
  expect((await renderer.state()).legend?.items ?? []).toEqual([])
  await expect(renderer.frame.getByRole('list', {name: 'Component kinds'})).toHaveCount(0)
})

test('component and module names are monospace identifiers; kinds stay sans', async ({page}) => {
  const {before, after} = architectureModules()
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, progress: 1})
  const measured = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(measured.count).toBeGreaterThanOrEqual(after.entities.length)
  expect(measured.proportional).toEqual([])
  const group = renderer.frame.locator('.graph-group .node-label')
  // The boundary reads "kind: name": only the name is an identifier.
  await expect(group).not.toHaveAttribute('data-projections-identifier')
  await expect(group.locator('tspan[data-projections-identifier]')).toHaveText('platform')
  const families = await renderer.frame.locator('svg.graph').evaluate(svg => ({
    kind: getComputedStyle(svg.querySelector('.graph-group .node-label')!).fontFamily,
    name: getComputedStyle(svg.querySelector('.graph-group .node-label tspan')!).fontFamily,
    nodeKind: getComputedStyle(svg.querySelector('.graph-node:not(.graph-group) .node-kind')!).fontFamily,
    nodeName: getComputedStyle(svg.querySelector('.graph-node:not(.graph-group) .node-label')!).fontFamily,
  }))
  expect(families.name).toBe(families.nodeName)
  expect(families.kind).toBe(families.nodeKind)
  expect(families.kind).not.toBe(families.name)
})

test('a namespace emptied by removals stays a boundary in every frame, never a card', async ({page}) => {
  const {before, after} = emptiedBoundaries()
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, progress: 0})
  const cards: string[] = []
  await renderer.scrub(
    Array.from({length: 51}, (_, index) => index / 50),
    async () => {
      cards.push(
        ...(await renderer.frame
          .locator('.graph-node:not(.graph-group)[data-entity-id^="ns:"]')
          .evaluateAll(nodes => nodes.map(node => (node as SVGGElement).dataset.entityId ?? ''))),
      )
    },
  )
  expect(cards).toEqual([])
  await expect(renderer.frame.locator('.graph-group[data-entity-id="ns:accounts"]')).toHaveCount(1)
})

test('a definition can show a data field as badges, color cards by a field and relationships by kind, with a legend', async ({page}) => {
  const {before, after} = capabilityUnits()
  const options = {badges: '/data/capabilities', colorBy: '/data/scope', relationshipColors: true}
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, progress: 1, options})
  const worker = renderer.frame.locator('[data-entity-id="unit:worker"]')
  await expect(worker.locator('.node-badge-text')).toHaveText(['process', 'network'])
  await expect(worker.locator('.node-accent')).toHaveCount(1)
  await expect(worker).toHaveAttribute('aria-label', /scope: internal, process, network/)
  // Badges are identifiers, in the monospace font.
  await expect(worker.locator('.node-badge-text').first()).toHaveAttribute('data-projections-identifier', '')
  await expect
    .poll(async () => (await renderer.state()).legend)
    .toMatchObject({
      title: 'scope',
      items: [
        {label: 'internal'},
        {label: 'public'},
        {label: 'calls', shape: 'line'},
        {label: 'reads', shape: 'line'},
        {label: 'spawns', shape: 'line'},
      ],
    })
  // Each relationship kind is drawn in its legend color while its change isn't emphasized.
  const strokes = await renderer.frame
    .locator('.graph-link .graph-edge')
    .evaluateAll(paths => [...new Set(paths.map(path => (path as SVGPathElement).style.stroke))])
  expect(strokes.length).toBe(3)
  // At the endpoints nothing is marked as a change, badges included.
  for (const progress of [0, 1]) {
    await renderer.seek(progress)
    await expect(renderer.frame.locator('[data-change], .node-badge.added, .node-badge.removed, .pk-svg-was, .pk-svg-now')).toHaveCount(0)
  }
})

test('in the diff a modified card lists its changed data fields and marks the badges it gained', async ({page}) => {
  const {before, after} = capabilityUnits()
  const renderer = await openRenderer(page, {
    renderer: 'architecture',
    before,
    after,
    comparisonMode: 'diff',
    options: {badges: '/data/capabilities'},
  })
  const worker = renderer.frame.locator('[data-entity-id="unit:worker"]')
  // The badges mark their own change, so the list has the rest.
  await expect(worker.locator('.node-field-key')).toHaveText(['session scoped'])
  await expect(worker.locator('.node-field-value').last()).toHaveText('null → true')
  await expect(worker.locator('.node-badge.added .node-badge-text')).toHaveText(['network'])
  await expect(worker.locator('.node-badge:not(.added):not(.removed) .node-badge-text')).toHaveText(['process'])
  // An unchanged card lists nothing.
  await expect(renderer.frame.locator('[data-entity-id="unit:server"] .node-field-key')).toHaveCount(0)
})

test('a large architecture collapses unchanged boundaries, and its diff opens on the changes', async ({page}) => {
  const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  const [before, after] = await Promise.all([fixture('large-architecture-before'), fixture('large-architecture-after')])
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, comparisonMode: 'diff', height: 650})
  const frame = renderer.frame
  // Unchanged boundaries are summary cards; billing, where everything changed, is open.
  const extractors = frame.locator('[data-graph-synthetic="boundary:extractors"]')
  await expect(extractors).toHaveCount(1)
  await expect(frame.getByRole('button', {name: 'Show 30 components of extractors'})).toHaveCount(1)
  // Joined links name the boundary, not the summary card's ID.
  await expect(frame.getByRole('button', {name: /^Inspect relationship extractors → sdk/})).toHaveCount(1)
  await expect(frame.locator('[data-entity-id="extractors/extractor-01"]')).toHaveCount(0)
  // Everything doesn't fit at the text floor, so the diff opens on its changes.
  const measured = await renderer.measure<{canvases: {zoom: number; changes: {count: number; inView: number}}[]}>('opening')
  const [canvas] = measured.canvases
  expect(canvas!.zoom).toBeGreaterThan(1)
  expect(canvas!.changes.inView).toBeGreaterThan(0)
  // No changed card is cut by the frame's edges.
  const cut = await frame.locator('[data-projections-scroll="graph"]').evaluate(scroller => {
    const view = scroller.getBoundingClientRect()
    return [...scroller.querySelectorAll('g.graph-node:not(.graph-group)[data-change]:not([data-change="unchanged"]) > rect.node-surface')]
      .map(card => card.getBoundingClientRect())
      .filter(card =>
        [
          [card.left, card.right, view.left],
          [card.left, card.right, view.right],
          [card.top, card.bottom, view.top],
          [card.top, card.bottom, view.bottom],
        ].some(([low, high, edge]) => low! < edge! - 1 && edge! + 1 < high!),
      ).length
  })
  expect(cut).toBe(0)
  // Activating a summary card opens its boundary, with a card to collapse it again.
  await frame.getByRole('button', {name: 'Show 30 components of extractors'}).click()
  await expect(frame.locator('[data-entity-id="extractors/extractor-01"]')).toHaveCount(1)
  await expect(frame.getByRole('button', {name: 'Collapse 30 components of extractors'})).toHaveCount(1)
})

test('expanding a boundary keeps the activated card where it was and the zoom as it was; selecting moves nothing', async ({page}) => {
  const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  const [before, after] = await Promise.all([fixture('large-architecture-before'), fixture('large-architecture-after')])
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, comparisonMode: 'diff', height: 650})
  const frame = renderer.frame
  const scroller = frame.locator('[data-projections-scroll="graph"]')
  const scale = async () => Number(await frame.locator('svg.graph').getAttribute('data-scale'))
  const corner = async (surface: ReturnType<typeof frame.locator>) => {
    const box = (await surface.boundingBox())!
    return {x: box.x, y: box.y}
  }
  const view = async () => scroller.evaluate(element => ({left: element.scrollLeft, top: element.scrollTop}))
  // Selecting a card already in view moves nothing.
  const opened = {scale: await scale(), view: await view()}
  // Dispatched, so that the test itself doesn't scroll a card into view.
  const card = frame.locator('g.graph-node[data-entity-id^="billing/"]').first()
  await card.dispatchEvent('click')
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(view).toEqual(opened.view)
  expect(await scale()).toBe(opened.scale)
  // The summary card is replaced by its boundary, whose top left corner is where the card's was, at the same scale.
  const summary = frame.locator('[data-graph-synthetic="boundary:extractors"] > rect.node-surface')
  const was = await corner(summary)
  await frame.getByRole('button', {name: 'Show 30 components of extractors'}).dispatchEvent('click')
  const boundary = frame.locator('[data-entity-id="extractors"] > rect.node-surface')
  await expect(boundary).toHaveCount(1)
  await expect(frame.locator('[data-entity-id="extractors/extractor-01"]')).toHaveCount(1)
  // Once the cards have moved there.
  await expect
    .poll(async () => {
      const now = await corner(boundary)
      return Math.max(Math.abs(now.x - was.x), Math.abs(now.y - was.y))
    })
    .toBeLessThan(3)
  expect(Math.abs((await scale()) - opened.scale)).toBeLessThan(1e-3)
})

test('a summary card shows it expands, and a double click expands it once without selecting text', async ({page}) => {
  const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  const [before, after] = await Promise.all([fixture('large-architecture-before'), fixture('large-architecture-after')])
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, comparisonMode: 'diff', height: 650})
  const frame = renderer.frame
  const summary = frame.getByRole('button', {name: 'Show 30 components of extractors'})
  // The card draws an expander.
  await expect(summary.locator('.node-expander [data-icon="expand"]')).toHaveCount(1)
  await summary.dblclick()
  await expect(frame.locator('[data-entity-id="extractors/extractor-01"]')).toHaveCount(1)
  // Its text wasn't selected: cards are controls.
  expect(await frame.locator('body').evaluate(() => document.getSelection()?.toString() ?? '')).toBe('')
  await expect(summary).toHaveCount(0)
  const collapse = frame.getByRole('button', {name: 'Collapse 30 components of extractors'})
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await expect(collapse.locator('.node-expander [data-icon="collapse"]')).toHaveCount(1)
  await expect(collapse).toHaveCSS('user-select', 'none')
  // Enter closes it again from the keyboard.
  await collapse.focus()
  await collapse.press('Enter')
  await expect(frame.locator('[data-entity-id="extractors/extractor-01"]')).toHaveCount(0)
  await expect(summary).toHaveCount(1)
})

test('a definition can give cards a subtitle, size them by a number and add worded labels, in sans', async ({page}) => {
  const {before, after} = capabilityUnits()
  const describe = (extraction: typeof before) => ({
    ...extraction,
    entities: extraction.entities.map(entity =>
      entity.kind === 'unit'
        ? {
            ...entity,
            data: {
              ...entity.data,
              purpose: `Serves the ${entity.label} for every request it gets`,
              lines: entity.label === 'server' ? 9000 : 100,
              checks: ['property tests'],
            },
          }
        : entity,
    ),
  })
  const options = {subtitle: '/data/purpose', sizeBy: '/data/lines', labels: '/data/checks', badges: '/data/capabilities'}
  const renderer = await openRenderer(page, {
    renderer: 'architecture',
    before: describe(before),
    after: describe(after),
    progress: 1,
    options,
  })
  const server = renderer.frame.locator('[data-entity-id="unit:server"]')
  const store = renderer.frame.locator('[data-entity-id="unit:store"]')
  // The subtitle wraps to the card's one width, a line per tspan.
  await expect(server.locator('.node-subtitle')).toContainText(/Serves the\s*server/)
  await expect(server.locator('.node-detail')).toHaveText('9K')
  // Every card keeps one width; the heavier card's gauge along its top edge is longer.
  const width = async (card: typeof server) => Number(await card.locator('.node-surface').getAttribute('width'))
  expect(await width(server)).toBe(await width(store))
  const gauge = async (card: typeof server) => (await card.locator('.node-gauge').boundingBox())?.width ?? 0
  expect(await gauge(server)).toBeGreaterThan(await gauge(store))
  // Labels are words, in sans; badges are code, in monospace; subtitles are sans.
  await expect(server.locator('.node-badge-text')).toHaveText(['property tests', 'network', 'filesystem'])
  await expect(server.locator('.node-badge-text').first()).not.toHaveAttribute('data-projections-identifier')
  await expect(server.locator('.node-badge-text').nth(1)).toHaveAttribute('data-projections-identifier', '')
  await expect(server.locator('.node-subtitle')).not.toHaveAttribute('data-projections-identifier')
  await expect.poll(async () => (await renderer.state()).legend?.items.at(-1)).toEqual({label: 'Top bar: lines'})
})

test("a field naming icons draws each before its card's kind, crossfades a changed one and ignores unknown names", async ({page}) => {
  const read = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  const [before, after] = [await read('icons-before'), await read('icons-after')]
  const renderer = await openRenderer(page, {renderer: 'architecture', before, after, progress: 0, options: {icon: '/data/icon'}})
  const icons = (id: string) => renderer.frame.locator(`[data-entity-id="${id}"] .node-icon`)
  await expect(icons('cli')).toHaveAttribute('data-card-icon', 'terminal')
  // A boundary shows its icon before its heading.
  await expect(icons('product')).toHaveAttribute('data-card-icon', 'package')
  // A name outside the renderer's icons draws nothing, and the summary bar says which cards name one.
  await expect(icons('site')).toHaveCount(0)
  await expect
    .poll(async () => ((await renderer.state()).summary ?? []).find(item => item.type === 'fact' && item.id === 'unknown-icons'))
    .toMatchObject({count: 1, ids: ['site'], icon: 'warning'})
  // The kind line starts after the icon, which sits at the text's left edge.
  const placed = await renderer.frame.locator('[data-entity-id="cli"]').evaluate(card => {
    const icon = card.querySelector('.node-icon')!.getBoundingClientRect()
    const kind = card.querySelector('.node-kind')!.getBoundingClientRect()
    const label = card.querySelector('.node-label')!.getBoundingClientRect()
    return {iconRight: icon.right, kindLeft: kind.left, iconLeft: icon.left, labelLeft: label.left}
  })
  expect(placed.kindLeft).toBeGreaterThan(placed.iconRight)
  expect(Math.abs(placed.iconLeft - placed.labelLeft)).toBeLessThan(3)
  // The engine's changed icon crossfades with its card's step: partway both are drawn, their opacities summing to one.
  const engine = () =>
    icons('engine').evaluateAll(nodes =>
      nodes.map(node => [node.getAttribute('data-card-icon'), Number(node.getAttribute('opacity'))] as const),
    )
  let crossed = false
  await renderer.scrub(
    Array.from({length: 21}, (_, index) => index / 20),
    async () => {
      const drawn = await engine()
      expect(drawn.reduce((sum, [, opacity]) => sum + opacity, 0)).toBeCloseTo(1, 2)
      if (drawn.length === 2) crossed = true
    },
  )
  expect(crossed).toBe(true)
  // At the end only the new icon, whole, in the kind line's muted color: no change emphasis remains on it.
  expect(await engine()).toEqual([['server', 1]])
  const colors = await renderer.frame.locator('[data-entity-id="engine"]').evaluate(card => ({
    icon: getComputedStyle(card.querySelector('.node-icon')!).color,
    kind: getComputedStyle(card.querySelector('.node-kind')!).fill,
  }))
  expect(colors.icon).toBe(colors.kind)
  // The diff shows the After revision's icon.
  const diff = await openRenderer(page, {renderer: 'architecture', before, after, comparisonMode: 'diff', options: {icon: '/data/icon'}})
  await expect(diff.frame.locator('[data-entity-id="engine"] .node-icon')).toHaveAttribute('data-card-icon', 'server')
  await expect(diff.frame.locator('[data-entity-id="worker"] .node-icon')).toHaveAttribute('data-card-icon', 'workflow')
})

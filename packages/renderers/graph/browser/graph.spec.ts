import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {featureFlags, fileReflow, layeredWaves} from '../../kit/browser/fixtures.js'
import {scrubSuite, selectionSuite} from '../../kit/browser/suite.js'
import {paneStatusSuite, statusSuite} from '../../kit/browser/status.js'

scrubSuite([fileReflow('graph'), fileReflow('graph-horizontal'), layeredWaves('graph'), featureFlags()])
selectionSuite(fileReflow('graph'), 'file:src/api.ts')
statusSuite(fileReflow('graph'))
statusSuite(layeredWaves('graph'))
paneStatusSuite({...featureFlags(), name: 'feature flags, reversed', before: featureFlags().after, after: featureFlags().before})

test('one bundle serves both orientations, chosen by the definition renderer name', async ({page}) => {
  const {before, after} = fileReflow()
  for (const [name, orientation] of [
    ['graph', 'vertical'],
    ['graph-horizontal', 'horizontal'],
  ] as const) {
    const renderer = await openRenderer(page, {renderer: name, before, after, progress: 1})
    await expect(renderer.frame.locator('svg.graph')).toHaveAttribute('data-orientation', orientation)
  }
})

test('feature flags: level rows, each team straight over its flag, and passkeys takes its two owners well apart', async ({page}) => {
  const {before, after} = featureFlags()
  for (const request of [{extraction: after}, {before, after, progress: 1}]) {
    const renderer = await openRenderer(page, {renderer: 'graph', ...request})
    await expect(renderer.frame.locator('.graph-node')).toHaveCount(6)
    // In the drawing's own units, so the measure is the same at any zoom.
    const drawn = await renderer.frame.locator('svg.graph').evaluate(svg => {
      const scale = (svg as SVGSVGElement).getScreenCTM()!.a
      const origin = svg.getBoundingClientRect()
      const cards = Object.fromEntries(
        [...svg.querySelectorAll<SVGGElement>('.graph-node[data-entity-id]')].map(node => {
          const rect = node.querySelector('.node-surface')!.getBoundingClientRect()
          return [node.dataset.entityId!, {top: (rect.top - origin.top) / scale, x: (rect.left + rect.width / 2 - origin.left) / scale}]
        }),
      )
      const links = Object.fromEntries(
        [...svg.querySelectorAll<SVGGElement>('.graph-link[data-entity-id]')].map(link => {
          const box = link.querySelector<SVGPathElement>('path.graph-edge')!.getBBox()
          const [x, y] = link.dataset.end!.split(',').map(Number)
          return [link.dataset.entityId!, {width: box.width, tip: {x: x!, y: y!}}]
        }),
      )
      return {cards, links}
    })
    for (const row of [
      ['team:design', 'team:payments', 'team:identity'],
      ['flag:dark-mode', 'flag:checkout-v2', 'flag:passkeys'],
    ]) {
      for (const id of row) {
        expect(Math.abs(drawn.cards[id]!.top - drawn.cards[row[0]!]!.top), `${id} level with ${row[0]}`).toBeLessThan(0.5)
      }
    }
    for (const [team, flag] of [
      ['design', 'dark-mode'],
      ['payments', 'checkout-v2'],
      ['identity', 'passkeys'],
    ] as const) {
      expect(Math.abs(drawn.cards[`team:${team}`]!.x - drawn.cards[`flag:${flag}`]!.x), `${team} over ${flag}`).toBeLessThan(0.5)
      expect(drawn.links[`owns:${team}:${flag}`]!.width, `${team} → ${flag} runs straight`).toBeLessThan(0.5)
    }
    const [shared, own] = [drawn.links['owns:payments:passkeys']!.tip, drawn.links['owns:identity:passkeys']!.tip]
    expect(Math.abs(shared.y - own.y)).toBeLessThan(0.5)
    expect(own.x - shared.x, 'arrowheads into passkeys stand well apart').toBeGreaterThan(34)
  }
})

test('extractions render every entity with no comparison language', async ({page}) => {
  const {after} = fileReflow()
  const renderer = await openRenderer(page, {renderer: 'graph', extraction: after})
  await expect(renderer.frame.locator('.graph-node')).toHaveCount(after.entities.length)
  await expect(renderer.frame.locator('.node-emphasis, .node-status, .pk-svg-status')).toHaveCount(0)
  expect((await renderer.state()).steps).toEqual([])
})

test('zoom is a set of host-drawn actions; Ctrl-wheel zoom stays a canvas gesture', async ({page}) => {
  const {before, after} = fileReflow()
  const renderer = await openRenderer(page, {renderer: 'graph', before, after, progress: 1})
  expect((await renderer.state()).controls.map(control => [control.id, control.type])).toEqual([
    ['zoom-out', 'action'],
    ['zoom-fit', 'action'],
    ['zoom-in', 'action'],
    // Card facts: every graph can show the `icon` field's icons and color its cards by kind; badges and relationship
    // colors need data fields and kinds.
    ['icon', 'choice'],
    ['colorBy', 'choice'],
  ])
  const scroller = renderer.frame.locator('.graph-scroll')
  await expect(renderer.frame.locator('.zoom-controls, .graph-footer button[aria-label^="Zoom"]')).toHaveCount(0)
  // The view opens fitted, or on a phone at the 8 px text floor (the test below).
  const zoom = async () => Number(await scroller.getAttribute('data-zoom'))
  await expect.poll(zoom).toBeGreaterThanOrEqual(1)
  const opening = await zoom()
  const step = (value: number) => Math.round(value * 1.5 * 1e6) / 1e6
  const width = () => renderer.frame.locator('svg.graph').evaluate(element => element.getBoundingClientRect().width)
  const opened = await width()
  await renderer.action('zoom-in')
  await expect.poll(zoom).toBeCloseTo(step(opening), 5)
  expect(await width()).toBeGreaterThan(opened * 1.4)
  const zoomed = await zoom()
  await renderer.action('zoom-in')
  await expect.poll(zoom).toBeGreaterThan(zoomed)
  const furthest = await zoom()
  await renderer.action('zoom-out')
  // Stepping back returns exactly, unless the step in stopped at the most a zoom may be.
  if (Math.abs(furthest - step(zoomed)) < 1e-5) await expect.poll(zoom).toBeCloseTo(zoomed, 5)
  else await expect.poll(zoom).toBeLessThan(furthest)
  await renderer.action('zoom-fit')
  await expect(scroller).toHaveAttribute('data-zoom', '1')
  await renderer.action('zoom-out')
  await expect(scroller).toHaveAttribute('data-zoom', '1')
  // An undeclared action is ignored by the host.
  await renderer.action('explode')
  await scroller.dispatchEvent('wheel', {deltaY: -400, ctrlKey: true})
  await expect.poll(async () => Number(await scroller.getAttribute('data-zoom'))).toBeGreaterThan(2)
})

test('a graph too small to read fitted opens at the 8 px text floor, keeps one framing while scrubbing, and Fit shows it all', async ({
  page,
}) => {
  const {before, after} = fileReflow('graph-horizontal')
  // A phone-sized pane: fitting the wide horizontal layout would draw its text at about 4 px.
  const renderer = await openRenderer(page, {
    renderer: 'graph-horizontal',
    before,
    after,
    progress: 0,
    comparisonMode: 'animated',
    width: 390,
    height: 700,
  })
  const scroller = renderer.frame.locator('.graph-scroll')
  const framing = () =>
    scroller.evaluate(element => {
      const svg = element.querySelector('svg.graph')!
      let smallest = Infinity
      for (const text of svg.querySelectorAll<SVGTextContentElement>('text, tspan')) {
        const matrix = text.getScreenCTM()
        if (matrix && text.textContent?.trim()) {
          smallest = Math.min(smallest, Number.parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b))
        }
      }
      return {
        zoom: Number(element.getAttribute('data-zoom')),
        scale: svg.getAttribute('data-scale'),
        viewBox: svg.getAttribute('viewBox'),
        scroll: [element.scrollLeft, element.scrollTop],
        overflows: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
        smallest,
      }
    })
  await expect.poll(async () => (await framing()).zoom).toBeGreaterThan(1)
  const opening = await framing()
  expect(opening.smallest).toBeCloseTo(8, 1)
  expect(opening.overflows).toBe(true)
  // Opens at the top of the content, never part way down it.
  expect(opening.scroll[1]).toBe(0)
  // Both endpoints share the framing: the scale, viewBox and scroll stay put through the transition and back.
  const ramp = Array.from({length: 21}, (_, index) => index / 20)
  for (const values of [ramp, [...ramp].reverse(), [0.7, 0.25, 1, 0.45, 0]]) {
    await renderer.scrub(values, async () => {
      const {zoom, scale, viewBox, scroll} = await framing()
      expect({zoom, scale, viewBox, scroll}).toEqual({
        zoom: opening.zoom,
        scale: opening.scale,
        viewBox: opening.viewBox,
        scroll: opening.scroll,
      })
    })
  }
  // Fit to view still shows everything, however small.
  await renderer.action('zoom-fit')
  await expect(scroller).toHaveAttribute('data-zoom', '1')
  await expect.poll(async () => (await framing()).overflows).toBe(false)
  expect((await framing()).smallest).toBeLessThan(8)
})

test('node names are monospace identifiers that stay inside their cards; kinds stay sans', async ({page}) => {
  const service = (id: string, label: string, kind = 'service') => ({id, kind, label})
  const entities = [
    service('gateway', 'gateway'),
    service('billing', 'legacy-billing-reconciliation-service'),
    service('wide', 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM'),
    service('file', 'src/integrations/billing/reconcile-ledger.ts', 'file'),
  ]
  const relationships = entities.slice(1).map(entity => ({id: `gateway->${entity.id}`, kind: 'dependency', from: 'gateway', to: entity.id}))
  const before = {protocolVersion: 0 as const, schema: 'graph/v0' as const, entities, relationships}
  const after = {
    ...before,
    entities: entities.map(entity => (entity.id === 'billing' ? {...entity, label: 'billing-reconciliation-service-v2'} : entity)),
  }
  const renderer = await openRenderer(page, {renderer: 'graph', before, after, progress: 0})
  await renderer.scrub([0, 0.25, 0.5, 0.75, 1], async progress => {
    const measured = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
    expect(measured.count, `node names are marked at ${progress}`).toBeGreaterThanOrEqual(entities.length)
    expect(measured.proportional).toEqual([])
    const fonts = await renderer.frame.locator('svg.graph').evaluate(svg => {
      const family = (selector: string) => [
        ...new Set([...svg.querySelectorAll(selector)].map(element => getComputedStyle(element).fontFamily)),
      ]
      const overflowing = [...svg.querySelectorAll<SVGGElement>('.graph-node:not(.graph-group)')].flatMap(node => {
        const card = node.querySelector('.node-surface')!.getBoundingClientRect()
        return [...node.querySelectorAll('.node-label')]
          .filter(label => {
            const box = label.getBoundingClientRect()
            return box.width > 0 && (box.left < card.left || box.right > card.right - 2)
          })
          .map(label => `${node.dataset.entityId}: ${label.textContent}`)
      })
      return {
        labels: family('.node-label'),
        kinds: family('.node-kind'),
        unmarked: svg.querySelectorAll('.node-label:not([data-projections-identifier])').length,
        overflowing,
      }
    })
    expect(fonts.unmarked).toBe(0)
    expect(fonts.overflowing, `labels overflow their cards at ${progress}`).toEqual([])
    expect(
      fonts.kinds.some(family => fonts.labels.includes(family)),
      'kind lines stay sans',
    ).toBe(false)
  })
})

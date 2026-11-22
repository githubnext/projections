import {expect, test} from '@playwright/test'
import {compareWithComparator, openRenderer, priorityOrderRules, samples} from '@githubnext/projections-renderer-harness/playwright'
import type {Extraction} from '@githubnext/projections-schemas'
import {loadFixture, loadPair} from '../test/fixtures.mjs'
import {checkRenderedFrame, measureRenderedFrame} from '../test/invariants.mjs'

const before = loadFixture('before') as Extraction
const after = loadFixture('after') as Extraction
const unit = (name: string) => `service:Orders:${name}:unkeyed`
const review = process.env.PROJECTIONS_REVIEW_DIR

type Measured = ReturnType<typeof measureRenderedFrame>

test('dense scrubbing in the real host frame keeps every frame coherent, still and deterministic', async ({page}, testInfo) => {
  test.setTimeout(120_000)
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 0})
  expect((await renderer.state()).bundle).toBe('dependency-injection')
  // One hold point per comparison step: remove, restructure, add.
  await expect.poll(async () => (await renderer.state()).steps.length).toBe(3)
  const body = renderer.frame.locator('body')
  const measure = (): Promise<Measured> => body.evaluate(measureRenderedFrame)
  const first = await measure()
  expect(first.viewBox).not.toBeNull()
  const positions = new Map<string, {x: number; y: number; width: number; height: number}>()
  const painted = new Map<number, string>()
  let frames = 0
  const visit = async (progress: number) => {
    const frame = await measure()
    expect(frame.progress, 'the painted frame is the requested progress').toBe(progress)
    expect(checkRenderedFrame(frame), `frame at ${progress}`).toEqual([])
    expect(frame.viewBox, `framing at ${progress}`).toBe(first.viewBox)
    for (const card of frame.cards) {
      const known = positions.get(card.id)
      if (!known) positions.set(card.id, card.box)
      else {
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(card.box[key] - known[key]), `${card.id} ${key} at ${progress}`).toBeLessThan(0.5)
        }
      }
    }
    const previous = painted.get(progress)
    if (previous === undefined) painted.set(progress, frame.html)
    else expect(frame.html, `the same frame in either direction at ${progress}`).toBe(previous)
    if (review && [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].includes(progress)) {
      await renderer.iframe.screenshot({path: `${review}/di-${testInfo.project.name}-${String(frames).padStart(3, '0')}-${progress}.png`})
    }
    frames++
  }
  // 104 steps out and back: 208 painted frames, then nonadjacent jumps.
  await renderer.scrub(samples(104, {roundTrip: true}), visit)
  await renderer.scrub([0.7, 0.25, 1, 0.01, 0.5, 0], visit)
  expect(frames).toBe(215)
  // Both endpoints' cards were seen, so every unit kept one place throughout.
  expect(positions.size).toBe(11)
})

test('painted frames follow the comparison steps and settle at every step end', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 0})
  const measure = (): Promise<Measured> => renderer.frame.locator('body').evaluate(measureRenderedFrame)
  const card = (frame: Measured, id: string) => frame.cards.find(item => item.id === id)
  const link = (frame: Measured, to: string) => frame.links.find(item => item.to === to)
  const [removed, restructured, added] = (await renderer.state()).steps as [number, number, number]
  await renderer.seek(removed)
  let frame = await measure()
  expect(card(frame, unit('IPricing'))).toBeUndefined()
  expect(card(frame, unit('IPriceCalculator'))).toBeUndefined()
  // A step end sits inside a hold: a little either side paints the same frame.
  await renderer.seek(removed + 0.01)
  expect((await measure()).html).toBe(frame.html)
  await renderer.seek(restructured)
  const lifetime = renderer.frame.locator(`[data-unit-id="${unit('IOrderRepository')}"] .di-lifetime-label`)
  await expect(lifetime).toHaveText('Singleton')
  const mark = renderer.frame.locator(`[data-unit-id="${unit('IOrderRepository')}"] .di-lifetime`)
  await expect(mark).toHaveClass(/singleton/u)
  frame = await measure()
  expect(card(frame, unit('IPriceCalculator'))).toBeUndefined()
  await renderer.seek(added)
  frame = await measure()
  expect(card(frame, unit('IPriceCalculator'))?.opacity).toBe(1)
  expect(link(frame, unit('IPriceCalculator'))?.opacity).toBe(1)
  await renderer.seek(0)
  await expect(lifetime).toHaveText('Scoped')
  await expect(mark).toHaveClass(/scoped/u)
})

test('a custom comparator order changes the painted order', async ({page}) => {
  const comparison = await compareWithComparator(before, after, priorityOrderRules, {priority: [unit('IPriceCalculator')]})
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, comparison, progress: 0})
  const measure = (): Promise<Measured> => renderer.frame.locator('body').evaluate(measureRenderedFrame)
  const card = (frame: Measured, id: string) => frame.cards.find(item => item.id === id)
  const [first, second] = (await renderer.state()).steps as [number, number]
  await renderer.seek(first)
  let frame = await measure()
  expect(card(frame, unit('IPriceCalculator'))?.opacity, 'arrivals come first').toBe(1)
  expect(card(frame, unit('IPricing'))?.opacity, 'legacy pricing has not left').toBe(1)
  expect(checkRenderedFrame(frame)).toEqual([])
  await renderer.seek(second)
  frame = await measure()
  expect(card(frame, unit('IPricing'))).toBeUndefined()
})

test('change emphasis follows the host highlighting and is gone at both endpoints', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 0})
  const emphasis = renderer.frame.locator('.node-emphasis, .node-footer-band, .node-status, .di-link-emphasis')
  await expect(emphasis).toHaveCount(0)
  const added = (await renderer.state()).steps.at(-1)!
  await renderer.seek(added)
  // Changed cards take the kit graph card's marks: a tinted fill under a strong edge, and the status band.
  await expect(renderer.frame.locator('.node-emphasis.added:not(.node-emphasis-edge)')).toHaveCount(2)
  await expect(renderer.frame.locator('.node-footer-band.added')).toHaveCount(2)
  await expect(renderer.frame.locator('.node-emphasis.modified').first()).toBeVisible()
  await renderer.seek(added, {highlighting: 'off'})
  await expect(emphasis).toHaveCount(0)
  await renderer.seek(1)
  await expect(emphasis).toHaveCount(0)
})

test('card parts and arrows select their rows, by pointer and keyboard, and the host selection wins', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 1})
  const repository = renderer.frame.locator(`[data-unit-id="${unit('IOrderRepository')}"]`)
  await repository.getByRole('button', {name: /^Inspect registration of IOrderRepository, Singleton/u}).click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe(`${unit('IOrderRepository')}:registration:0`)
  await expect(repository).toHaveClass(/selected/u)
  await renderer.select(unit('IOrderRepository'))
  await expect(repository.getByRole('button', {name: /^Inspect contract IOrderRepository/u})).toHaveAttribute('aria-pressed', 'true')
  const arrow = renderer.frame.getByRole('button', {name: /^Inspect constructor dependency prices, Added/u})
  await arrow.focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('dependsOn:OrderService:prices')
  // A selected unit labels its arrows with their parameters.
  await renderer.select(unit('IPriceCalculator'))
  await expect(renderer.frame.locator('.di-parameter', {hasText: 'prices'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBeNull()
})

test('the composition opens fitted to the frame (or at the 8 px text floor), never magnified; zoom enlarges it about its root, in either color mode', async ({
  page,
}, testInfo) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 0.5, colorMode: 'dark'})
  expect((await renderer.state()).controls.map(control => control.id)).toEqual(['zoom-out', 'zoom-fit', 'zoom-in'])
  const measure = () =>
    renderer.frame.locator('body').evaluate(() => {
      const scroll = document.querySelector('.di-scroll')!
      const card = document.querySelector('.di-card-surface')!.getBoundingClientRect()
      const root = document
        .querySelector('[data-unit-id="service:Orders:OrdersController:unkeyed"] .di-card-surface')!
        .getBoundingClientRect()
      const pane = scroll.getBoundingClientRect()
      const surfaces = [...document.querySelectorAll('.di-card-surface')].map(element => element.getBoundingClientRect())
      const outside = surfaces.filter(
        box => box.left < pane.left - 0.5 || box.top < pane.top - 0.5 || box.right > pane.right + 0.5 || box.bottom > pane.bottom + 0.5,
      ).length
      return {
        spine: root.x + root.width / 2 - (pane.x + pane.width / 2),
        rootInView: root.left >= pane.left - 0.5 && root.left < pane.right && root.top >= pane.top - 0.5,
        cutAtLeft: surfaces.filter(
          box => box.left < pane.left - 0.5 && box.right > pane.left + 0.5 && box.top < pane.bottom && box.bottom > pane.top,
        ).length,
        page: document.documentElement.scrollWidth - window.innerWidth,
        scroll: Math.max(scroll.scrollWidth - scroll.clientWidth, scroll.scrollHeight - scroll.clientHeight),
        card: card.width,
        outside,
        zoom: Number(scroll.getAttribute('data-zoom')),
        smallestText: Math.min(
          ...[...document.querySelectorAll('svg text, svg tspan')]
            .filter(text => text.textContent.trim() !== '' && text.getClientRects().length > 0)
            .map(
              text =>
                parseFloat(getComputedStyle(text).fontSize) *
                Math.hypot((text as SVGGraphicsElement).getScreenCTM()!.a, (text as SVGGraphicsElement).getScreenCTM()!.b),
            ),
        ),
      }
    })
  const opening = await measure()
  expect(opening.page, 'the frame document never overflows').toBeLessThanOrEqual(1)
  // It opens fitted, every card in view and nothing to scroll to, unless that draws text below the 8 px floor (a phone):
  // then at the floor, scrolled to the top centre. Either way centred on its root, but at the floor never with a card
  // cut at the left edge: there the root may sit off centre, its left side in view (the kit's contentStart).
  if (opening.zoom === 1) {
    expect(opening.outside, 'every card is in view on open').toBe(0)
    expect(opening.scroll, 'nothing to scroll to on open').toBeLessThanOrEqual(1)
  } else {
    expect(opening.zoom, 'never opens below the fit').toBeGreaterThan(1)
    expect(opening.smallestText, 'opens at the 8 px text floor').toBeCloseTo(8, 1)
    expect(await renderer.frame.locator('.di-scroll').evaluate(element => element.scrollTop), 'opens at the top').toBe(0)
  }
  testInfo.annotations.push({type: 'smallest text', description: `${opening.smallestText.toFixed(1)}px`})
  if (opening.zoom === 1) expect(Math.abs(opening.spine), 'the composition opens centred on its root').toBeLessThan(2)
  else {
    expect(opening.rootInView, 'the composition opens on its root').toBe(true)
    expect(opening.cutAtLeft, 'no card is cut at the left edge').toBe(0)
  }
  await renderer.action('zoom-fit')
  await expect.poll(async () => (await measure()).zoom, 'Fit shows the whole composition').toBe(1)
  const layout = await measure()
  // Authored cards are 300 units wide: never magnified, and the whole composition is in view however narrow the frame.
  expect(layout.card).toBeLessThanOrEqual(300.5)
  expect(layout.scroll, 'fitted: nothing to scroll to').toBeLessThanOrEqual(1)
  expect(layout.outside, 'every card is in view').toBe(0)
  await renderer.action('zoom-out')
  await expect.poll(async () => (await measure()).zoom, 'fitted is the least zoom').toBe(1)
  await renderer.action('zoom-in')
  await expect.poll(async () => (await measure()).card).toBeGreaterThan(Math.min(300, layout.card * 1.4))
  expect(Math.abs((await measure()).spine), 'zoom keeps the root centred').toBeLessThan(2)
  await renderer.action('zoom-fit')
  await expect.poll(async () => (await measure()).card).toBeCloseTo(layout.card, 1)
  // The legend is the host's: none in the frame, and the runtime-resolution line is in the one the renderer reports.
  await expect(renderer.frame.getByRole('group', {name: /legend/iu})).toHaveCount(0)
  expect((await renderer.state()).legend?.items.map(item => item.label)).toContain('Resolved at runtime')
  if (review) await renderer.iframe.screenshot({path: `${review}/di-${testInfo.project.name}-dark-mid.png`})
})

test('a single revision presents the composition with no steps and no emphasis', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', extraction: after})
  expect(await renderer.state()).toMatchObject({rendered: 1, steps: []})
  await expect(renderer.frame.locator('.di-card')).toHaveCount(10)
  await expect(renderer.frame.locator('.di-card-emphasis, .di-change-marker')).toHaveCount(0)
  await expect(renderer.frame.locator('svg.di-canvas .di-link.resolution')).toHaveCount(1)
})

test('the scoring pair rewires through an inserted unit with every frame coherent', async ({page}, testInfo) => {
  test.setTimeout(60_000)
  const scoring = loadPair('scoring')
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', ...scoring, progress: 0})
  const measure = (): Promise<Measured> => renderer.frame.locator('body').evaluate(measureRenderedFrame)
  const viewBox = (await measure()).viewBox
  const painted = new Map<number, string>()
  await renderer.scrub(samples(60, {roundTrip: true}), async progress => {
    const frame = await measure()
    expect(checkRenderedFrame(frame), `scoring frame at ${progress}`).toEqual([])
    expect(frame.viewBox).toBe(viewBox)
    const previous = painted.get(progress)
    if (previous === undefined) painted.set(progress, frame.html)
    else expect(frame.html, `the same scoring frame in either direction at ${progress}`).toBe(previous)
    if (review && [0, 0.25, 0.5, 0.7, 1].includes(progress)) {
      await renderer.iframe.screenshot({path: `${review}/di-scoring-${testInfo.project.name}-${progress}.png`})
    }
  })
})

test('type names, keys and parameters are monospace identifiers that never run into the sans lifetime', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 1})
  await renderer.select(unit('IPriceCalculator'))
  await expect(renderer.frame.locator('.di-parameter[data-projections-identifier]', {hasText: 'prices'})).toBeVisible()
  const measured = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(measured.count).toBeGreaterThan(10)
  expect(measured.proportional).toEqual([])
  const cards = await renderer.frame.locator('svg.di-canvas').evaluate(svg =>
    [...svg.querySelectorAll<SVGGElement>('.di-card')].map(card => {
      const box = (selector: string) => card.querySelector(selector)?.getBoundingClientRect()
      const surface = box('.di-card-surface')!,
        contract = box('.di-contract'),
        implementation = box('.di-implementation')!
      const lifetime = box('.di-lifetime-label')!,
        note = box('.di-key')
      return {
        id: card.dataset.unitId,
        marked:
          card.querySelectorAll('.di-contract, .di-implementation').length ===
          card.querySelectorAll('.di-contract[data-projections-identifier], .di-implementation[data-projections-identifier]').length,
        lifetimeMarked: card.querySelector('.di-lifetime-label')!.hasAttribute('data-projections-identifier'),
        keyMarked: card.querySelector('.di-key') ? !card.querySelector('.di-key')!.hasAttribute('data-projections-identifier') : true,
        clear:
          (!contract || contract.right <= lifetime.left) &&
          (!note || implementation.right <= note.left) &&
          implementation.right <= surface.right,
        fonts: [card.querySelector('.di-implementation'), card.querySelector('.di-lifetime-label')].map(
          element => getComputedStyle(element!).fontFamily,
        ),
      }
    }),
  )
  for (const card of cards) {
    expect(card.marked && !card.lifetimeMarked && card.keyMarked, `${card.id} marks only its type names`).toBe(true)
    expect(card.clear, `${card.id} type names stop before the text beside them`).toBe(true)
    expect(card.fonts[0], `${card.id} lifetime stays sans`).not.toBe(card.fonts[1])
  }
  await expect(renderer.frame.locator('.di-key tspan[data-projections-identifier]').first()).toBeVisible()
})

for (const [scenario, units] of [
  ['nestjs-orders', 10],
  ['spring-orders', 19],
] as const) {
  test(`the real ${scenario} composition scrubs coherently in either color mode`, async ({page}, testInfo) => {
    test.setTimeout(90_000)
    const pair = loadPair(scenario)
    for (const colorMode of ['light', 'dark'] as const) {
      const renderer = await openRenderer(page, {renderer: 'dependency-injection', ...pair, progress: 0, colorMode})
      const measure = (): Promise<Measured> => renderer.frame.locator('body').evaluate(measureRenderedFrame)
      const viewBox = (await measure()).viewBox
      const ids = new Set<string>()
      await renderer.scrub(samples(40, {roundTrip: true}), async progress => {
        const frame = await measure()
        expect(checkRenderedFrame(frame), `${scenario} frame at ${progress}`).toEqual([])
        expect(frame.viewBox).toBe(viewBox)
        for (const card of frame.cards) ids.add(card.id)
        if (review && [0, 0.5, 1].includes(progress)) {
          await renderer.iframe.screenshot({path: `${review}/di-${scenario}-${colorMode}-${testInfo.project.name}-${progress}.png`})
        }
      })
      expect(ids.size, 'every card of either revision').toBe(units)
      // Container scope names, and for Nest the alias, are on the cards and in the legend.
      await expect(
        renderer.frame.locator('.di-lifetime-label', {hasText: scenario === 'nestjs-orders' ? 'Request' : 'Prototype'}).first(),
      ).toBeVisible()
      if (scenario === 'nestjs-orders') {
        expect((await renderer.state()).legend?.items.map(item => item.label)).toContain('Alias: the same instance')
        await expect(renderer.frame.locator('svg.di-canvas .di-link.alias')).toHaveCount(1)
      }
    }
  })
}

test('arrows are painted over the cards, so a head stays whole where it meets a border', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 1})
  const under = await renderer.frame
    .locator('svg')
    .first()
    .evaluate(svg => {
      const cards = [...svg.querySelectorAll('.di-card-surface')]
      return [...svg.querySelectorAll('.di-link')].filter(link =>
        cards.some(card => !(card.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)),
      ).length
    })
  expect(under).toBe(0)
})

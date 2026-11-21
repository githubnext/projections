import {expect, test} from '@playwright/test'
import type {Locator} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {Extraction} from '@githubnext/projections-schemas'
import {loadFixture} from '../test/fixtures.mjs'

// Close-ups for review (SOURCE_DOT_SHOTS=<directory>) are taken at three times the size.
if (process.env.SOURCE_DOT_SHOTS) test.use({deviceScaleFactor: 3})

const before = loadFixture('before') as Extraction
const after = loadFixture('after') as Extraction

interface CardState {
  /** SVG elements in the card painting an outline (browsers ring their bounding box). */
  outlined: string[]
  /** The SDK's ring on the card (its state, or none), and whether it is the card surface's own restyled stroke. */
  ring: {state: string; inside: boolean}
  /** The instance line's stroke, which keeps its own token in every state. */
  lifetime: string
}

const cardState = (card: Element): CardState => {
  const outlined = [card, ...card.querySelectorAll('*')]
    .filter(node => {
      const style = getComputedStyle(node)
      return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
    })
    .map(node => node.getAttribute('class') ?? node.tagName)
  // The ring is the card surface's own stroke: the surface is the marked edge, and its stroke shows the state.
  const surface = card.querySelector<SVGGraphicsElement>('.di-card-surface')!
  const style = getComputedStyle(surface)
  const state = card.matches(':focus-visible, :has(:focus-visible)')
    ? 'focus'
    : card.hasAttribute('data-projections-ring-selected')
      ? 'selected'
      : 'none'
  const inside = surface.hasAttribute('data-projections-edge') && style.vectorEffect === 'non-scaling-stroke'
  return {
    outlined,
    ring: {state, inside: state === 'none' || inside},
    lifetime: getComputedStyle(card.querySelector('.di-lifetime')!).stroke,
  }
}

test('a card is one focus and selection ring: parts never outline, nothing overflows, the lifetime mark keeps its color', async ({
  page,
}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 1})
  const frame = renderer.frame
  const card = frame
    .locator('.di-card')
    .filter({has: frame.locator('.di-zone-registration')})
    .filter({has: frame.locator('.di-zone-contract')})
    .first()
  await expect(card).toHaveCount(1)
  const rest = await card.evaluate(cardState)
  expect(rest.outlined).toEqual([])
  expect(rest.ring.state, 'no ring at rest').toBe('none')

  // Walk every part of the card with the keyboard: one ring on the card, in the focus color, inside its edge.
  await card.locator('.di-zone').first().focus()
  const zones = await card.locator('.di-zone').count()
  for (let index = 0; index < zones; index += 1) {
    if (index) await page.keyboard.press('Tab')
    const state = await card.evaluate(cardState)
    expect(state.outlined, `part ${index}: no outline on any SVG element`).toEqual([])
    expect(state.ring.state, `part ${index}: the card's ring shows focus`).toBe('focus')
    expect(state.ring.inside, `part ${index}: the ring is the card's own edge`).toBe(true)
    expect(state.lifetime, `part ${index}: the lifetime mark keeps its color`).toBe(rest.lifetime)
  }

  // Selecting a part rings the card once, still inside its edge.
  await card.locator('.di-zone').first().click()
  await page.mouse.move(0, 0)
  const selected = await card.evaluate(cardState)
  expect(selected.outlined).toEqual([])
  expect(selected.ring.state).toBe('selected')
  expect(selected.ring.inside).toBe(true)
  expect(selected.lifetime).toBe(rest.lifetime)
})

test("a link's source dot takes its line's color while the link is hovered or selected", async ({page}, info) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', extraction: after})
  // Each link's clear copy of its origin dot, drawn over every link, takes the ring's color with the link.
  const ring = renderer.frame.locator('.di-link-origin-ring').first()
  const id = (await ring.getAttribute('data-projections-ring-with'))!
  const link = renderer.frame.locator(`g[data-entity-id="${id}"]`)
  const colors = async () => ({
    line: await link.locator('.di-link').evaluate(line => getComputedStyle(line).stroke),
    dot: await ring.evaluate(dot => getComputedStyle(dot).fill),
  })
  const resting = (await colors()).line
  for (const state of ['hover', 'selection'] as const) {
    await (state === 'hover' ? renderer.hover(id) : renderer.select(id))
    await expect.poll(async () => (await colors()).line, `${state}: the line takes the ring's color`).not.toBe(resting)
    // Close-ups for review: SOURCE_DOT_SHOTS=<directory>.
    if (process.env.SOURCE_DOT_SHOTS && state === 'hover') {
      await page.screenshot({
        path: `${process.env.SOURCE_DOT_SHOTS}/dependency-injection-${info.project.name}.png`,
        clip: await clipAround(ring),
      })
    }
    const {line, dot} = await colors()
    expect(dot, `${state}: the source dot takes the line's color`).toBe(line)
    await (state === 'hover' ? renderer.hover(null) : renderer.select(null))
  }
})

test("a link's origin dot shows its ring color where later links leave the same point", async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', extraction: after})
  // A link whose origin a later link shares: the later link's dot is drawn after it.
  const shared = await renderer.frame.locator('.di-link-origins').evaluate(layer => {
    const copies = [...layer.querySelectorAll<SVGCircleElement>('.di-link-origin-ring')]
    const at = (copy: SVGCircleElement) => `${copy.getAttribute('cx')},${copy.getAttribute('cy')}`
    const first = copies.find((copy, index) => copies.slice(index + 1).some(later => at(later) === at(copy)))
    return first?.getAttribute('data-projections-ring-with') ?? null
  })
  expect(shared, 'the fixture has links leaving a card at one point').not.toBeNull()
  await renderer.hover(shared)
  const ring = renderer.frame.locator(`.di-link-origin-ring[data-projections-ring-with="${shared}"]`)
  const read = () => ring.evaluate(dot => getComputedStyle(dot).fill)
  await expect.poll(read, 'the hovered link takes the ring').not.toBe('rgba(0, 0, 0, 0)')
  const fill = await read()
  // The painted pixel at the dot's centre, from a screenshot: what a person sees, not what the style says.
  const box = (await ring.boundingBox())!
  const shot = await page.screenshot({clip: {x: box.x + box.width / 2, y: box.y + box.height / 2, width: 1, height: 1}})
  const pixel = await page.evaluate(async data => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, shot.toString('base64'))
  const expected = fill
    .match(/\d+(\.\d+)?/g)!
    .slice(0, 3)
    .map(Number)
  expect(
    pixel.every((channel, index) => Math.abs(channel - expected[index]!) <= 8),
    `the dot is painted ${pixel.join(',')}, the ring is ${expected.join(',')}`,
  ).toBe(true)
})

/** The link's source end, with room around it. */
async function clipAround(ring: Locator) {
  const dot = (await ring.boundingBox())!
  return {x: dot.x - 80, y: dot.y - 50, width: 160, height: 100}
}

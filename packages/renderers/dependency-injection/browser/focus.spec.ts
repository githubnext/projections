import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {Extraction} from '@githubnext/projections-schemas'
import {loadFixture} from '../test/fixtures.mjs'

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
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
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

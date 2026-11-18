import {test as base, expect} from '@playwright/test'
import type {Frame, Page} from '@playwright/test'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

/** One painted frame of the schema while it moves: whether it is moving, and every link's start and opacity. */
interface Sample {
  moving: boolean
  links: {key: string; opacity: number; x: number; y: number; attached: boolean}[]
}

/** The schema's renderer frame. */
async function schema(page: Page): Promise<Frame> {
  const element = page.locator('.ph iframe').first()
  await expect(element).toBeVisible()
  const frame = await (await element.elementHandle())!.contentFrame()
  await expect(frame!.locator('.database-table').first()).toBeVisible()
  return frame!
}

/**
 * Runs `act` in the renderer and samples every painted frame until the schema has settled: each link's start (in the
 * canvas's units) and whether it touches the left or right side of a card, as a drawn link always leaves its row.
 */
async function sampleMove(frame: Frame, act: () => Promise<void>): Promise<Sample[]> {
  await frame.evaluate(() => {
    const samples: Sample[] = []
    const window_ = window as unknown as {samples: Sample[]; sampling: boolean}
    window_.samples = samples
    window_.sampling = true
    const read = () => {
      const view = document.querySelector<HTMLElement>('.database-view')!
      const cards = [...view.querySelectorAll<HTMLElement>('.database-table')].map(card => ({
        x: parseFloat(card.style.left),
        y: parseFloat(card.style.top),
        width: parseFloat(card.style.width),
        height: parseFloat(card.style.height),
      }))
      // How visible each link is: its own opacity and its layer's, which nothing may hide while the schema moves.
      const layer = Number(getComputedStyle(view.querySelector('.database-links')!).opacity)
      const links = [...view.querySelectorAll<SVGGElement>('[data-link-key]')].map(group => {
        const [x, y] = (
          group
            .querySelector('path.database-link')!
            .getAttribute('d')!
            .match(/-?[\d.]+/g) ?? []
        )
          .slice(0, 2)
          .map(Number)
        const attached = cards.some(
          card => Math.min(Math.abs(x! - card.x), Math.abs(x! - card.x - card.width)) < 1.5 && y! > card.y && y! < card.y + card.height,
        )
        // By relationship: one drawn another way in each layout (between rows, or the tables' headers) is the same link.
        return {key: group.dataset.entityId!, opacity: layer * Number(group.getAttribute('opacity') ?? 1), x: x!, y: y!, attached}
      })
      samples.push({moving: view.hasAttribute('data-moving'), links})
      if (window_.sampling) requestAnimationFrame(read)
    }
    requestAnimationFrame(read)
  })
  await act()
  // Past the move (320 ms) and a few frames more.
  await frame.waitForTimeout(700)
  return frame.evaluate(() => {
    const window_ = window as unknown as {samples: Sample[]; sampling: boolean}
    window_.sampling = false
    return window_.samples
  })
}

/**
 * Relationships drawn on both sides of a move never leave the drawing, never fade, and stay attached to their cards
 * while it moves.
 */
function expectAttached(samples: Sample[], label: string) {
  const first = samples[0]!,
    last = samples.at(-1)!
  const kept = [...new Set(first.links.map(link => link.key))].filter(key => last.links.some(link => link.key === key))
  expect(kept.length, `${label}: some relationships are drawn on both sides of the move`).toBeGreaterThan(0)
  expect(samples.filter(sample => sample.moving).length, `${label}: the schema moves over several frames`).toBeGreaterThan(3)
  // A relationship's link drawn whole and attached at a frame (a relationship of several columns has several).
  const drawn = (sample: Sample, key: string) => sample.links.find(item => item.key === key && item.opacity > 0.99 && item.attached)
  for (const [index, sample] of samples.entries())
    for (const key of kept) expect(drawn(sample, key), `${label}: ${key} is drawn whole, on its cards, at frame ${index}`).toBeTruthy()
  // A link that travels far glides there over several frames, rather than jumping.
  for (const key of kept) {
    const starts = samples.map(sample => drawn(sample, key)!)
    const travel = Math.hypot(starts.at(-1)!.x - starts[0]!.x, starts.at(-1)!.y - starts[0]!.y)
    if (travel < 40) continue
    const steps = starts.slice(1).map((point, index) => Math.hypot(point.x - starts[index]!.x, point.y - starts[index]!.y))
    expect(Math.max(...steps), `${label}: ${key} glides ${Math.round(travel)} px`).toBeLessThan(travel * 0.6)
  }
}

async function open(page: Page, theme: Theme) {
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto(
    new URL(
      `iframe.html?id=default-ui-renderers--database&viewMode=story&globals=theme:${theme}&args=initialMode:diff`,
      process.env.PROJECTIONS_STORYBOOK_URL,
    ).href,
  )
  await expect(page.locator('.ph[data-renderer-status="ready"]').first()).toBeVisible({timeout: 30_000})
  return schema(page)
}

test('opening and closing a fold and switching to All move the schema with every link attached', async ({page, theme}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-light', 'motion does not depend on the theme or browser')
  const frame = await open(page, theme)
  const fold = frame.locator('.database-fold-button').first()
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  const table = (await fold.evaluate(button => button.closest('[data-entity-id]')!.getAttribute('data-entity-id')))!
  expectAttached(await sampleMove(frame, () => fold.click()), 'opening a fold')
  // The open fold stays in its place, as the way to fold the columns again, from the keyboard too.
  const hide = frame.locator(`section[data-entity-id=${JSON.stringify(table)}] .database-fold-button[aria-expanded="true"]`)
  await expect(hide).toHaveText(/^Hide /)
  expectAttached(await sampleMove(frame, () => hide.press('Enter')), 'closing it')
  await expect(frame.locator(`section[data-entity-id=${JSON.stringify(table)}] .database-fold-button`)).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  const all = page.locator('.ph-scope [data-scope="all"]').first()
  expectAttached(await sampleMove(frame, () => all.click()), 'switching to All')
  await expect(frame.locator('.database-fold-button')).toHaveCount(0)
})

test('under reduced motion the schema jumps to its new layout', async ({page, theme}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-light', 'motion does not depend on the theme or browser')
  await page.emulateMedia({reducedMotion: 'reduce'})
  const frame = await open(page, theme)
  const samples = await sampleMove(frame, () => frame.locator('.database-fold-button').first().click())
  expect(samples.some(sample => sample.moving)).toBe(false)
  expect(samples.at(-1)!.links.every(link => link.opacity > 0.99 && link.attached)).toBe(true)
})

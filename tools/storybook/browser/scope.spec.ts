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
    const window_ = globalThis as unknown as {samples: Sample[]; sampling: boolean}
    window_.samples = samples
    window_.sampling = true
    const read = () => {
      const view = document.querySelector<HTMLElement>('.database-view')!
      const cards = [...view.querySelectorAll<HTMLElement>('.database-table')].map(card => ({
        x: Number.parseFloat(card.style.left),
        y: Number.parseFloat(card.style.top),
        width: Number.parseFloat(card.style.width),
        height: Number.parseFloat(card.style.height),
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
    const window_ = globalThis as unknown as {samples: Sample[]; sampling: boolean}
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
  for (const [index, sample] of samples.entries()) {
    for (const key of kept) expect(drawn(sample, key), `${label}: ${key} is drawn whole, on its cards, at frame ${index}`).toBeTruthy()
  }
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

/**
 * A horizontal line an element paints: a border, an inset shadow's top or bottom edge, an inset outline's, or the strip
 * an outer shadow without blur shows above or below the element (a change run's edges, drawn over its neighbours' lines).
 */
interface Line {
  y: number
  /** Its thickness. */
  width: number
  left: number
  right: number
  by: string
}

/**
 * Every pair of horizontal lines in the renderer document drawn side by side: overlapping across, and touching or under
 * 2 px apart (lines that share pixels draw as one). Rows separated by one line each never have such a pair.
 */
async function doubledLines(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => {
    const lines: Line[] = []
    const drawn = (color: string) => color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color)
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 2).join('.')}${element.getAttribute('data-entity-id') ? `[${element.getAttribute('data-entity-id')}]` : ''}`
    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      if (element.closest('svg')) continue
      const box = element.getBoundingClientRect()
      if (box.width < 8 || box.height < 2) continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      // Only what its clipping ancestors leave in view is drawn.
      let top = -Infinity,
        bottom = Infinity
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow !== 'visible' || getComputedStyle(parent).clipPath.startsWith('inset(')) {
          const clip = parent.getBoundingClientRect()
          top = Math.max(top, clip.top)
          bottom = Math.min(bottom, clip.bottom)
        }
      }
      const add = (y: number, width: number, left = box.left, right = box.right) => {
        if (y >= top && y < bottom) lines.push({y, width, left, right, by: name(element)})
      }
      for (const side of ['Top', 'Bottom'] as const) {
        const width = Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`))
        if (
          width > 0 &&
          style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' &&
          drawn(style.getPropertyValue(`border-${side.toLowerCase()}-color`))
        ) {
          add(side === 'Top' ? box.top : box.bottom - width, width)
        }
      }
      // An inset shadow with only a vertical offset, or a spread, draws a top or bottom edge. An outer shadow without blur
      // draws the element's box moved by its offset and grown by its spread: what shows above or below the box is a line.
      for (const shadow of style.boxShadow === 'none' ? [] : style.boxShadow.split(/,(?![^(]*\))/)) {
        const color = /(rgba?|color)\([^)]*\)/.exec(shadow)?.[0] ?? ''
        if (!drawn(color)) continue
        const [x = 0, y = 0, blur = 0, spread = 0] = (shadow.replace(color, '').match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat)
        if (!shadow.includes('inset')) {
          if (blur > 0) continue
          const [above, below] = [box.top + y - spread, box.bottom + y + spread]
          const [left, right] = [box.left + x - spread, box.right + x + spread]
          if (above < box.top) add(above, box.top - above, left, right)
          if (below > box.bottom) add(box.bottom, below - box.bottom, left, right)
        } else if (spread > 0) {
          add(box.top + Number.parseFloat(style.borderTopWidth), spread)
          add(box.bottom - Number.parseFloat(style.borderBottomWidth) - spread, spread)
        } else if (x === 0 && y > 0) add(box.top + Number.parseFloat(style.borderTopWidth), y)
        else if (x === 0 && y < 0) add(box.bottom - Number.parseFloat(style.borderBottomWidth) + y, -y)
      }
      const outline = Number.parseFloat(style.outlineWidth)
      if (style.outlineStyle !== 'none' && outline > 0 && Number.parseFloat(style.outlineOffset) <= -outline && drawn(style.outlineColor)) {
        add(box.top, outline)
        add(box.bottom - outline, outline)
      }
    }
    const doubled: string[] = []
    for (const [index, a] of lines.entries()) {
      for (const b of lines.slice(index + 1)) {
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        // Lines that share pixels draw as one; lines that touch, or nearly, draw as two.
        const gap = Math.max(a.y, b.y) - Math.min(a.y + a.width, b.y + b.width)
        if (across > 8 && gap > -0.5 && gap < 2) doubled.push(`${a.by} at ${a.y.toFixed(1)} beside ${b.by} at ${b.y.toFixed(1)}`)
      }
    }
    return doubled
  })
}

test('the measure finds a change edge drawn beside the line it should cover', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-light', 'a measurement, not a layout')
  // A row's bottom line, then a row whose outer top edge (as a change run draws it) lies on that line, or a pixel below.
  const rows = (offset: number) =>
    `<div style="width: 300px"><div style="height: 20px; border-bottom: 1px solid #888"></div><div style="height: 20px; margin-top: ${offset}px; box-shadow: -1px -1px 0 0 #1a7f37, 1px -1px 0 0 #1a7f37"></div></div>`
  await page.setContent(rows(0))
  expect(await doubledLines(page.mainFrame()), 'on the line').toEqual([])
  await page.setContent(rows(1))
  expect(await doubledLines(page.mainFrame()), 'beside it').not.toEqual([])
})

for (const story of ['api', 'database', 'text-diff', 'text-diff-one-column', 'code-statistics', 'runtime-policy']) {
  test(`${story}: every boundary between rows is one line, in Diff and Animated, Changes and All`, async ({page, theme}, testInfo) => {
    // Lines are laid out alike in every engine; the light and dark projects cover both themes. Four presentations a test.
    test.skip(
      !testInfo.project.name.startsWith('chromium-light') && !testInfo.project.name.startsWith('chromium-dark'),
      'layout, not engine',
    )
    test.setTimeout(120_000)
    await page.setViewportSize({width: 1440, height: 900})
    for (const mode of ['diff', 'animated']) {
      for (const changesOnly of [true, false]) {
        await page.goto(
          new URL(
            `iframe.html?id=default-ui-renderers--${story}&viewMode=story&globals=theme:${theme}&args=initialMode:${mode};changesOnly:!${changesOnly}`,
            process.env.PROJECTIONS_STORYBOOK_URL,
          ).href,
        )
        await expect(page.locator('.ph[data-renderer-status="ready"]').first()).toBeVisible({timeout: 30_000})
        const element = page.locator('.ph iframe').first()
        const frame = (await (await element.elementHandle())!.contentFrame())!
        await page.waitForTimeout(800)
        expect(await doubledLines(frame), `${story}, ${mode}, ${changesOnly ? 'Changes' : 'All'}`).toEqual([])
      }
    }
  })
}

/**
 * Every entity element the renderer draws: where it is, whether the host's filter leaves it out and how far that
 * recedes it (its own `filter: opacity()` or, inside SVG, its opacity), and how far it recedes with its ancestors.
 */
async function entities(frame: Frame) {
  return frame.evaluate(() => {
    const recede = (element: Element) => {
      if (!element.hasAttribute('data-projections-filtered')) return 1
      const style = getComputedStyle(element)
      return element.closest('svg') ? Number(style.opacity) : Number(/opacity\(([\d.]+)\)/.exec(style.filter)?.[1] ?? 1)
    }
    return [...document.querySelectorAll('[data-entity-id]')].map(element => {
      const box = element.getBoundingClientRect()
      let composed = 1
      for (let node: Element | null = element; node; node = node.parentElement) composed *= recede(node)
      return {
        id: element.getAttribute('data-entity-id')!,
        rect: [box.x, box.y, box.width, box.height].map(value => Math.round(value)).join(' '),
        filtered: element.hasAttribute('data-projections-filtered'),
        recede: recede(element),
        composed,
      }
    })
  })
}

for (const [story, noun] of [
  ['dependency-injection', 'registrations'],
  ['database', 'foreign keys'],
] as const) {
  test(`${story}: a summary figure recedes what it leaves out once and moves nothing, in Changes and in All`, async ({
    page,
    theme,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('chromium-light') && !testInfo.project.name.startsWith('chromium-dark'),
      'layout, not engine',
    )
    await page.setViewportSize({width: 1440, height: 900})
    await page.emulateMedia({reducedMotion: 'reduce'})
    await page.goto(
      new URL(
        `iframe.html?id=default-ui-renderers--${story}&viewMode=story&globals=theme:${theme}&args=initialMode:diff`,
        process.env.PROJECTIONS_STORYBOOK_URL,
      ).href,
    )
    await expect(page.locator('.ph[data-renderer-status="ready"]').first()).toBeVisible({timeout: 30_000})
    const frame = (await (await page.locator('.ph iframe').first().elementHandle())!.contentFrame())!
    const figure = page
      .getByRole('group', {name: 'Summary'})
      .locator('.ph-summary-figures > [data-summary-figure]')
      .filter({hasText: noun})
      .locator('button[data-summary-total]')
    for (const scope of ['changes', 'all']) {
      await page.locator(`.ph-scope [data-scope="${scope}"]`).first().click()
      await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
      await page.waitForTimeout(500)
      const before = await entities(frame)
      expect(
        before.filter(entity => entity.filtered).map(entity => entity.id),
        scope,
      ).toEqual([])
      await figure.click()
      await expect(figure).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => (await entities(frame)).some(entity => entity.filtered)).toBe(true)
      const after = await entities(frame)
      // The scope's layout stays: every element keeps its place, and none comes or goes.
      expect(
        after.map(({id, rect}) => `${id} ${rect}`),
        scope,
      ).toEqual(before.map(({id, rect}) => `${id} ${rect}`))
      // What the figure names stays as it was; everything else recedes to a quarter, once, however it nests.
      expect(
        after.some(entity => entity.composed === 1),
        scope,
      ).toBe(true)
      for (const entity of after) {
        expect(entity.recede, `${scope}: ${entity.id}`).toBe(entity.filtered ? 0.25 : 1)
        expect([1, 0.25], `${scope}: ${entity.id} with its ancestors`).toContain(entity.composed)
      }
      await figure.click()
      await expect(figure).toHaveAttribute('aria-pressed', 'false')
    }
  })
}

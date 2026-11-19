import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {ready, story} from './harness.js'

/**
 * The summary bar (packages/host/vscode-ui/README.md, `SummaryBar`) along the bottom of the VS Code UI's view, on the dependency
 * graph: totals per kind in the renderer's words for one revision, totals with their changes for a comparison, a
 * figure that filters the renderer to its items, the figures that don't fit in a "…" popover at a narrow width, and a
 * tab's running job as a spinner in a slot kept at its end.
 */
const view = (page: Page) => page.locator('.phv-root').first()
const bar = (page: Page) => page.getByRole('group', {name: 'Summary'})
const figures = (page: Page) => bar(page).locator('.phv-summary-figures > [data-summary-figure]')
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()

async function open(page: Page, id: string, theme: 'dark-modern' | 'light-modern' | 'dark-high-contrast' = 'dark-modern', args = '') {
  await page.goto(story(`projection-view--${id}`, theme, args))
  await ready(page)
}

test.use({viewport: {width: 1280, height: 800}})

test('one revision: the bar sits along the bottom and counts each kind in the renderer words, with no changes', async ({page}) => {
  await open(page, 'summary-bar-extraction')
  await expect(bar(page)).toHaveAttribute('data-sentence', /^3 workspaces · \d+ packages · \d+ dependencies/)
  await expect(bar(page).locator('[data-summary-delta]')).toHaveCount(0)
  // The last thing in the view: below the stage, at the bottom (within the view's gap).
  const [root, strip] = await Promise.all([view(page).boundingBox(), bar(page).boundingBox()])
  expect(root!.y + root!.height - (strip!.y + strip!.height)).toBeLessThanOrEqual(9)
  expect(root!.y + root!.height - (strip!.y + strip!.height)).toBeGreaterThanOrEqual(0)
  expect(strip!.height).toBe(22)
})

for (const theme of ['dark-modern', 'light-modern', 'dark-high-contrast'] as const)
  test(`${theme}: a comparison shows totals with their changes in the Git decoration colors, then the upgrades as facts`, async ({
    page,
  }) => {
    await open(page, 'summary-bar', theme)
    await expect(bar(page)).toHaveAttribute(
      'data-sentence',
      /workspaces.* · \d+ packages \+\d+ \u2212\d+ ~\d+ · \d+ dependencies \+\d+ \u2212\d+/,
    )
    const colors = await bar(page).evaluate(element => {
      const probe = (name: string) => {
        const span = document.createElement('span')
        span.style.color = `var(${name})`
        element.append(span)
        const color = getComputedStyle(span).color
        span.remove()
        return color
      }
      const of = (delta: string) => getComputedStyle(element.querySelector(`.phv-summary-figures [data-summary-delta="${delta}"]`)!).color
      return {
        added: [of('added'), probe('--phv-added')],
        removed: [of('removed'), probe('--phv-removed')],
        total: [getComputedStyle(element.querySelector('.phv-summary-figures [data-summary-total]')!).color, probe('--phv-muted')],
      }
    })
    expect(colors.added[0]).toBe(colors.added[1])
    expect(colors.removed[0]).toBe(colors.removed[1])
    expect(colors.total[0]).toBe(colors.total[1])
    // The renderer draws no summary row: its upgrades by bump are the bar's facts, after the counts, each filtering to its packages.
    await expect(frame(page).locator('.graph-summary, .pk-diff-summary')).toHaveCount(0)
    await expect(bar(page)).toHaveAttribute(
      'data-sentence',
      / · 18 major upgrades · 6 minor upgrades · 4 patch upgrades · 5 direct dependencies changed$/,
    )
    // A badge icon (`upgraded`, a change kind) keeps its disc in the bar, the glyph cut out of it, as in the renderer.
    const badge = await bar(page)
      .locator('[data-summary-fact] [data-icon="upgraded"]')
      .first()
      .evaluate(element => {
        const style = getComputedStyle(element)
        return {layers: style.maskImage.split('url(').length - 1, composite: [...new Set(style.maskComposite.split(/,\s*/))]}
      })
    expect(badge).toEqual({layers: 2, composite: ['exclude']})
  })

for (const theme of ['dark-modern', 'dark-high-contrast'] as const)
  test(`${theme}: figures are apart by a small round dot on the x-height centre, clear of each pill, with even room for the text`, async ({
    page,
  }) => {
    await open(page, 'summary-bar', theme)
    const dots = await bar(page).evaluate(element =>
      [...element.querySelectorAll<HTMLElement>('.phv-summary-figures .phv-summary-separator')].map(dot => {
        const box = dot.getBoundingClientRect()
        const before = dot.closest('li')!.previousElementSibling!.lastElementChild!
        const after = dot.nextElementSibling!
        // Each neighbour's text, trimmed to its cap height and baseline (`.phv-cap`), and the font's x-height there.
        const textOf = (side: Element) => side.querySelector('.phv-cap') ?? side
        const ex = document.createElement('span')
        ex.style.cssText = 'display:inline-block;height:1ex'
        textOf(after).append(ex)
        const xHeight = ex.getBoundingClientRect().height
        ex.remove()
        // What each neighbour draws: its icon and words, not its padding (nor its words for assistive technology).
        const ink = (side: Element) => {
          const rects = [...side.children]
            .filter(child => getComputedStyle(child).position !== 'absolute')
            .map(child => {
              const range = document.createRange()
              range.selectNodeContents(child)
              const text = range.getBoundingClientRect()
              return text.width ? text : child.getBoundingClientRect()
            })
          return {left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right))}
        }
        return {
          hidden: dot.getAttribute('aria-hidden'),
          size: [box.width, box.height],
          radius: getComputedStyle(dot).borderRadius,
          clear: [box.left - before.getBoundingClientRect().right, after.getBoundingClientRect().left - box.right],
          room: [box.left - ink(before).right, ink(after).left - box.right],
          centre: box.top + box.height / 2,
          xCentre: textOf(after).getBoundingClientRect().bottom - xHeight / 2,
        }
      }),
    )
    expect(dots.length).toBeGreaterThan(1)
    for (const dot of dots) {
      expect(dot.hidden).toBe('true')
      expect(dot.size).toEqual([3, 3])
      expect(dot.radius).toBe('50%')
      // Clear of a pressed or focused pill on either side, and the words on either side about as far away.
      for (const clear of dot.clear) expect(clear).toBeGreaterThanOrEqual(6)
      expect(Math.abs(dot.room[0]! - dot.room[1]!)).toBeLessThanOrEqual(2)
      expect(Math.abs(dot.centre - dot.xCentre)).toBeLessThanOrEqual(0.75)
    }
  })

test('a figure filters the renderer to its items, and pressed again shows every item', async ({page}) => {
  await open(page, 'summary-bar')
  // Every item, so the figures filter from all of them (the Changes scope would narrow them first).
  await page.getByRole('radiogroup', {name: 'Scope'}).locator('[data-scope="all"]').click()
  const workspaces = figures(page).filter({hasText: 'workspace'}).locator('[data-summary-total]')
  await workspaces.click()
  await expect(workspaces).toHaveAttribute('aria-pressed', 'true')
  await expect(frame(page).locator('[data-entity-id^="package:"]:not([data-projections-filtered])')).toHaveCount(0)
  await expect(frame(page).locator('[data-entity-id^="workspace:"]:not([data-projections-filtered])').first()).toBeAttached()
  // A change figure: only the added packages.
  const added = figures(page).filter({hasText: 'packages'}).locator('[data-summary-delta="added"]')
  await added.click()
  await expect(added).toHaveAttribute('aria-pressed', 'true')
  await expect(workspaces).toHaveAttribute('aria-pressed', 'false')
  await expect(frame(page).locator('[data-entity-id^="workspace:"]:not([data-projections-filtered])')).toHaveCount(0)
  await added.click()
  await expect(added).toHaveAttribute('aria-pressed', 'false')
  await expect(frame(page).locator('[data-projections-filtered]')).toHaveCount(0)
})

test('at a narrow width the figures that do not fit move into a popover', async ({page}) => {
  await page.setViewportSize({width: 340, height: 700})
  await open(page, 'summary-bar')
  const more = bar(page).getByRole('button', {name: /^\d+ more$/})
  await expect(more).toBeVisible()
  const total = await bar(page).locator('[data-summary-measure] [data-summary-figure]').count()
  const shown = await figures(page).count()
  expect(shown).toBeLessThan(total)
  // Nothing in the bar overflows it.
  const overflow = await bar(page).evaluate(element => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await more.click()
  const popover = page.getByRole('dialog', {name: 'More of the summary'})
  await expect(popover.locator('[data-summary-figure]')).toHaveCount(total - shown)
  await popover.locator('[data-summary-total]').first().click()
  await expect(popover.locator('[data-summary-total]').first()).toHaveAttribute('aria-pressed', 'true')
})

/** The figures' and the running slot's boxes, to compare with and without a job. */
const boxes = (page: Page) =>
  bar(page).evaluate(element =>
    [
      ...element.querySelectorAll<HTMLElement>('.phv-summary-figures [data-summary-figure], .phv-summary-fixed, [data-summary-running]'),
    ].map(item => {
      const box = item.getBoundingClientRect()
      return [box.x, box.y, box.width, box.height]
    }),
  )

/**
 * A running job's spinner repaints every frame, and a traced run (CI records traces) captures those frames at length:
 * enough to take a WebKit test past its time. So the slot's layout is checked with the spinner held still (reduced
 * motion; its rotation is a transform, which moves no box), and the spinning on its own, briefly.
 */
test.describe('under reduced motion', () => {
  test.use({reducedMotion: 'reduce'})
  test("a tab's job shows at the bar's end, in a slot kept while none runs, so no figure moves", async ({page}) => {
    await open(page, 'summary-bar-running', 'dark-modern', 'running:idle')
    const slot = bar(page).locator('[data-summary-running]')
    await expect(slot).toHaveAttribute('data-summary-running', '')
    await expect(slot).toHaveAttribute('aria-live', 'polite')
    await expect(slot.locator('.codicon')).toHaveCount(0)
    const idle = await boxes(page)
    await open(page, 'summary-bar-running')
    await expect(slot.locator('.codicon-sync')).toBeVisible()
    await expect(slot).toHaveAttribute('data-summary-running', 'extracting')
    await expect(slot).toHaveAttribute('title', 'Extracting…')
    await expect(slot).toHaveText('Extracting…')
    expect(await boxes(page)).toEqual(idle)
    // At the very end of the bar.
    const [strip, end] = await Promise.all([bar(page).boundingBox(), slot.boundingBox()])
    expect(strip!.x + strip!.width - (end!.x + end!.width)).toBeLessThanOrEqual(3)
    // Comparing says so.
    await open(page, 'summary-bar-running', 'dark-modern', 'running:comparing')
    await expect(slot).toHaveAttribute('title', 'Comparing…')
    await expect(slot).toHaveText('Comparing…')
  })
  test('the spinner holds still', async ({page}) => {
    await open(page, 'summary-bar-running')
    const icon = bar(page).locator('[data-summary-running] .codicon-sync')
    await expect(icon).toBeVisible()
    expect(await icon.evaluate(element => [getComputedStyle(element).animationName, element.getAnimations().length])).toEqual(['none', 0])
  })
})

test("a tab's job spins", async ({page}) => {
  await open(page, 'summary-bar-running')
  const icon = bar(page).locator('[data-summary-running] .codicon-sync')
  await expect(icon).toBeVisible()
  expect(await icon.evaluate(element => getComputedStyle(element).animationName)).toBe('codicon-spin')
  // Leaves the spinning page, so a traced run doesn't keep capturing it.
  await page.goto('about:blank')
})

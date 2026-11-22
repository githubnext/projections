import {test, expect, type Page} from '@playwright/test'
import {showEverything, story} from './harness.js'

/**
 * The summary bar (docs/guides/host-ui.md "The summary bar") along the bottom of the Default UI's view, on the dependency
 * graph: totals per kind in the renderer's words for one revision, totals with their changes for a comparison, a
 * figure that filters the renderer to its items, and the figures that don't fit in a "…" popover at a narrow width.
 */
const view = (page: Page) => page.locator('.ph').first()
const bar = (page: Page) => page.getByRole('group', {name: 'Summary'})
const figures = (page: Page) => bar(page).locator('.ph-summary-figures > [data-summary-figure]')
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()

async function open(page: Page, id: string) {
  await page.goto(story(`default-ui-projection-view--${id}`))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready', {timeout: 30_000})
}

test.use({viewport: {width: 1280, height: 800}})

test('one revision: the bar floats at the stage foot and counts each kind in the renderer words, with no changes', async ({page}) => {
  await open(page, 'summary-bar-extraction')
  await expect(bar(page)).toHaveAttribute('data-sentence', /^3 workspaces · \d+ packages · \d+ dependencies/)
  await expect(bar(page).locator('[data-summary-delta]')).toHaveCount(0)
  // The last row of the stage's foot, which floats 12px above the view's bottom inside its 1px edge.
  const foot = page.locator('.ph-stage-foot')
  await expect(foot.locator('> [data-summary-bar]')).toHaveCount(1)
  const [root, box, strip] = await Promise.all([view(page).boundingBox(), foot.boundingBox(), bar(page).boundingBox()])
  expect(root!.y + root!.height - (box!.y + box!.height)).toBeCloseTo(12, 0)
  expect(box!.y + box!.height - (strip!.y + strip!.height)).toBeCloseTo(1, 0)
  // 28px, under the legend's rule when the renderer has a legend.
  expect(strip!.height).toBeGreaterThanOrEqual(28)
  expect(strip!.height).toBeLessThanOrEqual(29)
})

test('a comparison: totals with their changes in the change colors, then the upgrades as facts, and no row over the graph', async ({
  page,
}) => {
  await open(page, 'summary-bar')
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
    const of = (delta: string) => getComputedStyle(element.querySelector(`.ph-summary-figures [data-summary-delta="${delta}"]`)!).color
    return {
      added: [of('added'), probe('--pj-added')],
      removed: [of('removed'), probe('--pj-removed')],
      total: [getComputedStyle(element.querySelector('.ph-summary-figures [data-summary-total]')!).color, probe('--pj-muted-foreground')],
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

test('figures are apart by a small round dot on the x-height centre, clear of each pill, with even room for the text', async ({page}) => {
  await open(page, 'summary-bar')
  const dots = await bar(page).evaluate(element =>
    [...element.querySelectorAll<HTMLElement>('.ph-summary-figures .ph-summary-separator')].map(dot => {
      const box = dot.getBoundingClientRect()
      const before = dot.closest('li')!.previousElementSibling!.lastElementChild!
      const after = dot.nextElementSibling!
      // Each neighbour's text, trimmed to its cap height and baseline (`.ph-cap`), and the font's x-height there.
      const textOf = (side: Element) => side.querySelector('.ph-cap') ?? side
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
  await showEverything(page)
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

test('a fact filters the renderer to the items it names; its icon and words are muted', async ({page}) => {
  await page.setViewportSize({width: 1600, height: 800})
  await open(page, 'summary-bar')
  await showEverything(page)
  const major = bar(page).locator('.ph-summary-figures [data-summary-fact]').filter({hasText: 'major upgrades'}).locator('button')
  await expect(major).toHaveText('18 major upgrades')
  await expect(major.locator('[data-icon="upgraded"]')).toBeAttached()
  const muted = await major.evaluate(element => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--pj-muted-foreground)'
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(element).color, color]
  })
  expect(muted[0]).toBe(muted[1])
  await major.click()
  await expect(major).toHaveAttribute('aria-pressed', 'true')
  // Only the packages a major version moved stay: no workspace, and none of the rest.
  await expect(frame(page).locator('[data-entity-id^="workspace:"]:not([data-projections-filtered])')).toHaveCount(0)
  await expect(frame(page).locator('[data-entity-id^="package:"]:not([data-projections-filtered])').first()).toBeAttached()
  await major.click()
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
  // Each figure is a row as wide as the popover's list, so its highlight takes its counts too, and the counts of each
  // kind of change line up down the rows.
  const rows = await popover.locator('ul').evaluate(list => ({
    list: list.getBoundingClientRect().width,
    rows: [...list.querySelectorAll(':scope > [data-summary-figure]')].map(row => row.getBoundingClientRect().width),
    added: [...list.querySelectorAll('[data-summary-delta="added"]')].map(delta => Math.round(delta.getBoundingClientRect().left)),
  }))
  for (const row of rows.rows) expect(row).toBeCloseTo(rows.list, 0)
  expect(new Set(rows.added).size).toBeLessThanOrEqual(1)
  await popover.locator('[data-summary-total]').first().click()
  await expect(popover.locator('[data-summary-total]').first()).toHaveAttribute('aria-pressed', 'true')
})

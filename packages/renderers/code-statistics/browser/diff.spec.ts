import {mkdirSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Diff mode in each of the renderer's own forms (bars, the paired share
 * rings and the line-kind composition): the total and the languages in the
 * host's summary bar, every language of either revision marked in place, and
 * no sideways overflow, in light and dark. Set `PROJECTIONS_DIFF_SCREENSHOTS` to a directory to save a picture
 * of each.
 */
const shots = process.env.PROJECTIONS_DIFF_SCREENSHOTS
const forms = {
  bars: {},
  share: {chart: 'share'},
  composition: {byLanguage: false},
} as const

for (const scenario of ['gateway', 'languages']) {
  for (const [form, options] of Object.entries(forms)) {
    test(`${scenario} (${form}): diff mode shows both revisions at once`, async ({page}, info) => {
      const inspector = harnessInspector()
      if (shots) await page.setViewportSize(info.project.name.endsWith('mobile') ? {width: 390, height: 844} : {width: 1440, height: 900})
      for (const colorMode of ['light', 'dark'] as const) {
        const stage = await openStage(page, inspector, {
          scenario: `code-statistics/${scenario}`,
          comparisonMode: 'diff',
          colorMode,
          options,
        })
        await stage.measure('settle')
        const frame = stage.frame
        // The total and its change are the host's summary bar's, as are the languages' counts: the diff draws no summary.
        await expect(frame.locator('.pk-diff-summary, .statistics-header')).toHaveCount(0)
        await expect
          .poll(async () => ((await stage.state()).summary ?? []).some(item => item.type === 'fact' && item.id === 'total'))
          .toBe(true)
        const summary = (await stage.state()).summary ?? []
        const total = summary.find(item => item.type === 'fact' && item.id === 'total')
        expect(total && total.type === 'fact' && (total.added ?? 0) + (total.removed ?? 0)).toBeGreaterThan(0)
        if (form !== 'composition') {
          const languages = summary.find(item => item.type !== 'fact' && item.kind === 'language')
          expect(languages && languages.type !== 'fact' && [languages.added, languages.removed]).toEqual([
            scenario === 'gateway' ? 2 : 1,
            1,
          ])
          for (const change of ['added', 'removed', 'modified'])
            expect(await frame.locator(`[data-entity-id][data-change="${change}"]`).count(), change).toBeGreaterThan(0)
          // A removed language keeps its place, struck through, with its Before count.
          const removed = frame.locator('.stat-row[data-change="removed"], .stat-values-row[data-change="removed"]').first()
          await expect(removed.locator('.stat-was')).toBeVisible()
          await expect(removed.locator('.stat-now')).toHaveCount(0)
        } else {
          expect(await frame.locator('.stat-row[data-change="modified"]').count()).toBe(3)
        }
        const overflow = await frame.locator('html').evaluate(root => root.scrollWidth - root.clientWidth)
        expect(overflow, `${colorMode}: no sideways overflow`).toBeLessThanOrEqual(1)
        if (shots && info.project.name.startsWith('chromium')) {
          mkdirSync(shots, {recursive: true})
          await page.waitForTimeout(200)
          const width = page.viewportSize()?.width
          await frame.locator('body').screenshot({path: `${shots}/code-statistics-${scenario}-${form}-${colorMode}-${width}.png`})
        }
      }
    })
  }
}

test('diff mode share rings are keyboard selectable and name both revisions', async ({page}) => {
  const stage = await openStage(page, harnessInspector(), {
    scenario: 'code-statistics/languages',
    comparisonMode: 'diff',
    options: {chart: 'share'},
  })
  await stage.measure('settle')
  const ruby = stage.frame.locator('g.stat-arc[data-entity-id="language:Ruby"]')
  await expect(ruby).toHaveAttribute('aria-label', /^Ruby, was 120 lines of code, −120, was \d+ percent, Removed$/)
  await expect(ruby.locator('.stat-ring-slice.before')).toHaveCount(1)
  await expect(ruby.locator('.stat-ring-slice.after')).toHaveCount(0)
  const python = stage.frame.locator('g.stat-arc[data-entity-id="language:Python"]')
  await expect(python.locator('.stat-ring-slice.after')).toHaveCount(1)
  await expect(python.locator('.stat-ring-slice.before')).toHaveCount(0)
  await python.focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await stage.state()).selection).toBe('language:Python')
})

test('the share chart fills a frame the host sizes, and keeps its size in a content-sized one', async ({page}, info) => {
  test.skip(info.project.name.endsWith('mobile'), 'a desktop stage')
  await page.setViewportSize({width: 1440, height: 900})
  const measure = async (height?: number) => {
    const stage = await openStage(page, harnessInspector(), {
      scenario: 'code-statistics/languages',
      comparisonMode: 'diff',
      options: {chart: 'share'},
      ...(height ? {height} : {}),
    })
    await stage.measure('settle')
    const result = await stage.frame.locator('.statistics-view').evaluate(view => {
      const share = view.querySelector('.statistics-share')!
      const donut = share.querySelector('svg')!.getBoundingClientRect()
      const list = share.querySelector('.statistics-values')!.getBoundingClientRect()
      return {
        fills: view.hasAttribute('data-fills'),
        donut: Math.round(donut.width),
        beside: list.left >= donut.right,
        clipped: [share, ...share.querySelectorAll('.stat-values-row')].filter(row => row.scrollWidth > row.clientWidth + 1).length,
        scrolls: share.scrollHeight > share.clientHeight + 1,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    if (shots && info.project.name.startsWith('chromium')) {
      mkdirSync(shots, {recursive: true})
      await stage.frame.locator('body').screenshot({path: `${shots}/code-statistics-share-${height ? 'fill' : 'content'}.png`})
    }
    return result
  }
  const content = await measure()
  expect(content.fills).toBe(false)
  expect(content.donut).toBe(320)
  const fill = await measure(860)
  expect(fill).toMatchObject({fills: true, beside: true, clipped: 0, scrolls: false})
  expect(fill.overflow).toBeLessThanOrEqual(1)
  expect(fill.donut).toBeGreaterThan(content.donut)
})

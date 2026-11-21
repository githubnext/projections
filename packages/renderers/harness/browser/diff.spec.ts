import {mkdirSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/**
 * Diff mode: one static union of both revisions in each renderer's own form,
 * every change marked in place (`data-change`), with no summary line of its
 * own (the host's summary bar counts the changes and states the renderer's
 * domain facts), in light and dark at the project's width and at 390px without
 * sideways overflow. Set `PROJECTIONS_DIFF_SCREENSHOTS` to a directory to save
 * a screenshot of each at 1440 and 390 pixels.
 */
const renderers = ['graph', 'database', 'dependency-injection', 'code-statistics', 'runtime-policy', 'api', 'agentic-workflows']
const shots = process.env.PROJECTIONS_DIFF_SCREENSHOTS
/** A comparison per renderer name whose diff is worth a picture; the first of each package otherwise. */
const pictured = new Set([
  'graph/service-platform',
  'graph/ci-pipeline',
  'graph/platform-worker',
  'graph/terraform-database-replacement',
  'graph/bicep-private-endpoint',
  'graph/npm-express-5',
  'database/prisma-shop',
  'dependency-injection/orders',
  'code-statistics/gateway',
  'code-statistics/languages',
  'runtime-policy/token-guard',
  'runtime-policy/token-guard-default',
  'api/parser-options',
  'agentic-workflows/docs-bot',
])

for (const directory of renderers) {
  test(`${directory}: diff mode marks every change in its own form`, async ({page}, info) => {
    test.slow()
    const inspector = harnessInspector()
    const mobile = info.project.name.endsWith('mobile')
    const keys = scenarios.filter(item => item.directory === directory).map(item => item.key)
    for (const key of keys) {
      for (const colorMode of ['light', 'dark'] as const) {
        const stage = await openStage(page, inspector, {scenario: key, comparisonMode: 'diff', colorMode})
        const state = await stage.state()
        if (state.comparisonMode !== 'diff') continue
        expect(state.capabilities?.comparisonModes, key).toContain('diff')
        await stage.measure('settle')
        const marks = await stage.frame.locator('[data-entity-id][data-change], [data-change] [data-entity-id]').count()
        // Every renderer leaves its summary to the host's summary bar: kind counts with their changes, and its domain facts.
        const summary = await stage.frame.locator('.pk-diff-summary, .graph-summary, .api-compatibility-counts').count()
        expect(summary, `${key}: no summary row; the host's summary bar counts the changes`).toBe(0)
        await expect.poll(async () => ((await stage.state()).summary ?? []).length, `${key}: a summary for the host`).toBeGreaterThan(0)
        expect(marks, `${key}: changes are marked in place`).toBeGreaterThan(0)
        const overflow = await stage.frame.locator('html').evaluate(root => root.scrollWidth - root.clientWidth)
        expect(overflow, `${key} (${colorMode}): no sideways overflow`).toBeLessThanOrEqual(1)
        if (shots && pictured.has(key) && info.project.name.startsWith('chromium')) {
          mkdirSync(shots, {recursive: true})
          const width = mobile ? 390 : 1440
          await page.setViewportSize({width, height: mobile ? 844 : 900})
          await stage.measure('settle')
          await page.waitForTimeout(300)
          await stage.frame.locator('body').screenshot({path: `${shots}/${key.replace('/', '-')}-${colorMode}-${width}.png`})
        }
      }
    }
  })
}

/**
 * Graph-based diffs show their data whole and open fitted: no text is cut
 * off with an ellipsis or runs past its card, and the opening view holds
 * every card, so nothing needs scrolling to be seen, unless fitting would draw
 * text below the 8 px opening floor (`openingFloorPx`): then it opens at that
 * floor, never smaller, on the top row's first card, and pans sideways only
 * (the frame takes the content's height). At 1440, 1000 and 390 pixels wide.
 */
const graphDiffs = scenarios.filter(item => item.directory === 'graph' || item.directory === 'dependency-injection')
for (const width of [1440, 1000, 390]) {
  test(`graph diffs at ${width}px: data whole, opening fitted or at the text floor`, async ({page}, info) => {
    test.skip(
      !info.project.name.startsWith('chromium-desktop') && !info.project.name.startsWith('webkit-mobile'),
      'one engine per form factor',
    )
    test.slow()
    const inspector = harnessInspector()
    for (const {key} of graphDiffs) {
      const stage = await openStage(page, inspector, {scenario: key, comparisonMode: 'diff', width})
      if ((await stage.state()).comparisonMode !== 'diff') continue
      await stage.measure('settle')
      const report = await stage.frame.locator('body').evaluate(() => {
        const problems: string[] = []
        const svgs = [...document.querySelectorAll<SVGSVGElement>('svg')]
        for (const text of document.querySelectorAll<SVGTextElement | HTMLElement>('text, [data-entity-id] *')) {
          if (text.children.length && !(text instanceof SVGTextElement)) continue
          if (text.textContent?.includes('…')) problems.push(`"${text.textContent.trim()}" is cut off with an ellipsis`)
          if (
            text instanceof HTMLElement &&
            getComputedStyle(text).textOverflow === 'ellipsis' &&
            text.scrollWidth > text.clientWidth + 1
          ) {
            problems.push(`"${text.textContent?.trim()}" is clipped`)
          }
        }
        // Card text stays inside its card.
        for (const card of document.querySelectorAll<SVGGElement>('g.graph-node:not(.graph-group)')) {
          const surface = card.querySelector<SVGRectElement>(':scope > rect.node-surface')
          if (!surface) continue
          const box = surface.getBBox()
          for (const text of card.querySelectorAll<SVGTextElement>(':scope > text, :scope > g.node-text > text')) {
            const own = text.getBBox()
            if (own.x < box.x - 1 || own.x + own.width > box.x + box.width + 1 || own.y + own.height > box.y + box.height + 1) {
              problems.push(`"${text.textContent}" runs past its card ${card.dataset.entityId}`)
            }
          }
        }
        // Every card is inside the opening view (the scroll container's visible area), unless it opens at the text floor.
        const scroller = document.querySelector<HTMLElement>('[data-projections-scroll]')
        const outside: string[] = []
        const zoom = Number(scroller?.dataset.zoom ?? 1)
        if (scroller && svgs.length && zoom === 1) {
          const view = scroller.getBoundingClientRect()
          const area = {
            left: view.left + scroller.clientLeft,
            top: view.top + scroller.clientTop,
            right: view.left + scroller.clientLeft + scroller.clientWidth,
            bottom: view.top + scroller.clientTop + scroller.clientHeight,
          }
          for (const card of document.querySelectorAll<SVGElement>('[data-entity-id] > rect, [data-graph-synthetic] > rect')) {
            const box = card.getBoundingClientRect()
            if (
              box.width > 0 &&
              (box.left < area.left - 1 || box.top < area.top - 1 || box.right > area.right + 1 || box.bottom > area.bottom + 1)
            ) {
              outside.push(
                card.parentElement?.getAttribute('data-entity-id') ?? card.parentElement?.getAttribute('data-graph-synthetic') ?? '?',
              )
            }
          }
        }
        // At the floor: the frame takes the content's height, so the opening view pans only sideways, from the top left.
        const floored =
          scroller && zoom > 1
            ? {
                downward: scroller.scrollHeight - scroller.clientHeight,
                top: scroller.scrollTop,
                sideways: scroller.scrollWidth > scroller.clientWidth + 1,
              }
            : undefined
        return {problems: problems.slice(0, 10), outside: outside.slice(0, 5), floored}
      })
      expect(report.problems, `${key} at ${width}px`).toEqual([])
      expect(report.outside, `${key} at ${width}px: every card in the opening view`).toEqual([])
      if (report.floored) {
        expect(report.floored.sideways, `${key} at ${width}px: opened at the text floor, so it is wider than the frame`).toBe(true)
        expect(report.floored.downward, `${key} at ${width}px: the frame takes the content's height at the floor`).toBeLessThanOrEqual(1)
        expect(report.floored.top, `${key} at ${width}px: opens at the top`).toBe(0)
      }
    }
  })
}

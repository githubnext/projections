import {expect, test} from '@playwright/test'
import type {Frame, Page} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import type {StageSubject} from '@githubnext/projections-renderer-testing'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

declare global {
  interface Window {
    /** Every view a graph frame committed: its zoom over the fit, its drawing's width and its stage's. */
    graphViews?: {zoom: number; drawn: number; stage: number; label: string | null}[]
  }
}

/** Records, in every renderer frame, each view its graph commits, however briefly it's shown. */
async function recordGraphViews(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window === window.top) return
    window.graphViews = []
    const record = () => {
      const scroller = document.querySelector<HTMLElement>('.graph-scroll')
      const drawing = scroller?.querySelector<SVGSVGElement>('svg.graph')
      if (!scroller || !drawing || !Number(drawing.dataset['scale'])) return
      window.graphViews!.push({
        zoom: Number(scroller.dataset['zoom']),
        drawn: parseFloat(drawing.style.width),
        stage: scroller.clientWidth,
        label: drawing.getAttribute('aria-label'),
      })
    }
    new MutationObserver(record).observe(document, {subtree: true, attributes: true, attributeFilter: ['data-zoom', 'style', 'aria-label']})
  })
}

/** What a host's Changes scope shows: the changes and the items their relationships join (see `changeContext`). */
function changesScope(subject: StageSubject): string[] {
  if (subject.mode !== 'comparison') throw new Error('a comparison has a Changes scope')
  const relationships = new Map([...subject.before.relationships, ...subject.after.relationships].map(row => [row.id, row]))
  const shown = new Set<string>()
  for (const change of subject.comparison.changes) {
    if (change.status === 'unchanged') continue
    for (const id of [...change.before, ...change.after]) {
      shown.add(id)
      const relationship = change.collection === 'relationships' ? relationships.get(id) : undefined
      if (relationship) shown.add(relationship.from).add(relationship.to)
    }
  }
  return [...shown]
}

async function rendererFrame(page: Page): Promise<Frame> {
  const frame = await (await page.locator('#stage-frame iframe').elementHandle())!.contentFrame()
  if (!frame) throw new Error('no renderer frame')
  return frame
}

/**
 * A host draws every item before it chooses its scope, then sends the Changes scope (and with it a focus on the
 * changes), which the graph lays out again in the background. Until that layout arrives the graph draws the old one,
 * and keeps the view it opened: framing the new scope's changes within the old drawing zoomed it past its stage for
 * as long as the new layout took. The stage is narrow enough that the old layout opens fitted below full size (and
 * above the text floor), so the changes alone would fill it larger.
 */
test('a graph keeps its opening view while the Changes scope is laid out', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
  await recordGraphViews(page)
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/platform-worker', comparisonMode: 'diff', width: 520})
  const frame = await rendererFrame(page)
  const drawing = frame.locator('svg.graph')
  await expect(drawing).toBeVisible()
  const everything = (await drawing.getAttribute('aria-label'))!
  const opened = (await frame.evaluate(() => window.graphViews!.splice(0))).at(-1)!
  expect(opened.drawn, 'the whole graph opens fitted').toBeLessThanOrEqual(opened.stage + 1)
  await stage.filter({query: '', changesOnly: true, ids: null, scope: changesScope(stage.subject)})
  await expect(drawing).not.toHaveAttribute('aria-label', everything)
  await stage.seek(1)
  const views = await frame.evaluate(() => window.graphViews!.splice(0))
  for (const view of views) {
    if (view.label === everything) expect(view.zoom, 'the old layout keeps its opening zoom').toBe(opened.zoom)
    expect(view.drawn, `${view.label} at zoom ${view.zoom}`).toBeLessThanOrEqual(view.stage + 1)
  }
})

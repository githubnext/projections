import {expect, test, type Frame, type Page} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import type {StageSubject} from '@githubnext/projections-renderer-testing'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

declare global {
  interface Window {
    /** Every view a graph frame committed: its zoom over the fit, its drawing's width and its stage's. */
    graphViews?: {zoom: number; drawn: number; stage: number; left: number; top: number; label: string | null}[]
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
      if (!scroller || !drawing || !Number(drawing.dataset.scale)) return
      window.graphViews!.push({
        zoom: Number(scroller.dataset.zoom),
        drawn: parseFloat(drawing.style.width),
        stage: scroller.clientWidth,
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
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
  const frame = await (await page.locator('#stage-frame iframe').elementHandle()).contentFrame()
  if (!frame) throw new Error('no renderer frame')
  return frame
}

/** An item the comparison adds: in the whole graph and in its Changes scope alike. */
function addedItem(subject: StageSubject): string {
  if (subject.mode !== 'comparison') throw new Error('a comparison adds items')
  const added = subject.comparison.changes.find(change => change.status === 'added' && change.collection === 'entities')
  if (!added) throw new Error('the comparison adds no item')
  return added.after[0]!
}

/**
 * A host draws every item before it chooses its scope, then sends the Changes scope (and with it a focus on the
 * changes), which the graph lays out again in the background. Until that layout arrives the graph draws the old one,
 * and keeps the view it opened: framing the new scope's changes within the old drawing zoomed it past its stage for
 * as long as the new layout took, and dropping a focus it opened on (one item, from the host) jumped back to the
 * whole graph's fit until the focus was framed again. The stage is narrow enough that the old layout opens fitted
 * below full size (and above the text floor), so the changes alone, or one item, would fill it larger.
 */
for (const focused of [false, true]) {
  test(`a graph keeps its opening view${focused ? ' on a focused item' : ''} while the Changes scope is laid out`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
    await recordGraphViews(page)
    const inspector = harnessInspector()
    const scenario = 'graph/platform-worker'
    const load = {scenario, comparisonMode: 'diff', width: 520} as const
    const plain = await openStage(page, inspector, load)
    const stage = focused ? await openStage(page, inspector, {...load, focus: {id: addedItem(plain.subject)}}) : plain
    const frame = await rendererFrame(page)
    const drawing = frame.locator('svg.graph')
    await expect(drawing).toBeVisible()
    const everything = (await drawing.getAttribute('aria-label'))!
    const opened = (await frame.evaluate(() => window.graphViews!.splice(0))).at(-1)!
    if (focused) expect(opened.zoom, 'the focus opens zoomed in on its item').toBeGreaterThan(1)
    else expect(opened.drawn, 'the whole graph opens fitted').toBeLessThanOrEqual(opened.stage + 1)
    await stage.filter({query: '', changesOnly: true, ids: null, scope: changesScope(stage.subject)})
    await expect(drawing).not.toHaveAttribute('aria-label', everything)
    await stage.seek(1)
    const views = await frame.evaluate(() => window.graphViews!.splice(0))
    for (const view of views) {
      if (view.label === everything) {
        expect({zoom: view.zoom, left: view.left, top: view.top}, 'the old layout keeps its opening view').toEqual({
          zoom: opened.zoom,
          left: opened.left,
          top: opened.top,
        })
      }
      if (!focused) expect(view.drawn, `${view.label} at zoom ${view.zoom}`).toBeLessThanOrEqual(view.stage + 1)
    }
  })
}

/**
 * A host that has its scope before the frame is ready sends it right after the documents, so it arrives while the
 * graph lays out every item. That layout is already out of date when it's done: the graph waits for the scope's own
 * rather than first drawing every item, which opened framed on the changes within them, past the stage, and then
 * jumped. Every view it commits is the scope's layout, fitted.
 */
test('a graph whose scope arrives with its documents opens on the scope, never on every item first', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
  await recordGraphViews(page)
  const inspector = harnessInspector()
  const load = {scenario: 'graph/platform-worker', comparisonMode: 'diff', width: 520} as const
  const {subject} = await openStage(page, inspector, load)
  const everything = await (await rendererFrame(page)).locator('svg.graph').getAttribute('aria-label')
  await openStage(page, inspector, {...load, filter: {query: '', changesOnly: true, ids: null, scope: changesScope(subject)}})
  const frame = await rendererFrame(page)
  await expect(frame.locator('svg.graph')).toBeVisible()
  const views = await frame.evaluate(() => window.graphViews!.splice(0))
  expect(views.length, 'the graph was drawn').toBeGreaterThan(0)
  const labels = [...new Set(views.map(view => view.label))]
  expect(labels, 'one layout, the scope’s').toHaveLength(1)
  expect(labels[0], 'the scope, not every item').not.toBe(everything)
  for (const view of views) expect(view.drawn, `${view.label} at zoom ${view.zoom}`).toBeLessThanOrEqual(view.stage + 1)
})

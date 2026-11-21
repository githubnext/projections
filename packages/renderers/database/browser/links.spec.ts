import {expect, test} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {openRenderer, samples} from '@githubnext/projections-renderer-harness/playwright'

/** How far along a link from either end it may touch a card: the stub leaving its row, the lead-in to its arrowhead. */
const endReach = 8
/** How far inside a card's border a link may run before it is behind the card: antialiasing and a border's width. */
const borderSlack = 2

/** The links drawn behind cards at this frame: each link's path, sampled along its length, against every card shown. */
function linksBehindCards(content: Element, [reach, slack]: readonly [number, number]): string[] {
  const shown = (element: Element) => {
    for (let node: Element | null = element; node && node !== content; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) return false
      const attribute = node.getAttribute('opacity')
      if (attribute !== null && Number(attribute) < 0.05) return false
    }
    return true
  }
  const cards = [...content.querySelectorAll<HTMLElement>('.database-table')]
    .filter(shown)
    .map(card => ({id: card.dataset.entityId ?? card.className, box: card.getBoundingClientRect()}))
  const problems: string[] = []
  for (const group of content.querySelectorAll<SVGGElement>('[data-link-key]')) {
    const path = group.querySelector<SVGPathElement>('path.database-link')
    const matrix = path?.getScreenCTM()
    if (!path || !matrix || !shown(group)) continue
    const length = path.getTotalLength()
    for (let along = reach; along <= length - reach; along += 3) {
      const point = new DOMPoint(path.getPointAtLength(along).x, path.getPointAtLength(along).y).matrixTransform(matrix)
      const card = cards.find(
        ({box}) => point.x > box.left + slack && point.x < box.right - slack && point.y > box.top + slack && point.y < box.bottom - slack,
      )
      if (!card) continue
      problems.push(`${group.dataset.linkKey} runs behind ${card.id} at (${Math.round(point.x)}, ${Math.round(point.y)})`)
      break
    }
  }
  return problems
}

test('a link never runs behind a card: in every scenario, layout (ranks, stacked, phone) and frame of the animation and the diff', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  const load = async (value: unknown) => (typeof value === 'string' ? read(value) : value)
  const {scenarios} = (await read('scenarios.json')) as {scenarios: {id: string; before?: unknown; after?: unknown; extraction?: unknown}[]}
  let checked = 0
  for (const scenario of scenarios) {
    const subject =
      scenario.extraction !== undefined
        ? {extraction: await load(scenario.extraction)}
        : {before: await load(scenario.before), after: await load(scenario.after)}
    // Side by side in ranks, the narrowest ranks, stacked in one column with lanes at the left, and a phone.
    for (const width of [1440, 1000, 640, 390]) {
      await page.setViewportSize({width: width + 80, height: 1000})
      for (const comparisonMode of scenario.extraction !== undefined ? [undefined] : [undefined, 'diff' as const]) {
        const renderer = await openRenderer(page, {
          renderer: 'database',
          ...subject,
          progress: comparisonMode ? 1 : 0,
          width,
          ...(comparisonMode ? {comparisonMode} : {}),
        } as Parameters<typeof openRenderer>[1])
        const progresses = comparisonMode !== undefined || scenario.extraction !== undefined ? [1] : samples(24)
        for (const progress of progresses) {
          if (comparisonMode) await renderer.measure('settle')
          else await renderer.seek(progress)
          const behind = await renderer.frame.locator('.database-content').evaluate(linksBehindCards, [endReach, borderSlack] as const)
          checked++
          expect(behind, `${scenario.id} at ${width}px, ${comparisonMode ?? 'animated'}, progress ${progress}`).toEqual([])
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(100)
})

import {expect, test} from '@playwright/test'
import {harnessInspector, openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {pipeline} from '../../kit/browser/fixtures.js'
import {scrubSuite, selectionSuite} from '../../kit/browser/suite.js'
import {paneStatusSuite, statusSuite} from '../../kit/browser/status.js'

// Close-ups for review (SOURCE_DOT_SHOTS=<directory>) are taken at three times the size.
if (process.env.SOURCE_DOT_SHOTS) test.use({deviceScaleFactor: 3})

scrubSuite([pipeline()])
selectionSuite(pipeline(), 'package')
statusSuite(pipeline())
paneStatusSuite(pipeline())

test('job names are monospace identifiers and kinds stay sans; no caption above the canvas', async ({page}) => {
  const {before, after} = pipeline()
  const renderer = await openRenderer(page, {renderer: 'dag', before, after, progress: 1})
  const measured = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(measured.count).toBe(after.entities.length)
  expect(measured.proportional).toEqual([])
  await expect(renderer.frame.locator('.node-label:not([data-projections-identifier])')).toHaveCount(0)
  await expect(renderer.frame.locator('.node-kind[data-projections-identifier]')).toHaveCount(0)
  await expect(renderer.frame.locator('.domain-caption')).toHaveCount(0)
})

test("a relationship's junction dot takes its line's color while the relationship is hovered or selected", async ({page}, info) => {
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/release-workflow'})
  await stage.measure('settle')
  const junction = stage.frame.locator('.graph-junction').first()
  await expect(junction).toBeAttached()
  // A relationship through the junction: its route passes the junction's point.
  const id = await stage.frame.locator('svg.graph').evaluate(svg => {
    const dot = svg.querySelector<SVGCircleElement>('.graph-junction')!
    const [x, y] = [dot.cx.baseVal.value, dot.cy.baseVal.value]
    for (const path of svg.querySelectorAll<SVGPathElement>('.graph-link .graph-edge')) {
      const length = path.getTotalLength()
      for (let at = 0; at <= length; at += 0.5) {
        const point = path.getPointAtLength(at)
        if (Math.hypot(point.x - x, point.y - y) < 1) return path.closest('.graph-link')!.getAttribute('data-entity-id')!
      }
    }
    return ''
  })
  expect(id, 'a relationship passes the junction').not.toBe('')
  const colors = () =>
    stage.frame.locator('svg.graph').evaluate((svg, linkId) => {
      const line = svg.querySelector(`.graph-link[data-entity-id="${CSS.escape(linkId)}"] .graph-edge`)!
      const ring = svg.querySelector(`.graph-link-head[data-head-of="${CSS.escape(linkId)}"] .graph-junction-ring`)
      return {line: getComputedStyle(line).stroke, dot: ring ? getComputedStyle(ring).fill : 'none'}
    }, id)
  const resting = await colors()
  expect(resting.dot, 'at rest the copy is clear, so the junction shows its own color').toBe('rgba(0, 0, 0, 0)')
  for (const state of ['hover', 'selection'] as const) {
    await (state === 'hover' ? stage.hover(id) : stage.select(id))
    await expect.poll(async () => (await colors()).line, `${state}: the line takes the ring's color`).not.toBe(resting.line)
    // Close-ups for review: SOURCE_DOT_SHOTS=<directory>.
    if (process.env.SOURCE_DOT_SHOTS && state === 'hover') {
      const box = (await junction.boundingBox())!
      await page.screenshot({
        path: `${process.env.SOURCE_DOT_SHOTS}/graph-junction-${info.project.name}.png`,
        clip: {x: box.x - 80, y: box.y - 50, width: 160, height: 100},
      })
    }
    const {line, dot} = await colors()
    expect(dot, `${state}: the junction dot takes the line's color`).toBe(line)
    await (state === 'hover' ? stage.hover(null) : stage.select(null))
  }
})

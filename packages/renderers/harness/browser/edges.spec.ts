import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/**
 * Every graph renderer draws its relationships in the kit's one edge style:
 *
 * - every drawn edge has exactly one origin dot where its line starts (`EdgeOrigins`: edges leaving one point share a
 *   dot), and a copy of it that rings with the edge;
 * - a hovered edge is drawn again over the others (`raisedEdges`), and its line, origin dot and arrowhead all take the
 *   hover ring's color, synthetic edges (which the SDK doesn't ring) included; a focused synthetic edge keeps it while
 *   the pointer passes over it and leaves;
 * - the edges' hit targets keep their order, so Tab moves through them one after another.
 */
const graphs = scenarios.filter(({key}) => /^(?:graph|dependency-injection)\//u.test(key))
/** Edges hovered per scenario: the first ones, as a renderer draws every one alike. */
const hovered = 3

interface DrawnEdge {
  key: string
  id: string | null
  start: [number, number]
}

for (const {key} of graphs) {
  test(`${key}: every edge has one origin dot, and a hovered edge takes the ring's color whole`, async ({page}, info) => {
    test.skip(
      info.project.name !== 'chromium-desktop' && info.project.name !== 'webkit-desktop',
      'The edge style is the same at every width.',
    )
    const stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1, comparisonMode: 'diff'})
    await stage.measure('settle')
    const edges: DrawnEdge[] = await stage.frame.locator('body').evaluate(body =>
      [...body.querySelectorAll<SVGGElement>('.graph-link')].flatMap(link => {
        const d = link.querySelector('.graph-edge')?.getAttribute('d') ?? ''
        const start = /^M\s*(-?[\d.]+)[ ,](-?[\d.]+)/u.exec(d)
        const edgeKey = link.getAttribute('data-edge-key')
        return start && edgeKey
          ? [{key: edgeKey, id: link.getAttribute('data-entity-id'), start: [Number(start[1]), Number(start[2])] as [number, number]}]
          : []
      }),
    )
    test.skip(!edges.length, 'No edges drawn.')
    const dots = await stage.frame.locator('body').evaluate(body => ({
      shown: [...body.querySelectorAll('.graph-edge-origin')].map(dot => ({
        x: Number(dot.getAttribute('cx')),
        y: Number(dot.getAttribute('cy')),
      })),
      copies: [...body.querySelectorAll('.graph-edge-origin-ring')].map(dot => dot.getAttribute('data-origin-of')),
    }))
    const failures: string[] = []
    for (const edge of edges) {
      const at = dots.shown.filter(({x, y}) => Math.hypot(x - edge.start[0], y - edge.start[1]) < 0.5).length
      if (at !== 1) failures.push(`${edge.key}: ${at} origin dots at its start (${edge.start.join(', ')}), not one`)
      const copies = dots.copies.filter(of => of === edge.key).length
      if (copies !== 1) failures.push(`${edge.key}: ${copies} copies of its origin dot to ring with it, not one`)
    }
    expect(failures).toEqual([])

    // The hover ring's color, resolved: what the SDK paints a ringed edge's line and filled shapes in.
    const accent = await stage.frame.locator('body').evaluate(body => {
      const probe = body.ownerDocument.createElement('span')
      probe.style.color = 'var(--pr-hover)'
      body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    const paints = (edge: DrawnEdge) =>
      stage.frame.locator('body').evaluate((body, {key: edgeKey, id}) => {
        const link = body.querySelector<SVGGElement>(`.graph-link[data-edge-key="${CSS.escape(edgeKey)}"]`)
        if (!link) return null
        // Drawn again over the others while ringed: that copy is what shows.
        const raised = body.querySelector(`.graph-link-raised[data-edge-key="${CSS.escape(edgeKey)}"]`)
        const line = (raised ?? link).querySelector('.graph-edge')
        // Drawn over the cards (GraphCanvas), or the line's own marker (dependency injection).
        const head =
          body.querySelector(`.graph-link-head[data-edge-key="${CSS.escape(edgeKey)}"] .graph-arrowhead`) ??
          (id === null ? null : link.querySelector('marker path'))
        const dot = body.querySelector(`.graph-edge-origin-ring[data-origin-of="${CSS.escape(edgeKey)}"]`)
        const layer = [...(raised?.parentElement?.children ?? [])]
        return {
          line: line ? getComputedStyle(line).stroke : null,
          head: head ? getComputedStyle(head).fill : null,
          dot: dot ? getComputedStyle(dot).fill : null,
          last: raised !== null && layer.at(-1) === raised,
        }
      }, edge)
    for (const edge of edges.filter(entity => entity.id !== null).slice(0, hovered)) {
      await stage.hover(edge.id)
      await expect.poll(async () => (await paints(edge))?.line, `${edge.key}: the hovered line takes the ring's color`).toBe(accent)
      const painted = await paints(edge)
      expect(painted, `${edge.key}: its arrowhead, origin dot and order`).toEqual({line: accent, head: accent, dot: accent, last: true})
      await stage.hover(null)
    }
    const synthetic = edges.find(edge => edge.id === null)
    if (synthetic) {
      const hit = stage.frame.locator(`.graph-link[data-edge-key="${synthetic.key}"] > .edge-hit`)
      await hit.focus()
      await expect
        .poll(async () => (await paints(synthetic))?.line, `${synthetic.key}: a focused synthetic line takes the color`)
        .toBe(accent)
      const whole = {line: accent, head: accent, dot: accent, last: true}
      expect(await paints(synthetic), `${synthetic.key}: its arrowhead, origin dot and order`).toEqual(whole)
      // The pointer passing over it and leaving doesn't take the focus's highlight away.
      const middle = await hit.evaluate(path => {
        if (!(path instanceof SVGPathElement)) return {x: 0, y: 0}
        const at = path.getPointAtLength(path.getTotalLength() / 2)
        const point = new DOMPoint(at.x, at.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix())
        return {x: point.x, y: point.y}
      })
      const frame = await stage.iframe.boundingBox()
      if (frame) {
        await page.mouse.move(frame.x + middle.x, frame.y + middle.y)
        await page.mouse.move(frame.x + 1, frame.y + 1)
      }
      expect(await paints(synthetic), `${synthetic.key}: still highlighted while focused, after the pointer leaves`).toEqual(whole)
      await hit.blur()
    }

    // Tab moves through the edges' hit targets in their order, whichever is ringed: from a synthetic edge where there
    // is one, which its own focus highlights.
    const hits = stage.frame.locator('.graph-link > .edge-hit')
    const order = await hits.evaluateAll(all => all.map(hit => hit.parentElement?.getAttribute('data-edge-key') ?? ''))
    const from = Math.max(0, order.indexOf(synthetic?.key ?? ''))
    if (order.length - from >= 3) {
      await hits.nth(from).focus()
      for (const expected of order.slice(from + 1, from + 3)) {
        await page.keyboard.press('Tab')
        const focused = await stage.frame
          .locator('body')
          .evaluate(body => body.ownerDocument.activeElement?.parentElement?.getAttribute('data-edge-key'))
        expect(focused, 'Tab moves to the next edge').toBe(expected)
      }
    }
  })
}

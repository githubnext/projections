import {expect, test} from '@playwright/test'
import type {RingPixelReport} from '@githubnext/projections-renderer-testing/playwright'
import {openStage, ringGeometry, ringPixelReport} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/**
 * Every built-in renderer's rings, in pixels: for the first entities of each
 * renderer's first scenarios, the selection and keyboard focus rings the SDK
 * paints start exactly at the item's own painted edge, cover it (no second
 * edge inside or around them) and show on every side and corner. Measured
 * against the picture of the same item in the same state with the SDK's ring
 * stylesheet turned off (see `ringPixelReport`), so nothing else moves.
 */
/** Attaches a failing report's neutral and ringed pictures, to see what each line crossed. */
async function attachPictures(report: RingPixelReport, label: string) {
  if (!report.pictures) return
  for (const [name, url] of Object.entries(report.pictures)) {
    await test.info().attach(`${label} ${name}.png`, {body: Buffer.from(url.split(',')[1]!, 'base64'), contentType: 'image/png'})
  }
}

const perScenario = 6
const scenariosPerRenderer = 2

for (const directory of new Set(scenarios.map(item => item.directory))) {
  test(`${directory}: rings replace each item's own edge, in pixels`, async ({page}) => {
    test.slow()
    const inspector = harnessInspector()
    const failures: string[] = []
    for (const {key} of scenarios.filter(item => item.directory === directory && !item.customComparator).slice(0, scenariosPerRenderer)) {
      const stage = await openStage(page, inspector, {scenario: key, progress: 1})
      const frame = await (await stage.iframe.elementHandle())!.contentFrame()
      if (!frame) throw new Error('no renderer frame')
      for (const id of (await stage.measure<string[]>('entities')).slice(0, perScenario)) {
        const element = stage.frame.locator(`[data-entity-id="${id.replaceAll('"', '\\"')}"]`).first()
        await element.scrollIntoViewIfNeeded().catch(() => {})
        for (const state of ['selected', 'focus'] as const) {
          const show = async () => {
            if (state === 'selected') await stage.select(id)
            else {
              await element.evaluate(item => {
                const focusable = '[tabindex]:not([tabindex="-1"]), button:not([disabled]), a[href], input, select, textarea, summary'
                const target = (item.matches(focusable) ? item : item.querySelector(focusable)) as HTMLElement | null
                target?.focus({preventScroll: true, focusVisible: true} as FocusOptions)
              })
            }
            await stage.measure('settle')
          }
          const hide = async () => {
            await stage.select(null)
            await element.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
            await stage.measure('settle')
          }
          // The neutral picture: the same state, with the SDK's ring stylesheet off (and focus left, so the kit's own
          // focus outline doesn't stand in for the ring).
          const rings = (on: boolean) =>
            element.evaluate(
              (item, [on, focus]) => {
                for (const sheet of document.querySelectorAll<HTMLStyleElement>('style[data-projections-rings]')) sheet.disabled = !on
                const focusable = '[tabindex]:not([tabindex="-1"]), button:not([disabled]), a[href], input, select, textarea, summary'
                const target = (item.matches(focusable) ? item : item.querySelector(focusable)) as HTMLElement | null
                if (focus && on) target?.focus({preventScroll: true, focusVisible: true} as FocusOptions)
                if (focus && !on) target?.blur()
                return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
              },
              [on, state === 'focus'] as const,
            )
          await show()
          const offset = (await stage.iframe.boundingBox())!
          for (const geometry of await ringGeometry(frame, id, {focused: state === 'focus'})) {
            const report = await ringPixelReport(page, frame, geometry, {
              label: `${key} ${id} (${state})`,
              ring: () => rings(true),
              clear: () => rings(false),
              offset: {x: offset.x, y: offset.y},
            })
            await attachPictures(report, `${key} ${id} (${state})`)
            failures.push(...report.failures)
          }
          await rings(true)
          await hide()
        }
      }
    }
    expect(failures).toEqual([])
  })
}

/**
 * Rings through zoom and scroll: on large, scrolled diagrams (the DI spring-orders composition, the Terraform graph in
 * diff mode), a selected unit far from the origin is its own ring in pixels after scrolling it into view, after
 * zooming in and after zooming out, in the same frame as the move.
 */
for (const {scenario, diff} of [
  {scenario: 'dependency-injection/spring-orders', diff: false},
  {scenario: 'graph/terraform-database-replacement', diff: true},
]) {
  test(`${scenario}${diff ? ' (diff)' : ''}: rings stay on their items through scroll and zoom`, async ({page}) => {
    test.slow()
    const stage = await openStage(page, harnessInspector(), {scenario, progress: 1, ...(diff ? {comparisonMode: 'diff' as const} : {})})
    const frame = (await (await stage.iframe.elementHandle())!.contentFrame())!
    const ids = await stage.measure<string[]>('entities')
    // Cards (not lines) far along the diagram, so the stage has to scroll to them.
    const cards = await stage.frame.locator('body').evaluate(
      (_, ids) =>
        ids.filter(id => {
          const element = [...document.querySelectorAll('[data-entity-id]')].find(
            candidate => candidate.getAttribute('data-entity-id') === id,
          )
          return !!element && !element.querySelector('[data-projections-edge="line"]') && !!element.querySelector('[data-projections-edge]')
        }),
      ids,
    )
    const far = cards.slice(-3)
    const failures: string[] = []
    const measuredAt: string[] = []
    const rings = (on: boolean) =>
      frame.evaluate(on => {
        for (const sheet of document.querySelectorAll<HTMLStyleElement>('style[data-projections-rings]')) sheet.disabled = !on
        return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      }, on)
    const measure = async (id: string, where: string) => {
      const element = stage.frame.locator(`[data-entity-id="${id.replaceAll('"', '\\"')}"]`).first()
      // The stage's own scroll first, then the page's, so the item is on screen.
      await element.evaluate(item => item.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}))
      await element.scrollIntoViewIfNeeded()
      await stage.measure('settle')
      const offset = (await stage.iframe.boundingBox())!
      const geometries = await ringGeometry(frame, id)
      for (const geometry of geometries) {
        if (geometry.mode === 'halo') continue
        const report = await ringPixelReport(page, frame, geometry, {
          label: `${scenario} ${id} ${where}`,
          ring: () => rings(true),
          clear: () => rings(false),
          offset: {x: offset.x, y: offset.y},
        })
        if (report.lines.length) measuredAt.push(where)
        await attachPictures(report, `${scenario} ${id} ${where}`)
        failures.push(...report.failures)
      }
      await rings(true)
    }
    for (const id of far) {
      await stage.select(id)
      await measure(id, 'scrolled into view')
      for (const action of ['zoom-in', 'zoom-out', 'zoom-out']) {
        if (!(await stage.state()).controls.some(control => control.id === action)) continue
        await stage.action(action)
        await stage.measure('settle')
        await measure(id, `after ${action}`)
      }
      await stage.action('zoom-fit').catch(() => {})
    }
    await stage.select(null)
    expect(failures).toEqual([])
    // Measured in view, and after zooming.
    expect(measuredAt).toContain('scrolled into view')
    expect(measuredAt.some(where => where.startsWith('after zoom'))).toBe(true)
  })
}

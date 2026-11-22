import {test as base, expect, type Locator} from '@playwright/test'
import {copyFile, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {startHarness, type Harness} from './harness.js'

const noop = () => undefined

// The Inspector's loading states are the host's `LoadingStatus`: centered in the box they stand in for, filling it.

const graph = resolve('../../renderers/graph/fixtures')

const test = base.extend<{url: string}>({
  url: async ({browserName, context}, use) => {
    const directory = await mkdtemp(join(tmpdir(), `projections-loading-${browserName}-`))
    let server: Harness | undefined
    try {
      await copyFile(join(graph, 'service-platform-before.json'), join(directory, 'before.json'))
      await copyFile(join(graph, 'service-platform-after.json'), join(directory, 'after.json'))
      const scenarios = join(directory, 'loading.scenarios.json')
      await writeFile(
        scenarios,
        JSON.stringify({
          format: 'projections.scenarios',
          version: 0,
          title: 'Loading',
          scenarios: [{id: 'platform', title: 'Service platform', renderer: 'graph', before: 'before.json', after: 'after.json'}],
        }),
      )
      server = await startHarness(context, ['--fixtures', scenarios])
      const [origin, fragment] = server.url.split('#')
      await use(`${origin}?scenario=${encodeURIComponent('loading/platform')}#${fragment}`)
    } finally {
      await server?.close()
      await rm(directory, {recursive: true, force: true})
    }
  },
})

/** How far the status's spinner and label sit from the pane's center, and how much shorter the status is than the pane. */
const offsets = (pane: Locator) =>
  pane.evaluate(element => {
    const area = element.getBoundingClientRect()
    const status = element.querySelector('.ph-loading')!.getBoundingClientRect()
    const content = element.querySelector('.ph-loading-content')!.getBoundingClientRect()
    return {
      x: Math.abs(content.left + content.width / 2 - (area.left + area.width / 2)),
      y: Math.abs(content.top + content.height / 2 - (area.top + area.height / 2)),
      fill: Math.abs(status.height - area.height),
      height: area.height,
    }
  })

for (const {name, viewport} of [
  {name: 'at this viewport', viewport: undefined},
  {name: 'at 390px wide', viewport: {width: 390, height: 844}},
]) {
  test(`the renderer loading status is centered in each pane ${name}`, async ({page, url}) => {
    if (viewport) await page.setViewportSize(viewport)
    // The renderer's page never arrives, so its frames stay loading (until the host's ready deadline).
    await page.route('**/renderers/graph/index.html', noop)
    await page.goto(url)
    const panes = page.locator('.ph-frame-host[data-renderer-status="loading"]')
    await expect(panes.first()).toBeVisible()
    for (const pane of await panes.all()) {
      const status = pane.locator('.ph-loading')
      await expect(status).toHaveAttribute('role', 'status')
      await expect(status).toContainText('Loading the Graph renderer…')
      // Measured in one frame, once side-by-side panes have settled into rows or columns for this width.
      await expect
        .poll(async () => {
          const measured = await offsets(pane)
          return {...measured, centered: measured.x <= 4 && measured.y <= 4, filled: measured.fill <= 1 && measured.height > 100}
        })
        .toMatchObject({centered: true, filled: true})
    }
  })
}

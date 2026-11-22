import {test as base, expect, type Page} from '@playwright/test'
import {copyFile, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {startHarness, type Harness} from './harness.js'
import {showAs} from './toolbar.js'

interface Fixtures {
  url: string
  directory: string
  scenarios: string
  bundle: string
}

const graph = resolve('../../renderers/graph/fixtures')
const comparator = resolve('../../../examples/comparators/priority-order/priority-order.comparator.yaml')
const minimal = resolve('../../../examples/renderers/minimal/dist')

/** A scenarios file over the graph fixtures: the default comparator, a custom comparator and a deliberately broken renderer. */
function document(title = 'Service platform') {
  const pair = {before: 'before.json', after: 'after.json'}
  return JSON.stringify(
    {
      format: 'projections.scenarios',
      version: 0,
      title: 'Fixture tests',
      scenarios: [
        {id: 'platform', title, renderer: 'graph', ...pair},
        {
          id: 'priority',
          title: 'Payments first',
          description: 'The priority-order comparator moves the payments step to the front.',
          renderer: 'graph',
          ...pair,
          comparator: {file: 'priority-order.comparator.yaml', options: {priority: ['payments']}},
        },
        {id: 'broken', title: 'Broken renderer', renderer: {bundle: 'broken'}, ...pair},
      ],
    },
    null,
    2,
  )
}

const test = base.extend<{fixtures: Fixtures}>({
  fixtures: async ({browserName, context}, use) => {
    const directory = await mkdtemp(join(tmpdir(), `projections-fixtures-${browserName}-`))
    let server: Harness | undefined
    try {
      await copyFile(join(graph, 'service-platform-before.json'), join(directory, 'before.json'))
      await copyFile(join(graph, 'service-platform-after.json'), join(directory, 'after.json'))
      await copyFile(comparator, join(directory, 'priority-order.comparator.yaml'))
      // The template renderer, broken on purpose: it overflows a phone and draws two legends.
      const bundle = join(directory, 'broken')
      await mkdir(bundle)
      await copyFile(join(minimal, 'renderer.json'), join(bundle, 'renderer.json'))
      const html = await readFile(join(minimal, 'index.html'), 'utf8')
      await writeFile(
        join(bundle, 'index.html'),
        html.replace(
          '</body>',
          '<style>body{min-width:900px}</style><div data-projections-legend>Legend</div><div data-projections-legend>Legend</div></body>',
        ),
      )
      const scenarios = join(directory, 'cases.scenarios.json')
      await writeFile(scenarios, document())
      // The scenarios name the bundle themselves, which is repository code: --trust serves it.
      server = await startHarness(context, ['--fixtures', scenarios, '--trust'])
      await use({url: server.url, directory, scenarios, bundle})
    } finally {
      await server?.close()
      await rm(directory, {recursive: true, force: true})
    }
  },
})

/** At phone widths the sidebar floats over the view and starts closed. */
async function sidebar(page: Page, open = true) {
  if ((page.viewportSize()?.width ?? 1440) >= 768) return
  const toggle = page.getByRole('button', {name: /^(Show|Hide) .* sidebar$/u})
  if (((await toggle.getAttribute('aria-pressed')) === 'true') !== open) await toggle.click()
}

function at(fixtures: Fixtures, scenario: string): string {
  const [origin, fragment] = fixtures.url.split('#')
  return `${origin}?scenario=${encodeURIComponent(scenario)}#${fragment}`
}

async function checks(page: Page) {
  await page
    .getByRole('button', {name: /Run checks/u})
    .first()
    .click()
  const list = page.getByRole('list', {name: 'Built-in checks'})
  // On a phone the panel opens after the click: an absent list has no pending checks either.
  await expect(list).toBeVisible()
  // However long the checks take, within the test's budget.
  await expect(list.locator('[data-status="pending"]')).toHaveCount(0, {timeout: 0})
  return list
}

test('fixtures mode loads scenarios into the workbench and presents them in the real host view', async ({page, fixtures}) => {
  // The built-in checks run one after another in their own frame, each host selection waiting out the item's pulse:
  // about 45 s in WebKit on a workstation, and several times that on a CI runner: with the palette, type-scale and
  // spacing checks (16 more loads), over six minutes for the graph renderer in Linux WebKit at phone size.
  test.setTimeout(process.env.CI ? 600_000 : 90_000)
  await page.goto(at(fixtures, 'cases/platform'))
  await expect(page.locator('[data-fixtures-workbench]')).toHaveAttribute('data-mode', 'fixtures')
  await sidebar(page)
  const list = page.getByRole('navigation', {name: 'Scenarios'})
  await expect(list.getByRole('region', {name: 'Fixture tests'}).getByRole('button')).toHaveCount(3)
  await expect(page.locator('.ph[data-mode="comparison"][data-renderer-status="ready"]')).toBeVisible()
  await expect(page.locator('.pi-statusbar')).toContainText('cases/platform')
  await expect(page.locator('.pi-statusbar [data-comparator="default"]')).toBeVisible()
  // The checks pass for a built-in renderer.
  await sidebar(page, false)
  const results = await checks(page)
  await expect(results.locator('[data-status="fail"]')).toHaveCount(0)
  await expect(results.locator('[data-check="neutral-endpoints"]')).toHaveAttribute('data-status', 'pass')
})

test('a custom comparator is previewed against the fixture pair, with its steps in the text view', async ({page, fixtures}) => {
  await page.goto(at(fixtures, 'cases/priority'))
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await expect(page.locator('.pi-statusbar [data-comparator="priority-order.comparator.yaml"]')).toContainText(
    'Comparator priority-order.comparator.yaml',
  )
  await showAs(page, 'Text')
  const text = await page.locator('.ph-text-view').innerText()
  expect(text.indexOf('payments')).toBeGreaterThanOrEqual(0)
  expect(text.indexOf('payments')).toBeLessThan(text.indexOf('legacy-billing'))
  // The default order differs: legacy billing retires first.
  await page.goto(at(fixtures, 'cases/platform'))
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await showAs(page, 'Text')
  const defaultText = await page.locator('.ph-text-view').innerText()
  expect(defaultText.indexOf('legacy-billing')).toBeLessThan(defaultText.indexOf('payments'))
})

test('the checks panel catches a deliberately broken renderer', async ({page, fixtures}) => {
  // The built-in checks run one after another in their own frame: three times the default budget for slow CI browsers.
  test.slow()
  await page.goto(at(fixtures, 'cases/broken'))
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  await expect(page.locator('.pi-statusbar')).toContainText('fixture bundle')
  const list = await checks(page)
  await expect(list.locator('[data-check="phone-overflow"]')).toHaveAttribute('data-status', 'fail')
  await expect(list.locator('[data-check="phone-overflow"]')).toContainText('390px')
  await expect(list.locator('[data-check="legend"]')).toHaveAttribute('data-status', 'fail')
  await expect(list.locator('[data-check="selection"]')).toHaveAttribute('data-status', 'pass')
  const failed = await list.locator('[data-status="fail"]').count()
  await expect(page.getByRole('tablist', {name: 'Panel views'}).getByRole('tab', {name: /^Checks/u})).toHaveText(`Checks${failed}`)
  await sidebar(page)
  await expect(page.locator(`[data-scenario="cases/broken"] [aria-label="Failed"]`)).toBeVisible()
})

test('fixtures and renderer bundles reload live when their files change', async ({page, fixtures}) => {
  // Three reloads, each waited on: three times the default budget for slow CI browsers.
  test.slow()
  // Each reload is waited on by what it changes on the page, not by counting generations: one file write can raise
  // several watcher events (and so several generations), which would let a later wait pass before its own reload.
  const reload = {timeout: 30_000}
  await page.goto(at(fixtures, 'cases/broken'))
  const workbench = page.locator('[data-fixtures-workbench]')
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  const generation = Number(await workbench.getAttribute('data-generation'))
  const before = await page.locator('iframe.ph-frame').first().getAttribute('src')
  await writeFile(fixtures.scenarios, document('Service platform, renamed'))
  await expect.poll(async () => Number(await workbench.getAttribute('data-generation')), reload).toBeGreaterThan(generation)
  // Look in the sidebar (which floats, closed, on a phone).
  await sidebar(page)
  await expect(page.locator('[data-scenario="cases/platform"]')).toContainText('Service platform, renamed', reload)
  await sidebar(page, false)
  // A rebuilt bundle gets a new URL, so the frame reloads it.
  const html = await readFile(join(fixtures.bundle, 'index.html'), 'utf8')
  await writeFile(join(fixtures.bundle, 'index.html'), html.replace('</body>', '<!-- rebuilt --></body>'))
  await expect.poll(() => page.locator('iframe.ph-frame').first().getAttribute('src'), reload).not.toBe(before)
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible(reload)
  // A broken file is reported, not fatal. Write it once the bundle's reload has settled (the generation holds for a
  // second), so the runner isn't still loading when it changes.
  let settled = Number(await workbench.getAttribute('data-generation'))
  await expect
    .poll(
      async () => {
        const now = Number(await workbench.getAttribute('data-generation'))
        const held = now === settled
        settled = now
        return held
      },
      {...reload, intervals: [1000]},
    )
    .toBe(true)
  await writeFile(join(fixtures.directory, 'after.json'), '{"protocolVersion": 0')
  await expect(page.locator('#pi-panel-content')).toContainText('SCENARIO_UNAVAILABLE', reload)
  await expect(page.getByRole('tablist', {name: 'Panel views'}).getByRole('tab', {name: /^Diagnostics/u})).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await sidebar(page)
  await expect(page.locator('[data-scenario="cases/platform"]')).toContainText('Unavailable', reload)
})

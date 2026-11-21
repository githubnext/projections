import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {
  chooseMode,
  chooseSetting,
  closeMenus,
  expectSetting,
  explorer,
  inToolbar,
  menuItem,
  openSettings,
  openSettingsSubmenu,
  pairSelect,
  served,
  showAs,
  showAsChip,
  showAsGroup,
  submenuItem,
  swapPair,
} from './harness.js'

const view = (page: Page) => page.locator('.ph')
const frame = (page: Page) => page.frameLocator('iframe.ph-frame')

async function open(page: Page, query: string) {
  await page.goto(explorer(query))
  await expect(page.locator('.ph-explorer')).toBeVisible()
}

test('renderer frames are sandboxed in an opaque origin with no network access', async ({page, request}) => {
  await open(page, 'renderer=hostile&probe=network')
  const iframe = page.locator('iframe.ph-frame')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  // The frame is named for assistive technology without a `title`, which would show a tooltip over the whole frame.
  await expect(iframe).toHaveAccessibleName('Hostile probe renderer')
  await expect(iframe).not.toHaveAttribute('title')
  const src = await iframe.getAttribute('src')
  const channel = new URLSearchParams(new URL(src!).hash.slice(1)).get('channel')
  expect(channel?.length).toBeGreaterThanOrEqual(32)
  await expect(page.getByRole('alert')).toContainText(
    'network fetch=blocked,xhr=blocked,websocket=blocked,image=blocked,parent-dom=blocked,storage=blocked,cookie=blocked,top-navigation=blocked',
  )
  // Whatever the browser APIs claimed (sendBeacon only reports queuing), no request reached the server.
  await page.waitForTimeout(500)
  expect(await (await request.get(served('__probe-log'))).json()).toEqual([])
  await expect(page.locator('[data-active-view]')).toHaveText('Hostile probe renderer · custom, sandboxed')
  for (const path of ['./renderers/graph/index.html', './test-renderers/hostile/index.html']) {
    const response = await request.get(served(path))
    const policy = response.headers()['content-security-policy'] ?? ''
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('sandbox allow-scripts')
  }
  // The built-in bundle also carries the policy for hosting without header control.
  expect(await (await request.get(served('renderers/graph/index.html'))).text()).toContain('connect-src &#39;none&#39;')
})

test('forged, foreign and malformed messages are ignored; only the channel selection counts', async ({page}) => {
  await open(page, 'renderer=hostile&probe=forge')
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  const src = await page.locator('iframe.ph-frame').getAttribute('src')
  const channel = new URLSearchParams(new URL(src!).hash.slice(1)).get('channel')
  // The host page itself (not the frame) cannot speak for the renderer even with the right channel.
  await page.evaluate(channel => window.postMessage({projections: 0, channel, type: 'select', id: 'checkout'}, '*'), channel)
  await page.waitForTimeout(200)
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
})

test('a renderer that floods the host or navigates its frame is stopped, and built-in views remain', async ({page}) => {
  await open(page, 'renderer=hostile&probe=flood')
  await expect(page.getByRole('alert')).toContainText('sent too many messages and was stopped')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(0)
  await page.getByRole('button', {name: 'Show table'}).click()
  await expect(page.locator('[data-active-view]')).toHaveText('Built-in table view')
  await expect(page.locator('table[data-collection="entities"] tbody tr').first()).toBeVisible()

  await open(page, 'renderer=hostile&probe=navigate')
  await expect(page.getByRole('alert')).toContainText('navigated its frame and was stopped')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(0)
})

test('open requests go to the host, which decides', async ({page}) => {
  await open(page, 'renderer=hostile&probe=open')
  await expect(page.getByLabel('Open request')).toHaveText('src/checkout.ts:12')
})

test('a renderer gets built-in renderer documents by name only, and can run one in a frame of its own', async ({page}) => {
  await open(page, 'renderer=hostile&probe=documents')
  const alert = page.getByRole('alert')
  // The probe reports what the host answered, then again once the built-in document runs nested, under the nesting
  // frame's policy, and speaks the protocol to it: each report carries both, so neither can replace the other.
  await expect(alert).toContainText(
    /documents graph=html; hostile=refused \(hostile is a custom renderer; hosts supply only built-in renderers\); no-such-renderer=refused \(no-such-renderer is not a built-in renderer\); nested graph ready/,
  )
  // The request naming a path was dropped as invalid, never answered.
  await expect(alert).not.toContainText('../renderers')
})

test('progress is acknowledged by the renderer after painting and flow-controlled', async ({page}) => {
  await open(page, '')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '1')
  const slider = page.getByRole('slider', {name: 'Transition'})
  for (const value of ['40', '0', '73', '100']) {
    await slider.fill(value)
    await expect(view(page)).toHaveAttribute('data-rendered-progress', String(Number(value) / 100))
    await expect(frame(page).locator('[data-renderer="graph"]')).toHaveAttribute('data-progress', String(Number(value) / 100))
  }

  // A slow renderer receives only the latest progress while it is busy.
  await open(page, 'renderer=hostile&probe=slow')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '1')
  // 31 slider positions, 10 ms apart, set in the page so the pace doesn't depend on the test driver.
  const elapsed = await page.getByRole('slider', {name: 'Transition'}).evaluate(async (input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const start = performance.now()
    for (let value = 0; value <= 60; value += 2) {
      setValue.call(input, String(value))
      input.dispatchEvent(new Event('input', {bubbles: true}))
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return performance.now() - start
  })
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0.6')
  const report = page.getByRole('alert').filter({hasText: 'progress messages'})
  await expect(report).toContainText('last progress:0.6')
  const received = Number(/received (\d+) progress messages/.exec((await report.textContent())!)![1])
  // Each frame takes the probe 300 ms, and the host keeps at most one progress in flight. It sends the initial
  // progress, the first new value, one more per frame painted while values arrive, and the latest when the
  // last frame finishes; superseded values are never sent.
  expect(received).toBeLessThanOrEqual(Math.floor(elapsed / 300) + 3)
  expect(received).toBeLessThan(31)
})

test('table and text views present the same changes and entities', async ({page}) => {
  await open(page, 'before=v1&after=v3&view=table')
  await expect(page.locator('[data-active-view]')).toHaveText('Built-in table view')
  // Both list the Changes scope's rows: the changes and the items that give them context.
  const tableIds = await page
    .locator('.ph-table-view tbody tr[data-row-id]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')).sort())
  await showAs(page, 'Text')
  await expect(page.locator('[data-active-view]')).toHaveText('Built-in text view')
  const textIds = await page
    .locator('.ph-text-view [data-item-id]')
    .evaluateAll(items => items.map(item => item.getAttribute('data-item-id')).sort())
  expect(textIds.length).toBeGreaterThan(0)
  expect(textIds).toEqual(tableIds)
  await expect(page.locator('.ph-text-view')).toContainText('Removed entity Legacy inventory [legacy].')

  await open(page, 'single&after=v2&view=table')
  await expect(page.getByRole('group', {name: 'Comparison playback'})).toHaveCount(0)
  const entities = await page
    .locator('table[data-collection="entities"] tbody tr[data-row-id]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')).sort())
  await showAs(page, 'Text')
  const outline = await page
    .locator('.ph-outline > li[data-item-id]')
    .evaluateAll(items => items.map(item => item.getAttribute('data-item-id')).sort())
  expect(outline).toEqual(entities)
  expect(entities).toEqual(['checkout', 'inventory', 'payments'])
})

test('selection is shared between the renderer, the built-in views and the host', async ({page}) => {
  await open(page, 'renderer=minimal&single&after=v2')
  await frame(page).locator('[data-entity-id="payments"] button').click()
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(page.getByRole('complementary')).toContainText('payments')
  await showAs(page, 'Table')
  await expect(page.locator('tr[data-row-id="payments"]')).toHaveAttribute('data-selected', 'true')
})

test('the pair picker compares any two extractions in the browser with the default comparator', async ({page}) => {
  await open(page, 'before=v1&after=v2&view=text')
  await expect(page.locator('.ph-comparator')).toHaveAttribute('data-comparator', 'default')
  await expect(page.locator('.ph-text-view')).toContainText('Added entity Inventory worker')
  await (await pairSelect(page, 'To')).selectOption('v3')
  await (await pairSelect(page, 'Compare from')).selectOption('v2')
  await expect(page.locator('.ph-text-view')).toContainText('Added entity Audit log [audit]')
  await expect(page.locator('.ph-text-view')).not.toContainText('Inventory worker')
  await swapPair(page)
  await expect(page.locator('.ph-text-view')).toContainText('Removed entity Audit log [audit]')
  await (await pairSelect(page, 'Compare from')).selectOption('')
  await expect(page.locator('.ph-explorer')).toHaveAttribute('data-outcome', 'single')
  await expect(page.getByRole('group', {name: 'Comparison playback'})).toHaveCount(0)
})

test('custom comparators run sandboxed in the browser and their result is validated', async ({page}) => {
  const steps = async () => page.locator('.ph-steps > li').evaluateAll(items => items.map(item => item.textContent))
  await open(page, 'before=v1&after=v3&view=text')
  await expect(page.locator('.ph-comparator')).toHaveAttribute('data-comparator', 'default')
  const defaultSteps = await steps()
  await open(page, 'before=v1&after=v3&view=text&comparator=priority')
  await expect(page.locator('.ph-comparator')).toHaveAttribute('data-comparator', 'comparators/priority-order.comparator.yaml')
  await expect(page.locator('.ph-comparator')).toContainText('validated against both extractions')
  const custom = await steps()
  expect(custom).toHaveLength(defaultSteps.length)
  expect(custom).not.toEqual(defaultSteps)
  expect(custom[0]).toMatch(/payments|Audit log/)
})

test('extractions from different definitions are not compared, and the reason is explained', async ({page}) => {
  await open(page, 'before=v2&after=v3-head')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText("These extractions can't be compared")
  await expect(alert).toContainText('The inputs differs.')
  await expect(page.locator('[data-error-code="definition-mismatch"]')).toBeVisible()
  await expect(page.locator('.ph')).toHaveCount(0)
  await alert.getByRole('button', {name: /on its own/}).click()
  await expect(page.locator('.ph-explorer')).toHaveAttribute('data-outcome', 'single')
})

test('the active renderer is labeled, and an unavailable renderer falls back explicitly', async ({page}) => {
  await open(page, '')
  await expect(page.locator('[data-active-view]')).toHaveText('Graph renderer · built-in, sandboxed')
  await expect((await showAsGroup(page)).getByRole('menuitemradio', {name: 'Graph'})).toBeChecked()
  await closeMenus(page)
  await open(page, 'renderer=none')
  await expect(page.getByRole('status').filter({hasText: 'is not available here'})).toContainText('"unavailable-renderer"')
  await expect(page.locator('[data-active-view]')).toHaveText('Built-in table view')
  // With no renderer to return to, the row's chip only says what is shown, and Show as offers the table and text.
  await expect(page.locator('.ph-show-as-chip')).toHaveText('Showing Table')
  await expect(showAsChip(page)).toHaveCount(0)
  await expect((await showAsGroup(page)).getByRole('menuitemradio')).toHaveText(['Table', 'Text'])
})

test('reduced motion shows endpoints immediately and reaches the renderer', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await open(page, 'before=v1&after=v2')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await expect(frame(page).locator('html')).toHaveAttribute('data-reduced-motion', 'true')
  // The one play button shows the other endpoint: from the after revision, the before one, and back.
  await expect(page.getByRole('button', {name: /^(Play|Pause)/})).toHaveCount(0)
  await page.getByRole('button', {name: 'Show v1 · base'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '0')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0')
  await page.getByRole('button', {name: 'Show v2 · first push'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '1')
  await expect(page.getByRole('button', {name: 'Show v1 · base'})).toBeVisible()
  // The dense row explains it on the slider (its description and tooltip) rather than in a line of its own.
  await expect(page.getByRole('slider', {name: 'Transition'})).toHaveAccessibleDescription(
    /^Reduced motion: playback shows an endpoint immediately\./,
  )
})

test('playback runs to the end with no change highlighting at either endpoint', async ({page}) => {
  // Playback advances per frame and holds at each step stop: on a loaded Linux WebKit runner a run took over 8 s.
  // Each run gets whatever the test's budget leaves.
  test.slow()
  await open(page, 'before=v1&after=v2&renderer=minimal&loop=false')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '1')
  // Before anything has moved, the one play button plays forward, from the start.
  await expect(page.getByRole('button', {name: 'Play forward'})).toBeVisible()
  await page.getByRole('slider', {name: 'Transition'}).press('Home')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0')
  await page.getByRole('button', {name: 'Play forward'}).click()
  await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeVisible()
  await expect(view(page)).toHaveAttribute('data-progress', '1', {timeout: 0})
  // With Loop off it stops at the end; pressing play again plays back to the before revision.
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '1')
  await page.getByRole('button', {name: 'Play backward'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '0', {timeout: 0})
  await expect(page.getByRole('button', {name: 'Play forward'})).toBeVisible()
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0')
})

test('animated playback loops: it reaches the after revision, holds, and returns to the before revision', async ({page}) => {
  test.slow()
  await open(page, `before=v1&after=v2&renderer=minimal&defaults=${encodeURIComponent(JSON.stringify({durationMs: 1000}))}`)
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await page.getByRole('slider', {name: 'Transition'}).focus()
  await page.keyboard.press('Home')
  await expect(view(page)).toHaveAttribute('data-progress', '0')
  await page.getByRole('button', {name: 'Play forward'}).click()
  // The presentation's progress, sampled every frame until playback is back at the before revision after reaching the
  // after revision.
  const trace = await view(page).evaluate(
    (element: HTMLElement) =>
      new Promise<{time: number; progress: number}[]>(resolve => {
        const samples: {time: number; progress: number}[] = []
        const start = performance.now()
        const tick = () => {
          const time = performance.now() - start
          samples.push({time, progress: Number(element.dataset.progress)})
          const reached = samples.findIndex(sample => sample.progress === 1)
          if ((reached >= 0 && samples.at(-1)!.progress === 0) || time > 30_000) resolve(samples)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
  const head = trace.findIndex(sample => sample.progress === 1)
  expect(head, 'reaches the after revision').toBeGreaterThan(0)
  // It holds at the endpoint before reversing: the after revision stays shown frame after frame, where playback that
  // turned without a hold would show it for a frame at most. (How long it holds is playback.test.mjs's: a loaded runner
  // shows the progress a render or more late, so time between samples measures the runner, not the hold.)
  const held = trace.filter(sample => sample.progress === 1)
  expect(held.length, 'the after revision holds over more than one frame').toBeGreaterThan(1)
  expect(
    trace.findIndex((sample, index) => index > head && sample.progress < 1),
    'leaves the after revision',
  ).toBeGreaterThan(head)
  expect(trace.at(-1)!.progress, 'returns to the before revision').toBe(0)
  // Still playing: it keeps going.
  await expect.poll(async () => Number(await view(page).getAttribute('data-progress'))).toBeGreaterThan(0)
  // Switching modes stops the loop.
  await chooseMode(page, 'Side by side')
  await chooseMode(page, 'Animated')
  const stopped = await view(page).getAttribute('data-progress')
  await page.waitForTimeout(400)
  await expect(view(page)).toHaveAttribute('data-progress', stopped!)
  // One play button, which continues the way playback last went.
  await expect(page.getByRole('button', {name: /^Play (forward|backward)$/})).toHaveCount(1)
  await expect(page.getByRole('button', {name: 'Pause', exact: true})).toHaveCount(0)
})

test('reduced motion never loops: play shows the endpoint and stops', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await open(page, 'before=v1&after=v2&renderer=minimal')
  await page.getByRole('slider', {name: 'Transition'}).focus()
  await page.keyboard.press('Home')
  // Under reduced motion the play button shows an endpoint instead.
  await page.getByRole('button', {name: 'Show v2 · first push'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '1')
  await page.waitForTimeout(800)
  await expect(view(page)).toHaveAttribute('data-progress', '1')
  await expect(page.getByRole('button', {name: 'Pause', exact: true})).toHaveCount(0)
  await expect(page.getByRole('button', {name: 'Show v1 · base'})).toBeVisible()
})

test('keyboard focus moves into the renderer frame and back out', async ({page, browserName}) => {
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  const backTab = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab'
  await open(page, 'renderer=minimal&single&after=v2')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  // Focus the last host control before the renderer frame.
  const focusLastBeforeFrame = () =>
    page.evaluate(() => {
      const frameElement = document.querySelector('iframe.ph-frame')!
      const focusable = [...document.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')].filter(
        element =>
          (element.compareDocumentPosition(frameElement) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && element.offsetParent !== null,
      )
      focusable.at(-1)!.focus()
      return focusable.at(-1)!.outerHTML.slice(0, 60)
    })
  const before = await focusLastBeforeFrame()
  await page.keyboard.press(tab)
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')
  await page.keyboard.press(tab)
  await expect.poll(() => frame(page).locator(':focus').count()).toBe(1)
  await page.keyboard.press(backTab)
  await page.keyboard.press(backTab)
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))).toBe(before)
  // The summary bar follows the stage: Shift+Tab from its first figure, the next stop after the frame, goes back in.
  const firstAfterFrame = await page.evaluate(() => {
    const frameElement = document.querySelector('iframe.ph-frame')!
    const focusable = [...document.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')].filter(
      element =>
        (frameElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        element.tabIndex >= 0 &&
        element.checkVisibility({visibilityProperty: true}),
    )
    focusable[0]!.focus()
    return Boolean(focusable[0]!.closest('[data-summary-bar]'))
  })
  expect(firstAfterFrame).toBe(true)
  await page.keyboard.press(backTab)
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')
})

/** The built-in bundle (name and title) for each standard schema that has one; the graph bundle also presents `dag` and `architecture`. */
const dedicatedRenderers: Record<string, [string, string]> = {
  'graph/v0': ['graph', 'Graph'],
  'dag/v0': ['graph', 'Graph'],
  'treemap/v0': ['file-packing', 'File packing'],
  'architecture/v0': ['graph', 'Graph'],
  'api/v0': ['api', 'API'],
  'database/v0': ['database', 'Database'],
}
/** Renderers that declare diff as their first comparison mode open in it, with no transition to scrub. */
/** Renderers without animated mode: they open in their default, side by side, with no transition to scrub. */
const withoutAnimation = new Set(['api/v0'])
async function scrubOrDiff(page: Page, schema: string) {
  if (withoutAnimation.has(schema)) {
    // Asked for animated, which it doesn't offer, it opens in side by side unless a mode was chosen; no transition.
    await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', /side-by-side|diff/)
    await expect(page.getByRole('slider', {name: 'Transition'})).toHaveCount(0)
    return
  }
  await page.getByRole('slider', {name: 'Transition'}).fill('50')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0.5')
}
for (const [schema, [, title]] of Object.entries(dedicatedRenderers)) {
  test(`a dedicated bundle presents ${schema}`, async ({page}) => {
    await open(page, `schema=${encodeURIComponent(schema)}&before=v1&after=v2`)
    await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
    await expect(page.locator('[data-active-view]')).toHaveText(`${title} renderer · built-in, sandboxed`)
    await scrubOrDiff(page, schema)
  })
}

for (const [schema, [bundle]] of Object.entries(dedicatedRenderers)) {
  test(`${schema} presents the comparison through its dedicated renderer`, async ({page}) => {
    // One frame: animated, or diff for a renderer without animation.
    await open(page, `schema=${encodeURIComponent(schema)}&before=v1&after=v2${withoutAnimation.has(schema) ? '&mode=diff' : ''}`)
    await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
    await expect(frame(page).locator(`[data-renderer="${bundle}"]`)).toHaveAttribute('data-mode', 'comparison')
    await expect(frame(page).locator('[data-entity-id] >> visible=true').first()).toBeVisible()
    await scrubOrDiff(page, schema)
  })
}

test('the page has no horizontal overflow and dark mode reaches the renderer', async ({page}) => {
  await open(page, '')
  await page.getByLabel('Theme').selectOption('dark')
  await expect(view(page)).toHaveAttribute('data-color-mode', 'dark')
  await expect(frame(page).locator('html')).toHaveAttribute('data-color-mode', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('embedders can control progress and playback', async ({page}) => {
  await open(page, 'controlled&before=v1&after=v2&loop=false')
  const slider = page.getByRole('slider', {name: 'Transition'})
  await page.getByRole('button', {name: 'Tour: seek 25%'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '0.25')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0.25')
  await expect(slider).toHaveValue('25')

  // User seeks are requests the embedder applies.
  await slider.fill('60')
  await expect(page.getByLabel('Tour progress')).toHaveText('60%')
  await expect(view(page)).toHaveAttribute('data-progress', '0.6')

  // An embedder that ignores requests keeps the view where it is.
  await page.getByLabel('Ignore requests').check()
  const before = Number(await page.getByLabel('Tour requests').textContent())
  await slider.fill('10')
  await expect.poll(async () => Number(await page.getByLabel('Tour requests').textContent())).toBeGreaterThan(before)
  await expect(view(page)).toHaveAttribute('data-progress', '0.6')
  await expect(slider).toHaveValue('60')
  await page.getByLabel('Ignore requests').uncheck()

  // Embedder-started playback advances through progress requests and stops itself at the end.
  await page.getByRole('button', {name: 'Tour: play from start'}).click()
  await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeVisible()
  // The default duration is at least 4.5 s of travel plus the holds.
  await expect(view(page)).toHaveAttribute('data-progress', '1', {timeout: 20_000})
  await expect(page.getByLabel('Tour playing')).toHaveText('no')
  await expect(page.getByLabel('Tour progress')).toHaveText('100%')
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '1')

  // The view's own Play button requests playback from the embedder.
  await page.getByRole('button', {name: 'Tour: seek 25%'}).click()
  await page.getByRole('button', {name: /^Play (forward|backward)$/}).click()
  await expect(page.getByLabel('Tour playing')).toHaveText('yes')
  await page.getByRole('button', {name: 'Tour: pause'}).click()
  await expect(page.getByRole('button', {name: /^Play (forward|backward)$/})).toBeVisible()
})

test('controlled playback under reduced motion shows the endpoint immediately', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await open(page, 'controlled&before=v1&after=v2')
  await page.getByRole('button', {name: 'Tour: play from start'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '1')
  await expect(page.getByLabel('Tour playing')).toHaveText('no')
})

test('renderers declare controls that the host draws and delivers as options and actions', async ({page}) => {
  await open(page, 'renderer=hostile&probe=controls')
  const report = page.getByRole('alert').filter({hasText: /options|action/})
  await expect(report).toContainText('options layout=vertical labels=true zoom=100 grid=undefined action=none')
  // The `zoom` group is drawn in the toolbar row; the other declared controls are in Settings.
  const zoom = await inToolbar(page.getByRole('group', {name: 'Projection toolbar'}), scope => scope.getByRole('group', {name: 'Zoom'}))
  await zoom.getByRole('slider', {name: 'Zoom'}).fill('150')
  await expect(report).toContainText('zoom=150')
  await zoom.getByRole('button', {name: 'Fit'}).click()
  await expect(report).toContainText('action=fit')
  // The other declared controls are in Settings, in the renderer's options submenu (no zoom there).
  const settings = await openSettings(page)
  await expect(settings.getByRole('menuitem', {name: /Zoom/})).toHaveCount(0)
  const options = await openSettingsSubmenu(page, 'Hostile probe options')
  await options.getByRole('group', {name: 'Layout'}).getByRole('menuitemradio', {name: 'Horizontal'}).click()
  await expect(report).toContainText('options layout=horizontal labels=true zoom=150')
  await chooseSetting(page, 'Labels', 'Hostile probe options')
  await expect(report).toContainText('options layout=horizontal labels=false zoom=150')
  // The invalid re-declaration (a duplicate ID) is dropped; the valid one adds a control.
  const again = await openSettingsSubmenu(page, 'Hostile probe options')
  await expect(menuItem(again, 'Grid')).toBeVisible()
  await expect(again.getByRole('group', {name: 'Layout'}).getByRole('menuitemradio', {name: 'Horizontal'})).toBeChecked()
  await closeMenus(page)
})

test('definition presentation defaults seed host and renderer settings, with notices for unknown options', async ({page}) => {
  const defaults = {
    highlighting: 'on',
    changesOnly: false,
    rendererOptions: {layout: 'horizontal', zoom: 150, labels: 'sometimes', shading: true},
  }
  await open(page, `renderer=hostile&probe=controls&defaults=${encodeURIComponent(JSON.stringify(defaults))}`)
  const report = page.getByRole('alert').filter({hasText: /options/})
  await expect(report).toContainText('options layout=horizontal labels=true zoom=150')
  const settings = await openSettings(page)
  await expect(submenuItem(settings, 'Highlight changes')).toContainText('Always')
  // The definition opts out of the Changes scope.
  await expect(submenuItem(settings, 'Show')).toContainText('Everything')
  await closeMenus(page)
  const notices = page.getByRole('list', {name: 'Notices'})
  await expect(notices).toContainText(
    'The projection definition sets "shading", which the Hostile probe renderer doesn\'t offer; it was ignored.',
  )
  await expect(notices).toContainText(
    'The projection definition\'s value for "Labels" isn\'t valid for this renderer; its default is used.',
  )
  // Viewers can still change every default.
  // The renderer's ungrouped options share one submenu, its choices headed by their labels.
  const options = await openSettingsSubmenu(page, 'Hostile probe options')
  await options.getByRole('group', {name: 'Layout'}).getByRole('menuitemradio', {name: 'Vertical'}).click()
  await expect(report).toContainText('options layout=vertical labels=true zoom=150')
  await chooseSetting(page, 'Off', 'Highlight changes')
  await expectSetting(page, 'Off', true, 'Highlight changes')
})

test('a definition can choose the initial comparison mode', async ({page}) => {
  await open(page, `mode=default&defaults=${encodeURIComponent(JSON.stringify({mode: 'swipe'}))}`)
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'swipe')
  await chooseMode(page, 'Side by side')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
})

async function openSlider(page: Page) {
  await open(page, 'before=v1&after=v3&loop=false')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  return view(page)
}

test('the transition slider follows exact progress during playback and seeking', async ({page}) => {
  const root = await openSlider(page)
  const slider = page.getByRole('slider', {name: 'Transition'})
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(root).toHaveAttribute('data-progress', '0')
  await page.getByRole('button', {name: 'Play forward'}).click()
  // Sample the thumb every animation frame while it plays.
  const samples = await slider.evaluate(
    (input: HTMLInputElement) =>
      new Promise<number[]>(resolve => {
        const values: number[] = []
        const tick = () => {
          values.push(input.valueAsNumber)
          if (values.length < 40 && input.valueAsNumber < 100) requestAnimationFrame(tick)
          else resolve(values)
        }
        requestAnimationFrame(tick)
      }),
  )
  // Playback may already have reached the end on a slow machine; then there is nothing to pause.
  const pause = page.getByRole('button', {name: 'Pause', exact: true})
  if (await pause.isVisible()) await pause.click({timeout: 5_000}).catch(() => {})
  await expect(page.getByRole('button', {name: /^Play (forward|backward)$/})).toBeVisible()
  const moving = samples.filter(value => value > 0 && value < 100)
  expect(moving.length).toBeGreaterThan(3)
  expect(
    moving.some(value => Math.abs(value - Math.round(value)) > 1e-6),
    `samples: ${moving.join(', ')}`,
  ).toBe(true)
  for (let index = 1; index < samples.length; index++) expect(samples[index]!).toBeGreaterThanOrEqual(samples[index - 1]!)

  // A pointer lands anywhere on the track, not on whole percentages.
  const box = (await slider.boundingBox())!
  const seeked: number[] = []
  for (const fraction of [0.3737, 0.6181]) {
    await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
    await expect.poll(async () => Number(await root.getAttribute('data-progress'))).not.toBe(seeked.at(-1) ?? -1)
    seeked.push(Number(await root.getAttribute('data-progress')))
  }
  expect(
    seeked.some(progress => Math.abs(progress * 100 - Math.round(progress * 100)) > 1e-6),
    `seeked: ${seeked.join(', ')}`,
  ).toBe(true)
  // Only the visible text is rounded (on a phone the percent is in the toolbar's overflow).
  await expect(await inToolbar(page, scope => scope.getByLabel('Transition position'))).toHaveText(`${Math.round(seeked.at(-1)! * 100)}%`)
  await closeMenus(page)

  // Keyboard steps: 1% arrows, step-end jumps, endpoints.
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(root).toHaveAttribute('data-progress', '0')
  await page.keyboard.press('ArrowRight')
  await expect(root).toHaveAttribute('data-progress', '0.01')
  await page.keyboard.press('PageUp')
  await expect.poll(async () => Number(await root.getAttribute('data-progress'))).toBeGreaterThan(0.01)
  await page.keyboard.press('End')
  await expect(root).toHaveAttribute('data-progress', '1')
  await page.keyboard.press('ArrowLeft')
  await expect(root).toHaveAttribute('data-progress', '0.99')
})

test('a renderer whose requested height oscillates settles instead of flapping', async ({page}) => {
  // Frames take the renderer's requested height only when the view doesn't fill its container.
  await open(page, 'renderer=hostile&probe=oscillate&fill=false')
  const iframe = page.locator('iframe.ph-frame')
  // Record every height the host applies while the renderer alternates between 500 and 700 px.
  const applied = await iframe.evaluate(
    (element: HTMLIFrameElement) =>
      new Promise<string[]>(resolve => {
        const heights: string[] = []
        const observer = new MutationObserver(() => {
          if (heights.at(-1) !== element.style.height) heights.push(element.style.height)
        })
        observer.observe(element, {attributes: true, attributeFilter: ['style']})
        setTimeout(() => {
          observer.disconnect()
          resolve(heights)
        }, 1500)
      }),
  )
  await expect(iframe).toHaveCSS('height', '700px')
  // After the first return to an earlier height, the frame stays at the larger one.
  expect(applied.length, applied.join(', ')).toBeLessThanOrEqual(4)
})

test('the host draws a renderer legend once, outside the panes and swipe layers, in the host theme', async ({page}) => {
  await open(page, 'renderer=hostile&probe=legend&before=v1&after=v3')
  const legend = page.locator('.ph-legend')
  await expect(legend).toHaveCount(1)
  await expect(legend).toHaveAccessibleName('Changes')
  await expect(legend.locator('.ph-legend-item')).toHaveText(['Added', 'Removed', 'Calls', 'Inferred', 'Changed'])
  // Token swatches use the host theme's value for the token.
  const added = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.ph')!).getPropertyValue('--projections-color-added').trim(),
  )
  const swatch = await legend
    .locator('.ph-legend-item')
    .first()
    .locator('.ph-legend-swatch')
    .evaluate(element => getComputedStyle(element).backgroundColor)
  const expected = await page.evaluate(color => {
    const probe = document.createElement('span')
    probe.style.color = color
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, added)
  expect(swatch).toBe(expected)
  for (const [name, mode] of [
    ['Side by side', 'side-by-side'],
    ['Swipe', 'swipe'],
  ] as const) {
    await chooseMode(page, name)
    await expect(view(page)).toHaveAttribute('data-comparison-mode', mode)
    await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
    // Both panes send the legend; the host still draws one, outside every pane.
    await expect(page.locator('.ph-legend')).toHaveCount(1)
    await expect(page.locator('[data-side] .ph-legend, .ph-swipe-layer .ph-legend')).toHaveCount(0)
  }
})

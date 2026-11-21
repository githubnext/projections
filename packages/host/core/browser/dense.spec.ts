import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {
  chooseMode,
  closeMenus,
  expectSetting,
  explorer,
  inToolbar,
  menuItem,
  openFilter,
  openMore,
  openSettings,
  openSettingsSubmenu,
  showAs,
  showEverything,
  submenuItem,
  showAsChip,
} from './harness.js'
import {toolbarGeometry} from './toolbar-geometry.js'

/**
 * The default UI's dense layout: a planned toolbar above a stage that takes the rest of the view, on desktop and on
 * a phone. Narrower toolbars collapse in priority order rather than wrapping; animated playback takes a planned
 * second row on a phone and on desktop (toolbar-layout.spec.ts sweeps the widths).
 */
const view = (page: Page) => page.locator('.ph')
const toolbar = (page: Page) => page.getByRole('group', {name: 'Projection toolbar'})
const desktop = {width: 1440, height: 900}
const iPhone13 = {width: 390, height: 664}

async function open(page: Page, query: string, size?: {width: number; height: number}) {
  if (size) await page.setViewportSize(size)
  await page.goto(explorer(query))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** The stage's share of the view's height, and of its box. */
const stageShare = (page: Page) =>
  page.evaluate(() => {
    const hostBox = document.querySelector('.ph')!.getBoundingClientRect()
    const stage = document.querySelector('.ph-stage-body')!.getBoundingClientRect()
    return {height: stage.height / hostBox.height, area: (stage.width * stage.height) / (hostBox.width * hostBox.height)}
  })

for (const [name, size] of [
  ['1440×900', desktop],
  ['iPhone 13', iPhone13],
] as const) {
  for (const [mode, query] of [
    ['animated', 'before=v1&after=v3'],
    ['side by side', 'mode=side-by-side&before=v1&after=v3'],
    ['swipe', 'mode=swipe&before=v1&after=v3'],
  ] as const) {
    // Animated playback takes a second row with a full-width slider, on a phone and on desktop. Otherwise one row.
    const rows = mode === 'animated' ? 2 : 1
    test(`at ${name} the ${mode} toolbar has ${rows} planned row${rows > 1 ? 's' : ''} and the stage takes at least 80% of the view's height`, async ({
      page,
    }) => {
      await open(page, query, size)
      const geometry = await toolbarGeometry(page)
      expect(geometry.overlaps).toEqual([])
      expect(geometry.outside).toEqual([])
      expect(geometry.overflow).toBeLessThanOrEqual(0)
      expect(geometry.rows).toHaveLength(rows)
      if (rows === 2) {
        expect(geometry.rows[1]!.playbackOnly).toBe(true)
        expect(geometry.slider!).toBeGreaterThanOrEqual(0.8 * geometry.rows[1]!.width)
      }
      expect(geometry.height).toBeLessThanOrEqual(rows === 2 ? 84 : 48)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
      const share = await stageShare(page)
      expect(share.height).toBeGreaterThanOrEqual(0.8)
      if (size === desktop) expect(share.area).toBeGreaterThanOrEqual(0.85)
    })
  }
}

test('on desktop row 1 holds, in order, the picker, mode, scope, zoom actions, filter, settings, info and full screen; row 2 playback', async ({
  page,
}) => {
  await open(page, 'before=v1&after=v3', desktop)
  const row = toolbar(page)
  const left = async (locator: Locator) => (await locator.boundingBox())!.x
  const [, second] = await row.locator(':scope > .ph-toolbar-row').all()
  await expect(second!.getByRole('group', {name: 'Comparison playback'})).toBeVisible()
  const order = [
    row.getByLabel('Compare from'),
    row.getByRole('radiogroup', {name: 'Comparison mode'}),
    row.locator('.ph-scope-slot'),
    row.getByRole('group', {name: 'Zoom'}),
    row.getByRole('button', {name: 'Filter', exact: true}),
    row.getByRole('button', {name: 'Settings'}),
    row.getByRole('button', {name: 'About this projection'}),
    row.getByRole('button', {name: 'Enter full screen'}),
  ]
  const positions = []
  for (const locator of order) positions.push(await left(locator))
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  await expect(row.getByRole('button', {name: 'More', exact: true})).toHaveCount(0)
  // Table and text are in Settings ("Show as"), not the row; playback has one play button and small step buttons.
  await expect(row.getByRole('tablist')).toHaveCount(0)
  await expect(row.getByRole('group', {name: 'Comparison playback'}).getByRole('button', {name: /^(Play|Pause)/})).toHaveCount(1)
  for (const name of ['Previous step', 'Next step']) {
    expect((await row.getByRole('button', {name}).boundingBox())!.width).toBeLessThanOrEqual(32)
  }
  // The renderer's `zoom` group: icon buttons named by their labels.
  for (const name of ['Zoom out', 'Fit to view', 'Zoom in']) {
    await expect(row.getByRole('group', {name: 'Zoom'}).getByRole('button', {name})).toBeVisible()
  }
  // The active-view label and the comparator stay mounted, visually hidden; About shows them.
  await expect(page.locator('[data-active-view]')).toHaveText('Graph renderer · built-in, sandboxed')
  await expect(page.locator('[data-active-view]')).not.toBeInViewport()
  await expect(page.locator('.ph-comparator')).toHaveAttribute('data-comparator', 'default')
  const about = page.getByRole('dialog', {name: 'About this projection'})
  await row.getByRole('button', {name: 'About this projection'}).click()
  await expect(about.getByRole('heading', {name: 'Checkout evolution'})).toBeVisible()
  await expect(about).toContainText('Showing: Graph renderer · built-in, sandboxed')
  await expect(about).toContainText('Compared in this browser with the default comparator')
  await expect(about).toContainText('Synthetic demonstration')
})

test('on a phone, row 1 keeps the pickers, mode, Settings and More; row 2 is playback with a full-width slider', async ({page}) => {
  await open(page, 'before=v1&after=v3', iPhone13)
  const row = toolbar(page)
  const [first, second] = await row.locator(':scope > .ph-toolbar-row').all()
  // Compact revision triggers: short names, the full ones as their titles, the native selects still labeled.
  await expect(first!.getByLabel('Compare from')).toHaveValue('v1')
  await expect(first!.getByLabel('To', {exact: true})).toHaveValue('v3')
  await expect(first!.locator('[data-slot="revision-trigger"]').first()).toHaveAttribute('title', 'Compare from: v1 · base')
  await expect(first!.getByRole('button', {name: 'Comparison mode: Animated'})).toBeVisible()
  await expect(first!.getByRole('button', {name: 'Settings', exact: true})).toBeVisible()
  await expect(first!.getByRole('button', {name: 'More', exact: true})).toBeVisible()
  const playback = second!.getByRole('group', {name: 'Comparison playback'})
  await expect(playback.getByRole('button', {name: /^Play (forward|backward)$/})).toBeVisible()
  const slider = playback.getByRole('slider', {name: 'Transition'})
  expect((await slider.boundingBox())!.width).toBeGreaterThanOrEqual(0.8 * (await second!.boundingBox())!.width)
  // More holds the actions row 1 has no room for (zoom first, Filter last); no second play control and no view switch.
  const more = await openMore(page)
  await expect(more.getByRole('button', {name: 'Zoom in', exact: true})).toBeVisible()
  await expect(more.getByRole('button', {name: /^(Play|Pause)/})).toHaveCount(0)
  await expect(more.getByRole('tablist')).toHaveCount(0)
  await closeMenus(page)
  // Every action is reachable: in row 1 or in More.
  for (const name of ['Zoom out', 'Fit to view', 'Zoom in', 'About this projection', 'Enter full screen']) {
    await expect(await inToolbar(page, scope => scope.getByRole('button', {name, exact: true}))).toBeVisible()
    await closeMenus(page)
  }
  await expect(await openFilter(page)).toBeVisible()
  await closeMenus(page)
  // The steps and percent are reachable too: in the playback group's overflow, or in More.
  for (const name of ['Previous step', 'Next step']) {
    await expect(await inToolbar(page, scope => scope.getByRole('button', {name, exact: true}))).toBeVisible()
  }
  await closeMenus(page)
  // Settings shows the table instead of the renderer; the row's chip returns to it.
  await (await openSettings(page)).getByRole('group', {name: 'Show as'}).getByRole('menuitemradio', {name: 'Table'}).click()
  await expect(view(page)).toHaveAttribute('data-view', 'table')
  await closeMenus(page)
  await expect(showAsChip(page)).toBeVisible()
  const geometry = await toolbarGeometry(page)
  expect(geometry.overlaps).toEqual([])
  expect(geometry.rows.length).toBeLessThanOrEqual(2)
  await showAsChip(page).click()
  await expect(view(page)).toHaveAttribute('data-view', 'renderer')
})

test('Settings shows the projection as the renderer, a table or text; a chip in the row returns to the renderer', async ({page}) => {
  await open(page, 'before=v1&after=v3', desktop)
  const row = toolbar(page)
  await expect(showAsChip(page)).toHaveCount(0)
  await expect(row.getByRole('group', {name: 'Zoom'})).toBeVisible()
  const settings = await openSettings(page)
  // "Show as" leads Settings: radio items for the renderer (checked), Table and Text, which arrow keys move through.
  const group = settings.getByRole('group', {name: 'Show as'})
  await expect(group.getByRole('menuitemradio')).toHaveText(['Graph', 'Table', 'Text'])
  await expect(group.getByRole('menuitemradio', {name: 'Graph'})).toBeChecked()
  expect((await group.boundingBox())!.y).toBeLessThan((await submenuItem(settings, 'Show').boundingBox())!.y)
  await group.getByRole('menuitemradio', {name: 'Graph'}).focus()
  await page.keyboard.press('ArrowDown')
  await expect(group.getByRole('menuitemradio', {name: 'Table'})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(view(page)).toHaveAttribute('data-view', 'table')
  // Renderer-only settings and the zoom actions go while the table shows; the scope stays.
  const again = await openSettings(page)
  await expect(submenuItem(again, 'Show')).toBeVisible()
  await menuItem(again, 'Text').click()
  await expect(view(page)).toHaveAttribute('data-view', 'text')
  await closeMenus(page)
  await expect(row.getByRole('group', {name: 'Zoom'})).toHaveCount(0)
  await expect(page.locator('.ph-legend')).toBeHidden()
  // The chip names what is shown and where it goes; one click returns to the renderer, with focus kept in the row.
  const chip = showAsChip(page)
  await expect(chip).toHaveAccessibleName('Showing text; show the Graph renderer')
  await expect(chip).toHaveText('Text')
  await chip.click()
  await expect(view(page)).toHaveAttribute('data-view', 'renderer')
  await expect(chip).toHaveCount(0)
  await expect(row.getByRole('group', {name: 'Zoom'})).toBeVisible()
  await showAs(page, 'Table')
  await expect(page.locator('[data-active-view]')).toHaveText('Built-in table view')
  await expect(chip).toHaveAccessibleName('Showing table; show the Graph renderer')
})

test('Space toggles playback from the toolbar and the stage, but not in fields or controls that use Space', async ({page}) => {
  await open(page, `before=v1&after=v3&loop=false&defaults=${encodeURIComponent(JSON.stringify({durationMs: 20_000}))}`, desktop)
  const row = toolbar(page)
  const slider = row.getByRole('slider', {name: 'Transition'})
  await slider.press('Home')
  await expect(view(page)).toHaveAttribute('data-position', '0')
  // On the slider, which has no use for Space, Space plays and pauses.
  await slider.press(' ')
  await expect(row.getByRole('button', {name: 'Pause', exact: true})).toBeVisible()
  await slider.press(' ')
  await expect(row.getByRole('button', {name: 'Play forward'})).toBeVisible()
  // The row's background and the stage's chrome take focus when clicked; Space there toggles too.
  await row.focus()
  await page.keyboard.press(' ')
  await expect(row.getByRole('button', {name: 'Pause', exact: true})).toBeVisible()
  await page.locator('.ph-stage-box').focus()
  await page.keyboard.press(' ')
  await expect(row.getByRole('button', {name: 'Play forward'})).toBeVisible()
  // A text field types the space; a radio keeps it; neither toggles playback.
  const paused = await view(page).getAttribute('data-position')
  const field = await openFilter(page)
  await field.press(' ')
  await expect(field).toHaveValue(' ')
  await field.fill('')
  await (await inToolbar(page, scope => scope.getByRole('radio', {name: 'Animated'}))).press(' ')
  await page.waitForTimeout(300)
  await expect(row.getByRole('button', {name: 'Play forward'})).toBeVisible()
  await expect(view(page)).toHaveAttribute('data-position', paused!)
})

test('reduced motion keeps one button, named for the endpoint it shows', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await open(page, 'before=v1&after=v3', desktop)
  const playback = toolbar(page).getByRole('group', {name: 'Comparison playback'})
  await expect(playback.getByRole('button', {name: 'Show v1 · base'})).toBeVisible()
  await expect(playback.getByRole('button', {name: /^(Play|Pause|Show)/})).toHaveCount(1)
  await playback.getByRole('button', {name: 'Show v1 · base'}).click()
  await expect(view(page)).toHaveAttribute('data-progress', '0')
  await expect(playback.getByRole('button', {name: 'Show v3 · latest push'})).toBeVisible()
})

test('Settings, About, Filter and More open from the keyboard; Escape closes them and returns focus', async ({page}) => {
  await open(page, 'before=v1&after=v3', desktop)
  // Settings is a menu: focus moves into it, and Escape returns it to the button.
  const gear = toolbar(page).getByRole('button', {name: 'Settings', exact: true})
  await gear.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', {name: 'Settings'})
  await expect(menu).toBeVisible()
  await expect(gear).toHaveAttribute('aria-expanded', 'true')
  expect(await menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
  expect(await menu.evaluate(element => Boolean(element.closest('.pj-root')))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(gear).toBeFocused()
  for (const name of ['About this projection']) {
    const button = toolbar(page).getByRole('button', {name, exact: true})
    await button.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', {name})
    await expect(dialog).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(await dialog.evaluate(element => element.contains(document.activeElement) || element === document.activeElement)).toBe(true)
    // The popover renders inside the scoped root, so it keeps the UI's styles.
    expect(await dialog.evaluate(element => Boolean(element.closest('.pj-root')))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeFocused()
  }
  const filter = toolbar(page).getByRole('button', {name: 'Filter', exact: true})
  await filter.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Filter rows', {exact: true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(filter).toBeFocused()

  await open(page, 'before=v1&after=v3', iPhone13)
  const more = toolbar(page).getByRole('button', {name: 'More', exact: true})
  await more.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', {name: 'More'})
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  // About opens over More; Escape closes it first, then More.
  await dialog.getByRole('button', {name: 'About this projection', exact: true}).press('Enter')
  await expect(page.getByRole('dialog', {name: 'About this projection'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', {name: 'About this projection'})).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(more).toBeFocused()
})

test('Settings holds the view settings, without a connector setting', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  const settings = await openSettings(page)
  // A comparison opens on its changes.
  await expect(submenuItem(settings, 'Show')).toContainText('Changes')
  // Submenus show their current values.
  await expect(submenuItem(settings, 'Highlight changes')).toContainText('During the transition')
  await expect(submenuItem(settings, 'Playback')).toContainText('1×')
  const playback = await openSettingsSubmenu(page, 'Playback')
  await expect(playback.getByRole('group', {name: 'Speed'}).getByRole('menuitemradio', {name: '1×'})).toBeChecked()
  // Looping is on by default and switched here. No setting draws a connector: shared selection styling links the panes.
  await expect(menuItem(playback, 'Loop')).toBeChecked()
  await expect(page.getByText('Show connector')).toHaveCount(0)
  await menuItem(playback, 'Loop').click()
  await expectSetting(page, 'Loop', false, 'Playback')
  // In side by side, Settings offers no playback settings and no connector.
  await chooseMode(page, 'Side by side')
  const sideBySide = await openSettings(page)
  await expect(sideBySide.getByText('Show connector')).toHaveCount(0)
  await expect(submenuItem(sideBySide, 'Playback')).toHaveCount(0)
})

test('reduced motion hides the Loop setting', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await open(page, 'before=v1&after=v3')
  const playback = await openSettingsSubmenu(page, 'Playback')
  await expect(playback.getByRole('group', {name: 'Speed'})).toBeVisible()
  await expect(menuItem(playback, 'Loop')).toHaveCount(0)
})

test('Filter expands into the find field; Escape clears the query, then collapses the field back to the button', async ({page}) => {
  await open(page, 'before=v1&after=v3&view=table', desktop)
  // Every item, so each row the filter keeps names the query (the Changes scope adds their context).
  await showEverything(page)
  const button = toolbar(page).getByRole('button', {name: 'Filter', exact: true})
  await button.click()
  const field = page.getByLabel('Filter rows', {exact: true})
  await expect(field).toBeFocused()
  await field.fill('pay')
  await expect(page.locator('.ph-table-view tbody tr[data-row-id]')).not.toHaveCount(0)
  for (const id of await page.locator('.ph-table-view tbody tr[data-row-id]').evaluateAll(rows => rows.map(row => row.textContent ?? ''))) {
    expect(id.toLowerCase()).toContain('pay')
  }
  // While a query applies, the field stays expanded.
  await showAs(page, 'Text')
  await expect(field).toHaveValue('pay')
  await field.press('Escape')
  await expect(field).toHaveValue('')
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(button).toBeFocused()
  // On a phone the field is in More.
  await open(page, 'before=v1&after=v3&view=table', iPhone13)
  await showEverything(page)
  const inMore = await openFilter(page)
  await inMore.fill('pay')
  await expect(page.locator('.ph-table-view tbody tr[data-row-id]').first()).toContainText(/pay/i)
})

test('full screen shows the view over the page; without element full screen it falls back to a fixed overlay that Escape exits', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', {get: () => false}))
  await open(page, 'before=v1&after=v3')
  await (await inToolbar(page, scope => scope.getByRole('button', {name: 'Enter full screen'}))).click()
  await expect(view(page)).toHaveAttribute('data-fullscreen', 'fallback')
  const box = (await view(page).boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.width).toBeCloseTo(viewport.width, 0)
  expect(box.height).toBeCloseTo(viewport.height, 0)
  await expect(await inToolbar(page, scope => scope.getByRole('button', {name: 'Exit full screen'}))).toBeVisible()
  // Escape closes More first (when the row is condensed), then exits.
  if (await page.getByRole('dialog', {name: 'More'}).isVisible()) {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', {name: 'More'})).toHaveCount(0)
  }
  await page.keyboard.press('Escape')
  await expect(view(page)).not.toHaveAttribute('data-fullscreen')
})

test('fill is the default; fill={false} sizes the view to its content', async ({page}) => {
  await open(page, 'before=v1&after=v3', {width: 1280, height: 900})
  await expect(view(page)).toHaveAttribute('data-fill')
  await expect(page.locator('.ph-stage')).toHaveAttribute('data-fill')
  await open(page, 'before=v1&after=v3&fill=false', {width: 1280, height: 900})
  await expect(view(page)).not.toHaveAttribute('data-fill')
  await expect(page.locator('.ph-stage')).not.toHaveAttribute('data-fill')
  // Frames take the renderer's height rather than the view's.
  const frame = (await page.locator('iframe.ph-frame').boundingBox())!
  expect(frame.height).toBeLessThan(800)
})

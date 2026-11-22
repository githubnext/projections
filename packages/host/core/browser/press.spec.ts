import {test, expect, type Locator, type Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * Pressing any toolbar control moves its content 1px down, the same for every kind of control (plain buttons, menu
 * and popover triggers, segmented items, the play lens, the Show-as chip), and never its box. A menu trigger springs
 * back on release, open or not; under reduced motion nothing moves. Desktop pointers; the phones' toolbar holds the same controls.
 */
test.skip(({isMobile}) => isMobile, 'A mouse press; the desktop projects cover Chromium and WebKit.')

const pressable = 'button, [role="button"], [role="radio"], [data-slot="select-trigger"]'

/** The computed `translate` of each of a control's element children (its icon and label), and its lens face. */
const offsets = (control: Locator) =>
  control.evaluate(element => [
    ...[...element.children].filter(child => child.tagName !== 'INPUT').map(child => getComputedStyle(child).translate),
    ...(element.classList.contains('pj-lens') ? [getComputedStyle(element, '::before').translate] : []),
  ])

interface Press {
  control: Element | null
  active: boolean
  offsets: string[]
}
/**
 * The next press, read as it lands: the control under the pointer, whether it is `:active`, and its content's offsets
 * then. A press can open a menu or move focus, after which WebKit may recompute what the pointer presses; a later read
 * on a loaded runner would see that instead of the press.
 */
const nextPress = (page: Page) =>
  page.evaluate(
    selector =>
      new Promise<void>(resolve => {
        const record = (event: Event) => {
          const control = (event.target as Element).closest(selector)
          const press: Press = {control, active: Boolean(control?.matches(':active')), offsets: []}
          if (control) {
            press.offsets = [
              ...[...control.children].filter(child => child.tagName !== 'INPUT').map(child => getComputedStyle(child).translate),
              ...(control.classList.contains('pj-lens') ? [getComputedStyle(control, '::before').translate] : []),
            ]
          }
          ;(window as unknown as {press?: Press}).press = press
        }
        delete (window as unknown as {press?: Press}).press
        window.addEventListener('pointerdown', record, {capture: true, once: true})
        resolve()
      }),
    pressable,
  )
/** The press `nextPress` recorded, once the mouse press has reached the page, and whether it pressed `control`. */
async function recorded(page: Page, control: Locator) {
  await expect.poll(() => page.evaluate(() => 'press' in window)).toBe(true)
  return control.evaluate(element => {
    const press = (window as unknown as {press: Press}).press
    return {pressed: press.control === element, active: press.active, offsets: press.offsets}
  })
}

/** Presses each enabled control of the toolbar with a real mouse, reads its content's offset and box, then lets go away from it. */
async function pressAll(page: Page, expected: string) {
  const toolbar = page.getByRole('group', {name: 'Projection toolbar'})
  const controls = await toolbar.locator(pressable).filter({visible: true}).all()
  const seen: string[] = []
  for (const control of controls) {
    if (await control.isDisabled()) continue
    const name = (await control.getAttribute('aria-label')) ?? (await control.textContent()) ?? ''
    const before = (await control.boundingBox())!
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await nextPress(page)
    await page.mouse.down()
    const press = await recorded(page, control)
    const moved = press.offsets
    const during = (await control.boundingBox())!
    // Released elsewhere, the press is no click: nothing toggles, zooms or opens.
    await page.mouse.move(2, 2)
    await page.mouse.up()
    expect(press.pressed && press.active, `${name} is pressed`).toBe(true)
    expect(moved.length, name).toBeGreaterThan(0)
    expect(new Set(moved), name).toEqual(new Set([expected]))
    expect(during, name).toEqual(before)
    seen.push(name)
    if (await page.locator('[data-pj-portal] [data-state="open"]').count()) await page.keyboard.press('Escape')
  }
  return seen
}

for (const [view, query] of [
  ['renderer', 'before=v1&after=v3'],
  ['table', 'before=v1&after=v3&view=table'],
] as const) {
  test(`every ${view} toolbar control moves its content, never its box, while pressed`, async ({page}) => {
    await page.setViewportSize({width: 1600, height: 900})
    await page.goto(explorer(query))
    await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
    const seen = await pressAll(page, '0px 1px')
    expect(seen).toEqual(expect.arrayContaining(['Settings', 'About this projection', 'Enter full screen']))
    expect(seen.some(name => /^Play|^Pause/.test(name))).toBe(true)
    if (view === 'renderer') expect(seen).toEqual(expect.arrayContaining(['Zoom out', 'Fit to view', 'Zoom in', 'Swap', 'Animated']))
    else expect(seen.some(name => name.startsWith('Showing table'))).toBe(true)
    // At rest nothing is offset.
    for (const control of await page.getByRole('group', {name: 'Projection toolbar'}).locator(pressable).filter({visible: true}).all()) {
      expect(new Set(await offsets(control))).not.toContain('0px 1px')
    }
  })
}

test('a menu trigger springs back on release, even while its menu is open; reduced motion presses nothing', async ({page}) => {
  await page.setViewportSize({width: 1600, height: 900})
  await page.goto(explorer('before=v1&after=v3'))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
  const settings = page.getByRole('group', {name: 'Projection toolbar'}).getByRole('button', {name: 'Settings', exact: true})
  await settings.click()
  await expect(page.getByRole('menu', {name: 'Settings'})).toBeVisible()
  await page.mouse.move(2, 2)
  await expect(settings).toHaveAttribute('aria-expanded', 'true')
  expect(new Set(await offsets(settings))).toEqual(new Set(['none']))
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', {name: 'Settings'})).toHaveCount(0)
  expect(new Set(await offsets(settings))).toEqual(new Set(['none']))
  await page.emulateMedia({reducedMotion: 'reduce'})
  await pressAll(page, 'none')
})

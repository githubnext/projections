import {test, expect, type Locator, type Page} from '@playwright/test'
import {chooseMode, closeMenus, expectSetting, menuItem, openSettings, story, submenuItem} from './harness.js'

/*
 * The Settings menu in a short view (a 360px-tall webview or embed): it never runs past the view's edge, it scrolls
 * inside, every item of every level is reachable, and the keyboard moves through its submenus.
 */

const short = {width: 900, height: 360}

/** A Default UI renderer story, in animated mode (so Settings offers Playback). */
async function open(page: Page, id: string) {
  await page.setViewportSize(short)
  await page.goto(story(`default-ui-renderers--${id}`))
  await expect(page.locator('.ph[data-renderer-status="ready"]').first()).toBeVisible()
  await chooseMode(page, 'Animated')
}

/**
 * Waits until `menu`'s animations have ended. Repositioning a menu restarts a transition (its transform origin), which
 * cancels the run in progress, so whatever still runs once those end is awaited again.
 */
const settled = (menu: Locator) =>
  menu.evaluate(async element => {
    const running = () => element.getAnimations({subtree: true}).filter(animation => animation.playState !== 'finished')
    for (let animations = running(); animations.length; animations = running()) {
      await Promise.allSettled(animations.map(animation => animation.finished))
    }
  })

/** Every item of `menu` scrolls into view inside it, and the menu stays inside the viewport. */
async function everyItemReachable(page: Page, menu: Locator) {
  const view = page.viewportSize()!
  // Measured once its opening animation (a slight zoom) has finished.
  await settled(menu)
  const box = (await menu.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(view.height)
  const items = menu.locator('[role^="menuitem"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const item = items.nth(index)
    await item.scrollIntoViewIfNeeded()
    const rect = (await item.boundingBox())!
    expect(rect.y, `${await item.textContent()} top`).toBeGreaterThanOrEqual(box.y - 1)
    expect(rect.y + rect.height, `${await item.textContent()} bottom`).toBeLessThanOrEqual(Math.min(box.y + box.height, view.height) + 1)
  }
}

/** A menu's group headings are unique: no two option groups share a name. */
async function uniqueGroups(menu: Locator) {
  const names = await menu.getByRole('group').evaluateAll(groups => groups.map(group => group.getAttribute('aria-label')).filter(Boolean))
  expect(new Set(names).size, names.join(', ')).toBe(names.length)
}

for (const id of ['dependencies', 'file-packing']) {
  test(`in a 360px-tall view every Settings item is reachable at each level (${id})`, async ({page}) => {
    await open(page, id)
    const settings = await openSettings(page)
    await everyItemReachable(page, settings)
    await uniqueGroups(settings)
    const submenus = await settings
      .locator('[aria-haspopup="menu"]')
      .evaluateAll(items => items.map(item => item.getAttribute('data-submenu-id')))
    expect(submenus).toEqual(expect.arrayContaining(['highlighting', 'playback']))
    for (const submenu of submenus) {
      const trigger = (await openSettings(page)).locator(`[data-submenu-id="${submenu}"]`)
      await trigger.scrollIntoViewIfNeeded()
      await trigger.click()
      const name = await trigger.evaluate(element => element.querySelector('span')?.textContent ?? '')
      const level = page.getByRole('menu', {name, exact: true})
      await expect(level).toBeVisible()
      await everyItemReachable(page, level)
      await uniqueGroups(level)
      await closeMenus(page)
    }
  })
}

test('the dependency graph names its option groups by what they hold, not the renderer twice', async ({page}) => {
  await open(page, 'dependencies')
  const settings = await openSettings(page)
  const options = settings.getByRole('group', {name: 'Graph'})
  await expect(options.locator('[aria-haspopup="menu"]')).toHaveText([/^Packages/u, /^Dependencies/u])
  await submenuItem(settings, 'Packages').click()
  await expect(menuItem(page.getByRole('menu', {name: 'Packages'}), 'All packages')).not.toBeChecked()
})

test('the keyboard moves through Settings and its submenus, scrolling the focused item into view', async ({page}) => {
  await open(page, 'file-packing')
  const gear = page.getByRole('button', {name: 'Settings', exact: true})
  await gear.focus()
  await page.keyboard.press('Enter')
  const settings = page.getByRole('menu', {name: 'Settings'})
  await expect(settings).toBeVisible()
  // End reaches the last item, scrolled into view inside the short menu.
  await page.keyboard.press('End')
  const last = settings.locator('[role^="menuitem"]').last()
  await expect(last).toBeFocused()
  await settled(settings)
  const box = (await settings.boundingBox())!
  const rect = (await last.boundingBox())!
  expect(rect.y + rect.height).toBeLessThanOrEqual(box.y + box.height + 1)
  // Up to "Highlight changes", Right Arrow opens its submenu with focus on the checked choice.
  await settings.locator('[data-submenu-id="highlighting"]').focus()
  await page.keyboard.press('ArrowRight')
  const highlighting = page.getByRole('menu', {name: 'Highlight changes'})
  await expect(highlighting.getByRole('menuitemradio', {name: 'During the transition'})).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(highlighting.getByRole('menuitemradio', {name: 'Always'})).toBeFocused()
  // Left Arrow closes the submenu and returns focus to its item.
  await page.keyboard.press('ArrowLeft')
  await expect(highlighting).toHaveCount(0)
  await expect(settings.locator('[data-submenu-id="highlighting"]')).toBeFocused()
  // Enter opens it too; choosing closes the whole menu and applies the choice.
  await page.keyboard.press('Enter')
  await expect(highlighting).toBeVisible()
  await highlighting.getByRole('menuitemradio', {name: 'Always'}).focus()
  await page.keyboard.press('Enter')
  await expect(settings).toHaveCount(0)
  await expect(gear).toBeFocused()
  await expectSetting(page, 'Always', true, 'Highlight changes')
})

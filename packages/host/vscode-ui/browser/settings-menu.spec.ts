import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {focused, ready, story} from './harness.js'

/*
 * The Settings menu in a short webview: it never runs past the webview's edge (it opens under its action with at
 * most the room there, or over it), scrolls inside with every item reachable, its top level fits a 400px-tall
 * webview, and its submenus open beside it (or over it, with a row back) from the keyboard and the mouse.
 */

async function open(page: Page, id: string, height: number, width = 900) {
  await page.setViewportSize({width, height})
  await page.goto(story(`renderers--${id}`))
  await ready(page)
  // Narrow, the mode switch is a menu: keep the story's mode.
  if (width < 600) return
  const animated = page.getByRole('radio', {name: 'Animated', exact: true})
  if ((await animated.getAttribute('aria-checked')) !== 'true') await animated.click()
  await expect(page.locator('.phv-root')).toHaveAttribute('data-comparison-mode', 'animated')
}

const overlayOf = (menu: Locator) => menu.locator('xpath=..')

/** Every item of `menu` scrolls into view inside its overlay, which stays inside the viewport. */
async function everyItemReachable(page: Page, menu: Locator) {
  const view = page.viewportSize()!
  const overlay = overlayOf(menu)
  await expect(overlay).toHaveCSS('opacity', '1')
  const box = (await overlay.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(view.height)
  const items = menu.locator(':scope > * > [role^="menuitem"], :scope > [role^="menuitem"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const item = items.nth(index)
    await item.scrollIntoViewIfNeeded()
    const rect = (await item.boundingBox())!
    expect(rect.y, `${await item.textContent()} top`).toBeGreaterThanOrEqual(box.y - 1)
    expect(rect.y + rect.height, `${await item.textContent()} bottom`).toBeLessThanOrEqual(box.y + box.height + 1)
  }
}

/** A menu level's group names are unique: no two option groups share a heading. */
async function uniqueGroups(menu: Locator) {
  const names = await menu.locator(':scope > [role="group"]').evaluateAll(groups => groups.map(group => group.getAttribute('aria-label')))
  expect(new Set(names).size, names.join(', ')).toBe(names.length)
}

for (const id of ['dependencies', 'file-packing']) {
  test(`in a 360px-tall webview every Settings item is reachable at each level (${id})`, async ({page}) => {
    await open(page, id, 360)
    await page.getByRole('button', {name: 'Settings', exact: true}).click()
    const settings = page.getByRole('menu', {name: 'Settings'})
    await everyItemReachable(page, settings)
    await uniqueGroups(settings)
    const submenus = await settings
      .locator('[aria-haspopup="menu"]')
      .evaluateAll(items => items.map(item => item.getAttribute('data-menu-item')!))
    expect(submenus).toEqual(expect.arrayContaining(['highlighting', 'playback']))
    for (const submenu of submenus) {
      const trigger = settings.locator(`[data-menu-item="${submenu}"]`)
      await trigger.scrollIntoViewIfNeeded()
      await trigger.focus()
      await page.keyboard.press('ArrowRight')
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const name = await trigger.locator('.phv-menu-label').textContent()
      const level = page.getByRole('menu', {name: name!, exact: true})
      await everyItemReachable(page, level)
      await uniqueGroups(level)
      await page.keyboard.press('ArrowLeft')
      await expect(level).toHaveCount(0)
      await expect(trigger).toBeFocused()
    }
  })
}

test('the top level of Settings fits a 400px-tall webview without scrolling', async ({page}) => {
  for (const id of ['dependencies', 'file-packing']) {
    await open(page, id, 400)
    await page.getByRole('button', {name: 'Settings', exact: true}).click()
    const overlay = overlayOf(page.getByRole('menu', {name: 'Settings'}))
    await expect(overlay).toHaveCSS('opacity', '1')
    expect(await overlay.evaluate(element => element.scrollHeight - element.clientHeight), id).toBeLessThanOrEqual(0)
    await page.keyboard.press('Escape')
  }
})

test('the dependency graph names its option groups by what they hold, not the renderer twice', async ({page}) => {
  await open(page, 'dependencies', 600)
  await page.getByRole('button', {name: 'Settings', exact: true}).click()
  const settings = page.getByRole('menu', {name: 'Settings'})
  await expect(settings.getByRole('group', {name: 'Graph'}).locator('.phv-menu-label')).toHaveText(['Packages', 'Dependencies'])
  await expect(settings.locator('.phv-menu-heading')).toHaveText(['Show as', 'Graph'])
})

test('the keyboard and the mouse move through Settings’ submenus, keeping the focused item in view', async ({page}) => {
  await open(page, 'file-packing', 300)
  const gear = page.getByRole('button', {name: 'Settings', exact: true})
  await gear.click()
  const settings = page.getByRole('menu', {name: 'Settings'})
  // End focuses the last item, scrolled into view inside the short menu.
  await page.keyboard.press('End')
  const last = settings.locator('[role^="menuitem"]').last()
  await expect(last).toBeFocused()
  const box = (await overlayOf(settings).boundingBox())!
  const rect = (await last.boundingBox())!
  expect(rect.y + rect.height).toBeLessThanOrEqual(box.y + box.height + 1)
  // Home goes back to the first item; Right Arrow opens a submenu with focus on its checked choice.
  await page.keyboard.press('Home')
  const highlighting = settings.locator('[data-menu-item="highlighting"]')
  await highlighting.focus()
  await page.keyboard.press('ArrowRight')
  const submenu = page.getByRole('menu', {name: 'Highlight changes', exact: true})
  await expect(submenu.getByRole('menuitemradio', {name: 'During the transition'})).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(submenu.getByRole('menuitemradio', {name: 'Always'})).toBeFocused()
  // Escape closes only the submenu; focus returns to its item.
  await page.keyboard.press('Escape')
  await expect(submenu).toHaveCount(0)
  await expect(settings).toBeVisible()
  await expect(highlighting).toBeFocused()
  // Enter opens it too; choosing closes the whole menu, applies the choice and returns focus to Settings.
  await page.keyboard.press('Enter')
  await submenu.getByRole('menuitemradio', {name: 'Always'}).focus()
  await page.keyboard.press('Enter')
  await expect(settings).toHaveCount(0)
  expect((await focused(page)).label).toBe('Settings')
  await gear.click()
  await expect(highlighting).toContainText('Always')
  // Hovering a submenu item opens its submenu beside the menu without taking focus from it.
  await highlighting.hover()
  await expect(submenu).toBeVisible()
  const parent = (await overlayOf(settings).boundingBox())!
  const child = (await overlayOf(submenu).boundingBox())!
  expect(child.x + child.width <= parent.x + 4 || child.x >= parent.x + parent.width - 4).toBe(true)
  await expect(highlighting).toBeFocused()
})

test('where neither side has room, a submenu covers its menu with a row back', async ({page}) => {
  await open(page, 'dependencies', 500, 360)
  await page.getByRole('button', {name: 'Settings', exact: true}).click()
  const settings = page.getByRole('menu', {name: 'Settings'})
  await settings.locator('[data-menu-item="highlighting"]').focus()
  await page.keyboard.press('ArrowRight')
  const submenu = page.getByRole('menu', {name: 'Highlight changes', exact: true})
  const back = submenu.getByRole('menuitem', {name: 'Back from Highlight changes'})
  await expect(back).toBeVisible()
  const box = (await overlayOf(submenu).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(360)
  await back.click()
  await expect(submenu).toHaveCount(0)
  await expect(settings.locator('[data-menu-item="highlighting"]')).toBeFocused()
})

import {expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'

/**
 * The pages this suite drives are Storybook harness stories (tools/storybook/harness/), served from the static build by
 * tools/storybook/scripts/serve.mjs with a production-like page policy and the renderer policy on renderer bundles.
 */
const base = () => process.env.PROJECTIONS_STORYBOOK_URL!

/** A harness story; `query` holds the harness's own parameters (packages/host/core/browser/README.md). */
export const story = (id: string, query = '') => new URL(`iframe.html?id=${id}&viewMode=story${query ? `&${query}` : ''}`, base()).href
/**
 * The explorer harness with the given query parameters. Unless a spec chooses them, it opens in animated mode (the
 * renderer's default is side by side; pass `mode=default` to keep it) and uses `holds=pause`, so the
 * slider position is the presentation progress and specs can seek to exact progress values; specs of the timeline
 * holds pass `holds=timeline`.
 */
export const explorer = (query = '') => {
  const params = query.replace(/^[?&]/u, '')
  // Specs written for playback open in animated mode unless they choose one; `mode=default` keeps the renderer's default.
  const withHolds = /(?:^|&)holds=/u.test(params) ? params : [params, 'holds=pause'].filter(Boolean).join('&')
  return story('harness-default-ui--explorer', /(?:^|&)mode=/u.test(withHolds) ? withHolds : `${withHolds}&mode=animated`)
}
/** A file the build serves, for example `renderers/graph/index.html`, or the server's `__probe-log`. */
export const served = (path: string) => new URL(path, base()).href

type Scope = Page | Locator
const pageOf = (scope: Scope): Page => ('page' in scope ? scope.page() : scope)
/** A toolbar popover by name while it is open, not while a closed one plays its exit animation. */
const openDialog = (scope: Scope, name: string) =>
  pageOf(scope).getByRole('dialog', {name}).and(pageOf(scope).locator('[data-state="open"]'))
/** Waits until no toolbar popover or menu is playing its exit animation, so a control inside it isn't mistaken for a shown one. */
const settled = (scope: Scope) => expect(pageOf(scope).locator(':is([role="dialog"], [role="menu"])[data-state="closed"]')).toHaveCount(0)

/**
 * The toolbar keeps every block inline when it has room. Narrower, it collapses in priority order (docs/guides/host-ui.md):
 * the pickers become compact triggers and then one "Revisions: …" button, the comparison mode a "Comparison mode: …"
 * menu, the steps and percent move into the playback group's "More playback controls", and zoom, Filter, About and
 * full screen into "More" (Settings stays in the row). These helpers find a block either way.
 */
export async function openMore(scope: Scope): Promise<Locator> {
  const more = openDialog(scope, 'More')
  if (!(await more.isVisible())) await scope.getByRole('button', {name: 'More', exact: true}).first().click()
  await more.waitFor()
  return more
}

/** A toolbar block, inline when shown in the row, else in the playback group's overflow or the More menu. */
export async function inToolbar(scope: Scope, locate: (container: Scope) => Locator): Promise<Locator> {
  await settled(scope)
  const inline = locate(scope).first()
  if (await inline.isVisible()) return inline
  const playback = scope.getByRole('button', {name: 'More playback controls', exact: true})
  if (await playback.count()) {
    await playback.first().click()
    const dialog = openDialog(scope, 'Playback')
    await dialog.waitFor()
    if (await locate(dialog).count()) return locate(dialog).first()
    await pageOf(scope).keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  if (await scope.getByRole('button', {name: 'More', exact: true}).count()) return locate(await openMore(scope)).first()
  return inline
}

/**
 * The "Show as" group at the top of the Settings menu (opened): the renderer, Table and Text, as `menuitemradio`s.
 */
export async function showAsGroup(scope: Scope): Promise<Locator> {
  return (await openSettings(scope)).getByRole('group', {name: 'Show as'})
}
/** Shows the renderer (by its title), "Table" or "Text" through Settings' "Show as"; choosing closes the menu. */
export async function showAs(scope: Scope, name: string) {
  await (await showAsGroup(scope)).getByRole('menuitemradio', {name, exact: true}).click()
  await closeMenus(scope)
}
/**
 * Closes open toolbar popovers and menus (Settings, About, Revisions, the mode menu, More), innermost first. A menu
 * that closed itself on a choice is left to finish its exit animation, not sent an Escape: with nothing open, an
 * Escape reaches the view and closes what it shows (its detail card).
 */
export async function closeMenus(scope: Scope) {
  await settled(scope)
  const dialogs = pageOf(scope)
    .getByRole('dialog')
    .or(pageOf(scope).getByRole('menu'))
    .and(pageOf(scope).locator(':not([data-state="closed"])'))
  for (let open = await dialogs.count(), i = 0; open > 0 && i < 3; open = await dialogs.count(), i++) {
    await pageOf(scope).keyboard.press('Escape')
    // Each Escape closes the innermost popover and returns focus to its button; wait for it before the next.
    await expect.poll(() => dialogs.count()).toBeLessThan(open)
    await settled(scope)
  }
  await expect(dialogs).toHaveCount(0)
}
/** The row's chip while the table or text view is shown in place of the renderer: one click returns to the renderer. */
export const showAsChip = (scope: Scope) => scope.getByRole('button', {name: /^Showing (table|text); show the /u})

/** The "Comparison mode" radio group, inline or in its menu (opened). */
export async function modeGroup(scope: Scope): Promise<Locator> {
  await settled(scope)
  const inline = scope.locator('.ph-toolbar').getByRole('radiogroup', {name: 'Comparison mode'}).first()
  if (await inline.isVisible()) return inline
  const menu = openDialog(scope, 'Comparison mode')
  if (!(await menu.isVisible())) {
    await scope
      .getByRole('button', {name: /^Comparison mode: /u})
      .first()
      .click()
  }
  await menu.waitFor()
  return menu.getByRole('radiogroup', {name: 'Comparison mode'})
}
/**
 * Chooses a comparison mode. In the menu, choosing closes it, and this returns once the menu has handed focus on: it
 * does so only as it unmounts, after its exit animation, so a control the test focused before then would lose its
 * focus, and the keys pressed next would miss it.
 */
export async function chooseMode(scope: Scope, name: string) {
  const group = await modeGroup(scope)
  const inMenu = (await group.locator('xpath=ancestor::*[@role="dialog"]').count()) > 0
  await group.getByRole('radio', {name, exact: true}).click()
  if (!inMenu) return
  await settled(scope)
  // The popover's focus scope hands focus on in a timer it starts as it unmounts; one started now runs after it.
  await pageOf(scope).evaluate(
    () =>
      new Promise(resolve => {
        setTimeout(resolve, 0)
      }),
  )
}
/** Asserts the checked mode, closing the menu again if it had to be opened. */
export async function expectMode(scope: Scope, name: string) {
  const opened = !(await scope.locator('.ph-toolbar').getByRole('radiogroup', {name: 'Comparison mode'}).first().isVisible())
  await expect((await modeGroup(scope)).getByRole('radio', {name, exact: true})).toBeChecked()
  if (opened) await pageOf(scope).keyboard.press('Escape')
}
/** The mode switch in either form: none when there is nothing to choose. */
export const modeControls = (scope: Scope) =>
  scope.getByRole('radiogroup', {name: 'Comparison mode'}).or(scope.getByRole('button', {name: /^Comparison mode: /u}))

/** The pair picker's "Compare from" or "To" select, inline or in the "Revisions" popover (opened). */
export async function pairSelect(scope: Scope, label: 'Compare from' | 'To' | 'Show'): Promise<Locator> {
  await settled(scope)
  const inline = scope.getByLabel(label, {exact: true}).first()
  if (await inline.isVisible()) return inline
  const popover = openDialog(scope, 'Revisions')
  if (!(await popover.isVisible())) {
    await scope
      .getByRole('button', {name: /^Revisions?: /u})
      .first()
      .click()
  }
  await popover.waitFor()
  return popover.getByLabel(label, {exact: true})
}

/** Swaps the pair with the picker's Swap button, inline or in the "Revisions" popover. */
export async function swapPair(scope: Scope) {
  const inline = scope.getByRole('button', {name: 'Swap', exact: true}).first()
  if (await inline.isVisible()) {
    await inline.click()
    return
  }
  await (await pairSelect(scope, 'Compare from')).waitFor()
  await openDialog(scope, 'Revisions').getByRole('button', {name: 'Swap', exact: true}).click()
}

/** Opens the "About this projection" popover unless it is open, and returns it. */
export async function openPopover(scope: Scope, name: 'About this projection'): Promise<Locator> {
  const button = await inToolbar(scope, container => container.getByRole('button', {name, exact: true}))
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  const popover = openDialog(scope, name)
  await popover.waitFor()
  return popover
}

/** A menu by name while it is open (Settings or one of its submenus), not while a closed one plays its exit animation. */
const openMenu = (scope: Scope, name: string) =>
  pageOf(scope).getByRole('menu', {name, exact: true}).and(pageOf(scope).locator('[data-state="open"]'))

/**
 * Opens the Settings menu unless it is open, and returns it: "Show as", then submenus for "Show" (the scope),
 * "Highlight changes", "Renderer", "Playback" and the renderer's option groups (`openSettingsSubmenu`).
 */
export async function openSettings(scope: Scope): Promise<Locator> {
  const menu = openMenu(scope, 'Settings')
  if (await menu.isVisible()) return menu
  const button = await inToolbar(scope, container => container.getByRole('button', {name: 'Settings', exact: true}))
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await menu.waitFor()
  return menu
}
/** A Settings submenu's item, by its label (its current value follows in its name). */
export const submenuItem = (menu: Locator, name: string) =>
  menu.getByRole('menuitem', {name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`)})
/** Opens a Settings submenu, for example "Highlight changes" or "Playback", and returns it. */
export async function openSettingsSubmenu(scope: Scope, name: string): Promise<Locator> {
  const menu = openMenu(scope, name)
  if (await menu.isVisible()) return menu
  // By keyboard: where a submenu opens to the left, the menu reads the pointer's jump into it as moving away from it (its
  // first move in the menu always reads as rightward), so the submenu closes as the pointer leaves its item, and a click
  // on one of its items lands only while it fades out; on a slow runner it falls through to whatever is behind.
  await submenuItem(await openSettings(scope), name).press('ArrowRight')
  await menu.waitFor()
  return menu
}
/** An item of a menu: a radio choice, a checkbox or a plain item. */
export const menuItem = (menu: Locator, name: string) => {
  // Exactly the label, or the label and the text after it (a checkbox's detail, "Loop Back and forth").
  const label = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}( |$)`)
  return menu
    .getByRole('menuitemradio', {name: label})
    .or(menu.getByRole('menuitemcheckbox', {name: label}))
    .or(menu.getByRole('menuitem', {name: label}))
}
/** Chooses an item in Settings, or in one of its submenus (`submenu`), by keyboard (see `openSettingsSubmenu`); choosing closes the menu. */
export async function chooseSetting(scope: Scope, name: string, submenu?: string) {
  const menu = submenu ? await openSettingsSubmenu(scope, submenu) : await openSettings(scope)
  await menuItem(menu, name).press('Enter')
  await closeMenus(scope)
}
/** Shows every item: the All scope, from Settings' "Show" (the toolbar's scope switch leaves narrow rows). */
export const showEverything = (scope: Scope) => chooseSetting(scope, 'Everything', 'Show')
/** Whether a Settings item (in `submenu`) is checked; the menu is closed again after. */
export async function expectSetting(scope: Scope, name: string, checked: boolean, submenu?: string) {
  const menu = submenu ? await openSettingsSubmenu(scope, submenu) : await openSettings(scope)
  if (checked) await expect(menuItem(menu, name)).toBeChecked()
  else await expect(menuItem(menu, name)).not.toBeChecked()
  await closeMenus(scope)
}

/** The "Filter rows" field: expands the toolbar's Filter button, or opens More where the field is inline. */
export async function openFilter(scope: Scope): Promise<Locator> {
  const field = scope.getByLabel('Filter rows', {exact: true}).first()
  if (await field.isVisible()) return field
  const button = scope.getByRole('button', {name: 'Filter', exact: true}).first()
  if (await button.isVisible()) {
    await button.click()
    // The field expands in the row, or, on a two-row toolbar, opens in a popover rendered outside the view.
    const page = 'page' in scope && typeof scope.page === 'function' ? scope.page() : (scope as Page)
    const anywhere = page.getByLabel('Filter rows', {exact: true}).first()
    await anywhere.waitFor()
    return (await field.isVisible()) ? field : anywhere
  }
  return (await openMore(scope)).getByLabel('Filter rows', {exact: true})
}

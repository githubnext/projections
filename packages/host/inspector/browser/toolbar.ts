import {expect, type Locator, type Page} from '@playwright/test'

/**
 * The view's toolbar keeps every block inline when it has room; on phones (and narrow views) zoom, Filter, About
 * and full screen move into its "More" menu (Settings stays in the row). These find a block either way.
 */
async function inToolbar(page: Page, locate: (scope: Page | Locator) => Locator): Promise<Locator> {
  // A popover playing its exit animation still shows its controls; wait until it is gone.
  await expect(page.locator('.ph [role="dialog"][data-state="closed"], [data-pj-portal] [role="dialog"][data-state="closed"]')).toHaveCount(
    0,
  )
  // The view's own toolbar: the Inspector's title bar has a "Settings" button too.
  const inline = locate(page.locator('.ph')).first()
  if (await inline.isVisible()) return inline
  const more = page.getByRole('dialog', {name: 'More'})
  if (!(await more.isVisible())) {
    await page.getByRole('group', {name: 'Projection toolbar'}).getByRole('button', {name: 'More', exact: true}).click()
  }
  await more.waitFor()
  return locate(more).first()
}

/**
 * Shows the projection as the renderer (by its title), "Table" or "Text": the "Show as" group at the top of the
 * view's Settings (inline, or from More on a phone). Closes the menus again so the view underneath takes clicks.
 */
export async function showAs(page: Page, name: string) {
  const settings = page.getByRole('menu', {name: 'Settings'})
  if (!(await settings.isVisible())) {
    await (await inToolbar(page, scope => scope.getByRole('button', {name: 'Settings', exact: true}))).click()
  }
  await settings.getByRole('group', {name: 'Show as'}).getByRole('menuitemradio', {name, exact: true}).click()
  await expect(page.locator('.ph')).toHaveAttribute('data-view', name === 'Table' ? 'table' : name === 'Text' ? 'text' : 'renderer')
  await closeToolbarMenus(page)
}

/** The "Filter rows" field: the Filter button expands into it (or opens it in a popover), or it is in More. */
export async function openFilter(page: Page): Promise<Locator> {
  const field = page.getByLabel('Filter rows', {exact: true}).first()
  if (await field.isVisible()) return field
  const button = page.getByRole('group', {name: 'Projection toolbar'}).getByRole('button', {name: 'Filter', exact: true})
  if (await button.isVisible()) {
    await button.click()
    return field
  }
  return inToolbar(page, scope => scope.getByLabel('Filter rows', {exact: true}))
}

/**
 * Closes the toolbar popovers that are open (Filter, Settings, More), innermost first, so the view underneath takes
 * clicks. The Filter popover (on a two-row toolbar) closes from its button, which keeps the query.
 */
export async function closeToolbarMenus(page: Page) {
  if (await page.getByRole('dialog', {name: 'Filter', exact: true}).isVisible()) {
    await page.getByRole('group', {name: 'Projection toolbar'}).getByRole('button', {name: 'Filter', exact: true}).click()
    await expect(page.getByRole('dialog', {name: 'Filter', exact: true})).toHaveCount(0)
  }
  for (const name of ['Settings', 'More']) {
    const dialog = page.getByRole('dialog', {name}).or(page.getByRole('menu', {name}))
    if (await dialog.isVisible()) {
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  }
}

/**
 * Chooses a comparison mode with the view's mode switch: its segmented control, or its "Comparison mode: …" menu on
 * a crowded toolbar. Comparisons open side by side; specs of playback choose "Animated".
 */
export async function chooseMode(page: Page, name: string) {
  await expect(page.locator('.ph [role="dialog"][data-state="closed"], [data-pj-portal] [role="dialog"][data-state="closed"]')).toHaveCount(
    0,
  )
  const inline = page.locator('.ph-toolbar').getByRole('radiogroup', {name: 'Comparison mode'}).first()
  if (await inline.isVisible()) await inline.getByRole('radio', {name, exact: true}).click()
  else {
    await page
      .getByRole('button', {name: /^Comparison mode: /u})
      .first()
      .click()
    await page.getByRole('dialog', {name: 'Comparison mode'}).getByRole('radio', {name, exact: true}).click()
  }
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', name === 'Side by side' ? 'side-by-side' : name.toLowerCase())
}

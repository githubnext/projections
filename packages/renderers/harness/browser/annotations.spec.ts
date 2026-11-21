import {expect, test} from '@playwright/test'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

// Kit renderers state change status in footers at the bottom of items; annotation badges sit at the top left by default.
for (const key of ['dependency-injection/orders', 'graph/service-platform', 'graph/platform-worker']) {
  test(`annotation badges stay clear of change markers and change colors (${key})`, async ({page}) => {
    test.slow()
    await page.goto(harnessInspector().page({scenario: key, annotate: '', mode: 'animated'}))
    const view = page.locator('.ph')
    await expect(view).toHaveAttribute('data-renderer-status', 'ready')
    // With highlighting always on, every changed item shows its change marker at the end of the transition.
    // Highlighting is a submenu of the toolbar's Settings menu.
    // On a phone the toolbar keeps Settings in its More menu.
    // The view's own Settings, in its toolbar (the Inspector's title bar has an app Settings menu too).
    const toolbar = page.getByRole('group', {name: 'Projection toolbar'})
    const settings = toolbar.getByRole('button', {name: 'Settings', exact: true})
    if (!(await settings.isVisible())) await toolbar.getByRole('button', {name: 'More', exact: true}).click()
    await settings.click()
    // By keyboard: here the submenu opens to the left, and the menu reads the pointer's jump into it as moving right
    // (its first move in the menu always reads so), not towards the submenu, so the submenu closes as the pointer leaves
    // its item; a click then lands only while it fades out, and on a slow runner falls through to the renderer's frame.
    await page
      .getByRole('menu', {name: 'Settings'})
      .getByRole('menuitem', {name: /^Highlight changes/})
      .press('ArrowRight')
    await page.getByRole('menu', {name: 'Highlight changes'}).getByRole('menuitemradio', {name: 'Always'}).press('Enter')
    await expect(page.getByRole('menu', {name: 'Settings'})).toHaveCount(0)
    if (await page.getByRole('dialog', {name: 'More'}).isVisible()) await page.keyboard.press('Escape')
    await page.getByRole('slider', {name: 'Transition'}).fill('100')
    await expect(view).toHaveAttribute('data-rendered-progress', '1')
    await expect(page.frameLocator('iframe.ph-frame').locator('.node-status').first()).toBeAttached()
    // Fitted on a phone, the whole composition is smaller than a badge; zoom in to the size a reader would, at least half size.
    const scale = async () => Number(await page.frameLocator('iframe.ph-frame').locator('[data-scale]').first().getAttribute('data-scale'))
    await expect.poll(scale).toBeGreaterThan(0)
    // The view opens fitted, the whole composition in view; Fit to view keeps it there, then zoom in as a reader would.
    const zoomAction = async (name: string) => {
      const inline = page.getByRole('group', {name: 'Zoom'}).getByRole('button', {name, exact: true})
      if (await inline.isVisible()) await inline.click()
      else {
        // On a phone the toolbar keeps zoom in its More menu.
        const more = page.getByRole('dialog', {name: 'More'}).and(page.locator('[data-state="open"]'))
        if (!(await more.isVisible())) await page.getByRole('button', {name: 'More', exact: true}).click()
        await more.getByRole('button', {name, exact: true}).click()
      }
    }
    await zoomAction('Fit to view')
    await expect.poll(async () => page.frameLocator('iframe.ph-frame').locator('[data-zoom]').first().getAttribute('data-zoom')).toBe('1')
    for (let presses = 0; presses < 8 && (await scale()) < 0.5; presses++) {
      const before = await scale()
      await zoomAction('Zoom in')
      await expect.poll(scale).toBeGreaterThan(before)
    }
    if (await page.getByRole('dialog', {name: 'More'}).isVisible()) await page.keyboard.press('Escape')
    await page.locator('iframe.ph-frame').scrollIntoViewIfNeeded()
    const frame = page.frameLocator('iframe.ph-frame')
    await expect(frame.locator('[data-projections-annotation]:not([hidden])').first()).toBeVisible()
    const report = await frame.locator('body').evaluate(async () => {
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve)
        })
      })
      const boxes = (selector: string) =>
        [...document.querySelectorAll(selector)]
          .filter(element => !(element as HTMLElement).hidden)
          .map(element => element.getBoundingClientRect())
          .filter(box => box.width > 0 && box.height > 0)
      const badges = boxes('[data-projections-annotation]')
      const markers = boxes('.node-status')
      const overlaps = badges.flatMap(badge =>
        markers
          .filter(
            marker =>
              Math.min(badge.right, marker.right) - Math.max(badge.left, marker.left) > 0.5 &&
              Math.min(badge.bottom, marker.bottom) - Math.max(badge.top, marker.top) > 0.5,
          )
          .map(marker => `${JSON.stringify(badge.toJSON())} × ${JSON.stringify(marker.toJSON())}`),
      )
      // Resolve every change token to a computed color.
      const probe = document.createElement('div')
      document.body.append(probe)
      const changeColors = ['added', 'removed', 'modified', 'moved'].flatMap(change =>
        ['', '-muted', '-emphasis', '-highlight'].map(variant => {
          probe.style.backgroundColor = `var(--projections-color-${change}${variant})`
          return getComputedStyle(probe).backgroundColor
        }),
      )
      probe.remove()
      const badgeColors = [...document.querySelectorAll<HTMLElement>('[data-projections-annotation]')].flatMap(badge => {
        const style = getComputedStyle(badge)
        return [badge.dataset.tone ?? 'neutral', style.backgroundColor, style.color, style.borderTopColor]
      })
      const tones = new Set(
        [...document.querySelectorAll<HTMLElement>('[data-projections-annotation]')].map(badge => badge.dataset.tone ?? 'neutral'),
      )
      return {badges: badges.length, markers: markers.length, overlaps, changeColors, badgeColors, tones: [...tones]}
    })
    expect(report.badges).toBeGreaterThan(0)
    expect(report.markers).toBeGreaterThan(0)
    expect(report.overlaps).toEqual([])
    // Rows cycle through the tones; at least two are drawn here (the SDK unit tests cover every tone's styles).
    expect(report.tones.length, report.tones.join(', ')).toBeGreaterThanOrEqual(2)
    const used = report.badgeColors.filter((_, index) => index % 4 !== 0)
    for (const color of used) expect(report.changeColors, `badge color ${color}`).not.toContain(color)
  })
}

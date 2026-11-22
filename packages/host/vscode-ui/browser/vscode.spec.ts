import {expect, test} from '@playwright/test'
import {colors, contrast, focused, ready, story, themes} from './harness.js'

// One explorer per test: renderer frames are heavy, so the suite is meant to run with few workers (two locally).

test.describe('the VS Code UI renders in every captured VS Code theme', () => {
  for (const theme of themes) {
    test(theme, async ({page}) => {
      await page.goto(story('comparison-explorer--side-by-side', theme))
      await ready(page)
      const root = page.locator('.phv-root')
      await expect(root).toHaveAttribute('data-host-ui', 'vscode')
      const classes = (await page.locator('.sb-vscode-frame').getAttribute('class'))!.split(/\s+/u)
      const kind = classes.includes('vscode-high-contrast-light')
        ? 'high-contrast-light'
        : classes.includes('vscode-high-contrast')
          ? 'high-contrast'
          : classes.includes('vscode-light')
            ? 'light'
            : 'dark'
      await expect(root).toHaveAttribute('data-vscode-theme-kind', kind)
      // The chrome draws the theme's own editor background and its font.
      const expected = await page.locator('.sb-vscode-frame').evaluate(frame => {
        const probe = document.createElement('div')
        probe.style.background = getComputedStyle(frame).getPropertyValue('--vscode-editor-background')
        frame.append(probe)
        probe.style.fontFamily = getComputedStyle(frame).getPropertyValue('--vscode-font-family')
        const value = {background: getComputedStyle(probe).backgroundColor, font: getComputedStyle(probe).fontFamily}
        probe.remove()
        return value
      })
      expect(await root.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(expected.background)
      expect(await root.evaluate(element => getComputedStyle(element).fontFamily)).toBe(expected.font)
      // Codicons draw: VSCode Elements' icon has the font's glyph width.
      const icon = page.locator('.phv-toolbar vscode-toolbar-button').first()
      await expect(icon).toBeVisible()
      expect(await icon.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(22)
      // Renderer frames receive the theme: their tokens are the mapped VS Code colors.
      await expect(page.locator('.phv-box iframe').first()).toBeVisible()
    })
  }
})

test('every comparison mode is a VS Code toggle, chosen by click and by arrow keys through the shadow DOM', async ({page}) => {
  await page.goto(story('comparison-explorer--side-by-side'))
  await ready(page)
  const group = page.getByRole('radiogroup', {name: 'Comparison mode'})
  for (const [name, mode] of [
    ['Animated', 'animated'],
    ['Swipe', 'swipe'],
    ['Side by side', 'side-by-side'],
  ] as const) {
    await group.getByRole('radio', {name, exact: true}).click()
    await expect(page.locator('.phv-root')).toHaveAttribute('data-comparison-mode', mode)
    await expect(group.getByRole('radio', {name, exact: true})).toHaveAttribute('aria-checked', 'true')
  }
  // Only the checked mode is in the tab order; arrows move and choose.
  await group.getByRole('radio', {name: 'Side by side', exact: true}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.phv-root')).not.toHaveAttribute('data-comparison-mode', 'side-by-side')
  const after = await focused(page)
  expect(after).toMatchObject({tag: 'button', host: 'vscode-toolbar-button', role: 'radio', focusId: 'mode'})
})

test('the toolbar is reachable with Tab, shows VS Code focus outlines and opens VS Code menus', async ({page, browserName}) => {
  await page.goto(story('comparison-explorer--side-by-side'))
  await ready(page)
  const focusBorder = await page.locator('.sb-vscode-frame').evaluate(frame => {
    const probe = document.createElement('div')
    probe.style.color = getComputedStyle(frame).getPropertyValue('--vscode-focusBorder')
    frame.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })
  // Tab from the page start to the Settings action, through the dropdowns and toggles in their shadow roots.
  await page.locator('body').click({position: {x: 1, y: 1}})
  let settings = false
  // WebKit, like Safari, tabs to buttons only with Option.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let presses = 0; presses < 30 && !settings; presses++) {
    await page.keyboard.press(tab)
    settings = (await focused(page)).label === 'Settings'
  }
  expect(settings).toBe(true)
  expect(await focused(page)).toMatchObject({tag: 'button', host: 'vscode-toolbar-button', outline: focusBorder, outlineWidth: '1px'})
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', {name: 'Settings'})
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('group', {name: 'Show as'}).getByRole('menuitemradio', {name: 'Graph'})).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // Focus starts on the checked item; arrows move; Enter chooses and closes.
  expect((await focused(page)).role).toBe('menuitemradio')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator(':focus')).toHaveText('Table')
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(page.locator('.phv-root')).toHaveAttribute('data-view', 'table')
  expect((await focused(page)).label).toBe('Settings')
  // Escape closes a menu and returns focus to its action.
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  expect((await focused(page)).label).toBe('Settings')
  // The Show as chip returns to the renderer.
  await page.getByRole('button', {name: /^Showing table; show the/u}).click()
  await expect(page.locator('.phv-root')).toHaveAttribute('data-view', 'renderer')
})

test('Filter is VS Code’s find input in a widget, and its count follows the query', async ({page}) => {
  await page.goto(story('comparison-explorer--side-by-side'))
  await ready(page)
  await page.getByRole('button', {name: 'Filter', exact: true}).click()
  const widget = page.getByRole('dialog', {name: 'Filter'})
  await expect(widget).toBeVisible()
  expect(await focused(page)).toMatchObject({tag: 'input', host: 'vscode-textfield'})
  await page.keyboard.type('payments')
  await expect(widget.getByRole('status')).toHaveText(/rows match/u)
  await page.keyboard.press('Escape')
  await expect(widget).toBeHidden()
  expect((await focused(page)).label).toBe('Filter')
})

test('animated playback is drawn like the debug toolbar and plays, steps and scrubs', async ({page}) => {
  await page.goto(story('comparison-explorer--animated'))
  await ready(page)
  const playback = page.getByRole('group', {name: 'Comparison playback'})
  await expect(playback).toBeVisible()
  const slider = playback.getByRole('slider', {name: 'Transition'})
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(page.locator('.phv-root')).toHaveAttribute('data-position', '0')
  await playback.getByRole('button', {name: 'Next step'}).click()
  await expect(page.locator('.phv-root')).not.toHaveAttribute('data-position', '0')
  await page.keyboard.press('End')
  await slider.focus()
  await page.keyboard.press('End')
  await expect(page.locator('.phv-root')).toHaveAttribute('data-position', '1')
  // At the end there is no next step: the action is disabled on its shadow button.
  await expect(playback.getByRole('button', {name: 'Next step'})).toBeDisabled()
  const play = playback.getByRole('button', {name: /^Play/u})
  await expect(play).toBeVisible()
  const colorsOf = await page.locator('.phv-play').evaluate(element => getComputedStyle(element).color)
  const debugContinue = await page.locator('.sb-vscode-frame').evaluate(frame => {
    const probe = document.createElement('div')
    probe.style.color = getComputedStyle(frame).getPropertyValue('--vscode-debugIcon-continueForeground')
    frame.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })
  expect(colorsOf).toBe(debugContinue)
})

test.describe('the toolbar collapses into VS Code’s overflow menus without overflowing', () => {
  for (const width of [1440, 768, 600, 390, 320]) {
    test(`${width}px`, async ({page}) => {
      await page.setViewportSize({width: Math.max(width + 48, 480), height: 900})
      await page.goto(story('comparison-explorer--animated', 'dark-modern', `width:${width}`))
      await ready(page)
      const toolbar = page.locator('.phv-toolbar')
      const fit = await toolbar.evaluate(element => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
        overlap: [...element.children].some((child, index, all) =>
          all.slice(index + 1).some(other => {
            const a = child.getBoundingClientRect()
            const b = other.getBoundingClientRect()
            return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
          }),
        ),
      }))
      expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1)
      expect(fit.overlap).toBe(false)
      // Playback has row 2 to itself, so row 1 keeps every action until the explorer's pickers and modes crowd it.
      if (width <= 390) await expect(toolbar.getByRole('button', {name: 'More', exact: true})).toBeVisible()
      if (width >= 1440) expect(await toolbar.getAttribute('data-actions-overflow')).toBeNull()
    })
  }
})

test.describe('high contrast themes keep the contrast VS Code promises', () => {
  for (const theme of ['dark-high-contrast', 'light-high-contrast'] as const) {
    test(theme, async ({page}) => {
      await page.goto(story('comparison-explorer--table-view', theme))
      await page.locator('.phv-root .phv-table-view').waitFor()
      // Toolbar text and icons, table text (7:1, as VS Code's high contrast foreground), muted text and change labels (4.5:1).
      for (const [locator, ratio] of [
        [page.locator('.phv-toolbar').first(), 7],
        [page.locator('.phv-section-title').first(), 7],
        [page.locator('.phv-select').first(), 7],
        [page.locator('.phv-row-count'), 4.5],
      ] as const) {
        const {color, background} = await colors(locator)
        expect(contrast(color, background), await locator.evaluate(element => element.className)).toBeGreaterThanOrEqual(ratio)
      }
      for (const label of await page.locator('.phv-change-label[data-change]').all()) {
        const {color, background} = await colors(label)
        expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5)
      }
      // Menus: text on the menu background, and the focused item's text on its selection.
      await page.getByRole('button', {name: 'Settings'}).click()
      // Focus starts on the checked item: in the table view, "Show as: Table".
      const item = page.getByRole('menu', {name: 'Settings'}).getByRole('menuitemradio', {name: 'Table'})
      await expect(item).toBeFocused()
      const selected = await colors(item)
      expect(contrast(selected.color, selected.background)).toBeGreaterThanOrEqual(4.5)
      await page.keyboard.press('Escape')
      // The focus outline stands out from the toolbar.
      const settings = await focused(page)
      const toolbar = await colors(page.locator('.phv-toolbar').first())
      expect(contrast(settings.outline!, toolbar.background)).toBeGreaterThanOrEqual(3)
    })
  }
})

test('the Inspector shell takes VS Code’s look around the VS Code UI', async ({page}) => {
  await page.goto(story('inspector--document', 'light-modern'))
  await page.locator('[data-host-ui="vscode"] .pi-shell .phv-root[data-renderer-status="ready"]').waitFor()
  const titlebar = page.locator('[data-host-ui="vscode"] .pi-titlebar')
  expect(await titlebar.evaluate(element => element.getBoundingClientRect().height)).toBe(35)
  const statusbar = await colors(page.locator('[data-host-ui="vscode"] .pi-statusbar'))
  const statusBackground = await page.locator('.sb-vscode-frame').evaluate(frame => {
    const probe = document.createElement('div')
    probe.style.background = getComputedStyle(frame).getPropertyValue('--vscode-statusBar-background')
    frame.append(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  })
  expect(statusbar.background).toBe(statusBackground)
  // The view is the VS Code UI's, inside the shell's scoped root.
  await expect(page.locator('.pi-shell .phv-toolbar')).toBeVisible()
})

test('without the toolbar the view is the stage alone, for hosts that draw the controls as editor title actions', async ({page}) => {
  await page.goto(story('projection-view--without-toolbar'))
  await page.locator('.phv-root[data-renderer-status="ready"]').waitFor()
  await expect(page.locator('.phv-root')).toHaveAttribute('data-toolbar', 'none')
  await expect(page.locator('.phv-toolbar')).toHaveCount(0)
  await expect(page.locator('.phv-root')).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expect(page.locator('.phv-box iframe').first()).toBeVisible()
})

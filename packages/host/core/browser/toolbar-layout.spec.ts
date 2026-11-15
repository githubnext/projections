import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {explorer} from './harness.js'
import {reachableNames, toolbarGeometry} from './toolbar-geometry.js'

/**
 * The default UI's toolbar is planned, not wrapped (docs/guides/host-ui.md, "The toolbar"): it measures its own width and
 * collapses in priority order, using a second row only for playback. Sweeping the toolbar from 1600px to 320px in
 * 20px steps, in animated and side by side modes, every width must keep these rules.
 */
test.skip(({isMobile}) => isMobile, 'The sweep sizes the toolbar itself; the desktop projects cover Chromium and WebKit.')

/** Sizes the harness's view so the toolbar is `width` pixels wide, and waits for it to replan. */
async function setWidth(page: Page, width: number) {
  await page.evaluate(async toolbarWidth => {
    const view = document.querySelector<HTMLElement>('.demo-sized')!
    // The explorer's padding (16px each side) surrounds the toolbar.
    view.style.width = `${toolbarWidth + 32}px`
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, width)
}

async function open(page: Page, query: string) {
  await page.setViewportSize({width: 1720, height: 900})
  await page.goto(explorer(`${query}&width=1600`))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
}

const actions = ['Swap', 'Settings', 'About this projection', 'Enter full screen']
const common = [...actions, 'Zoom out', 'Fit to view', 'Zoom in']
const playback = ['Previous step', 'Next step', 'Transition', 'Transition position']
const animated = [...common, 'Animated', 'Side by side', 'Swipe', ...playback]

/** Moves the transition slider to an end with the keyboard, then releases focus so the toolbar plans freely again. */
async function slideTo(page: Page, key: 'Home' | 'End') {
  await page.getByRole('slider', {name: 'Transition'}).press(key)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

for (const [mode, query, expected] of [
  ['animated', 'before=v1&after=v3', animated],
  ['side by side', 'before=v1&after=v3&mode=side-by-side', [...common, 'Animated', 'Side by side', 'Swipe']],
  // The table view presents progress too, with the renderer's controls (zoom, modes) gone from the row.
  ['animated table', 'before=v1&after=v3&view=table', [...actions, 'Showing table; show the Graph renderer', ...playback]],
] as const)
  test(`the ${mode} toolbar keeps its layout rules from 1600px to 320px`, async ({page}) => {
    test.slow()
    await open(page, query)
    const seen = new Set<string>()
    for (let width = 1600; width >= 320; width -= 20) {
      await setWidth(page, width)
      const at = `at ${width}px`
      const geometry = await toolbarGeometry(page)
      expect(Math.round(geometry.width), at).toBe(width)
      expect(geometry.overflow, at).toBeLessThanOrEqual(0)
      // At most two planned rows; a second row is the playback row, its slider spanning the row.
      expect(geometry.rows.length, at).toBeLessThanOrEqual(2)
      if (geometry.rows.length === 2) {
        expect(mode, at).not.toBe('side by side')
        expect(geometry.rows[1]!.playbackOnly, at).toBe(true)
        expect(geometry.slider!, at).toBeGreaterThanOrEqual(0.8 * geometry.rows[1]!.width)
        // No empty-space fragments: the first row is mostly filled, and it collapses nothing while it has room.
        expect(geometry.rows[0]!.fill, at).toBeGreaterThanOrEqual(0.6)
        if (geometry.rows[0]!.collapsed) expect(geometry.rows[0]!.unused, at).toBeLessThan(0.4 * geometry.rows[0]!.width)
      }
      // Every control a person aims at is as tall as the others.
      expect(new Set(geometry.heights.map(control => control.height)), `${at}: ${JSON.stringify(geometry.heights)}`).toEqual(new Set([32]))
      // The content below starts right under the toolbar's hairline: the chrome is flat, with no gutter between them.
      expect(Math.abs(geometry.below!), at).toBeLessThanOrEqual(0.5)
      // The slider's thumb stays clear of the toolbar's border and corners at both ends (checked every 100px).
      if (mode !== 'side by side' && width % 100 === 0)
        for (const key of ['Home', 'End'] as const) {
          await slideTo(page, key)
          const {thumb} = await toolbarGeometry(page)
          expect(thumb!.left, `${key} ${at}`).toBeGreaterThanOrEqual(geometry.left + 8)
          expect(thumb!.right, `${key} ${at}`).toBeLessThanOrEqual(geometry.left + geometry.width - 8)
        }
      seen.add(`${geometry.rows.length}`)
      // Nothing overlaps or leaves the toolbar.
      expect(geometry.overlaps, at).toEqual([])
      expect(geometry.outside, at).toEqual([])
      // The slider keeps its minimum: 160px, or 120px on a toolbar under 480px.
      if (mode !== 'side by side') expect(geometry.slider!, at).toBeGreaterThanOrEqual(width < 480 ? 120 : 160)
      else expect(geometry.slider, at).toBeUndefined()
      // Every control is shown, or in an overflow popover by the same name.
      const names = await reachableNames(page)
      for (const name of expected) expect(names, `${name} ${at}`).toContain(name)
      expect(
        names.some(name => /^(Compare from|Revisions?: )/.test(name)),
        at,
      ).toBe(true)
      expect(
        names.some(name => /^(Play (forward|backward)|Pause)$/.test(name)),
        at,
      ).toBe(mode !== 'side by side')
      expect(
        names.some(name => name === 'Filter' || name === 'Filter rows'),
        at,
      ).toBe(true)
    }
    // Animated uses both layouts across the sweep; side by side stays on one row.
    expect([...seen].sort()).toEqual(mode === 'side by side' ? ['1'] : ['1', '2'])
  })

test('the toolbar switches between one and two rows with hysteresis, so it does not flicker at the boundary', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  const rows = async () => (await toolbarGeometry(page)).rows.length
  let width = 1000
  await setWidth(page, width)
  expect(await rows()).toBe(1)
  // Find the boundary coarsely, then in 4px steps from one row again: a 4px sweep from 1000px replans over a hundred
  // times, which outlasts the test's time on CI's WebKit. One row returns 24px (the hysteresis) past where it is
  // needed, which the coarse step may have passed by up to 20px.
  while ((await rows()) === 1 && width > 320) await setWidth(page, (width -= 20))
  expect(await rows()).toBe(2)
  await setWidth(page, (width += 20 + 24 + 4))
  expect(await rows()).toBe(1)
  while ((await rows()) === 1 && width > 320) await setWidth(page, (width -= 4))
  expect(await rows()).toBe(2)
  // Growing a little (within the 24px hysteresis) keeps two rows; growing past it returns to one.
  await setWidth(page, width + 12)
  expect(await rows()).toBe(2)
  await setWidth(page, width + 4)
  expect(await rows()).toBe(2)
  await setWidth(page, width + 40)
  expect(await rows()).toBe(1)
})

test('mode icons never look like playback: Animated is a clapperboard, distinct from the play, pause and step icons', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  const icons = (selector: string) =>
    page.locator(selector).evaluateAll(elements => elements.map(element => element.getAttribute('data-icon')).filter(Boolean))
  const modes = await icons('.ph-toolbar [role="radiogroup"][aria-label="Comparison mode"] svg[data-icon]')
  const playback = await icons('.ph-toolbar [role="group"][aria-label="Comparison playback"] svg[data-icon]')
  expect(modes).toEqual(['diff', 'columns-2', 'clapperboard', 'square-split-horizontal'])
  expect(playback).toEqual(expect.arrayContaining(['play', 'step-back', 'step-forward']))
  for (const icon of modes) expect(['play', 'pause', 'step-back', 'step-forward']).not.toContain(icon)
  // Every mode icon has a label or a tooltip.
  for (const radio of await page.getByRole('radiogroup', {name: 'Comparison mode'}).getByRole('radio').all())
    expect(await radio.getAttribute('title')).toBeTruthy()
  // The mode menu's button, on a narrow toolbar, shows the current mode's icon (not a play glyph) and names it.
  const menu = page.getByRole('button', {name: 'Comparison mode: Animated'})
  for (let width = 1000; width >= 320 && !(await menu.isVisible()); width -= 20) await setWidth(page, width)
  await expect(menu).toBeVisible()
  await expect(menu.locator('svg[data-icon]')).toHaveAttribute('data-icon', 'clapperboard')
  await expect(menu).toHaveAttribute('title', 'Comparison mode: Animated')
})

import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {explorer, story} from './harness.js'
import {reachableNames, toolbarGeometry} from './toolbar-geometry.js'

/**
 * The default UI's toolbar is planned, not wrapped (docs/guides/host-ui.md, "The toolbar"): it measures its own width and
 * collapses in priority order; playback always takes a second row of its own. Sweeping the toolbar from 1600px to 320px in
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
      // Playback always has a second row to itself, its slider spanning the row; without it, one row.
      expect(geometry.rows.length, at).toBe(mode === 'side by side' ? 1 : 2)
      if (geometry.rows.length === 2) {
        expect(geometry.rows[1]!.playbackOnly, at).toBe(true)
        expect(geometry.slider!, at).toBeGreaterThanOrEqual(0.8 * geometry.rows[1]!.width)
      }
      // A centred mode region sits at the row's centre, 24px or more from the regions beside it.
      if (geometry.rows[0]!.centred) {
        expect(Math.abs(geometry.cluster!.offset), at).toBeLessThanOrEqual(1)
        expect(geometry.cluster!.clearance, at).toBeGreaterThanOrEqual(24)
        expect(geometry.rows[0]!.collapsed, at).toBe(false)
      }
      seen.add(`centred ${geometry.rows[0]!.centred}`)
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
    // Each centres the mode region (in the table view, the scope alone) on a wide toolbar and moves it after the
    // pickers on a narrow one.
    expect([...seen].sort()).toEqual(['centred false', 'centred true'])
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

test('the mode region is centred while the row has room, then follows the pickers, with hysteresis', async ({page}) => {
  await open(page, 'before=v1&after=v3&mode=diff')
  const centred = async () => (await toolbarGeometry(page)).rows[0]!.centred
  let width = 1600
  await setWidth(page, width)
  expect(await centred()).toBe(true)
  while ((await centred()) && width > 320) await setWidth(page, (width -= 4))
  const geometry = await toolbarGeometry(page)
  // It gives up the centre before it would come within 24px of the pickers or the actions: next to the pickers, in
  // its fullest forms.
  expect(geometry.rows[0]!.collapsed).toBe(false)
  expect(geometry.cluster!.clearance).toBeLessThan(24)
  // Growing within the 24px hysteresis keeps it there; past it, it is centred again.
  await setWidth(page, width + 12)
  expect(await centred()).toBe(false)
  await setWidth(page, width + 4 + 24 + 4)
  expect(await centred()).toBe(true)
})

test('choosing Animated keeps the mode switch where it is: playback takes a second row', async ({page}) => {
  for (const width of [1400, 1000]) {
    await open(page, 'before=v1&after=v3&mode=diff')
    await setWidth(page, width)
    const before = await toolbarGeometry(page)
    await page.getByRole('radio', {name: 'Animated'}).click()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await setWidth(page, width)
    const after = await toolbarGeometry(page)
    expect(after.rows.length, `at ${width}px`).toBe(2)
    expect(after.rows[0]!.centred, `at ${width}px`).toBe(before.rows[0]!.centred)
    expect(Math.abs(after.cluster!.left - before.cluster!.left), `at ${width}px`).toBeLessThanOrEqual(0.5)
  }
})

test('with nothing at its start, the mode region is centred in every mode, and returns to the centre as the toolbar widens', async ({
  page,
}) => {
  // A view with no toolbarStart (as the CLI viewer and the Copilot canvas show a comparison): the row's first cell is empty.
  await page.setViewportSize({width: 1400, height: 800})
  await page.goto(story('default-ui-projection-view--comparison'))
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  const placement = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const geometry = await toolbarGeometry(page)
    return {centred: geometry.rows[0]!.centred, offset: Math.abs(geometry.cluster!.offset), rows: geometry.rows.length}
  }
  for (const [mode, rows] of [
    ['Diff', 1],
    ['Animated', 2],
  ] as const) {
    await page.getByRole('radio', {name: mode}).first().click()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.setViewportSize({width: 1400, height: 800})
    expect(await placement(), mode).toEqual({centred: true, offset: expect.any(Number), rows})
    expect((await placement()).offset, mode).toBeLessThanOrEqual(1)
    await page.setViewportSize({width: 700, height: 800})
    expect((await placement()).centred, `${mode} at 700px`).toBe(false)
    await page.setViewportSize({width: 1400, height: 800})
    expect((await placement()).centred, `${mode} back at 1400px`).toBe(true)
  }
})

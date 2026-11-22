import {test as base, expect} from '@playwright/test'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

/**
 * Core/Custom host: a UI on the headless core alone, with plain elements. Its behaviour is the core's (the view model,
 * the Space shortcut, roving choice), so it should act as the default and VS Code UIs do.
 */
test('a custom host on the core alone plays with Space and chooses views with the arrow keys', async ({page, theme}) => {
  await page.goto(
    new URL(`iframe.html?id=core-custom-host--animated&viewMode=story&globals=theme:${theme}`, process.env.PROJECTIONS_STORYBOOK_URL).href,
  )
  const toolbar = page.getByRole('toolbar', {name: 'Custom toolbar'})
  await expect(toolbar.getByRole('button', {name: /^Play (forward|backward)$/u})).toBeVisible()
  await toolbar.focus()
  await page.keyboard.press(' ')
  await expect(toolbar.getByRole('button', {name: 'Pause'})).toBeVisible()
  await page.keyboard.press(' ')
  await expect(toolbar.getByRole('button', {name: /^Play (forward|backward)$/u})).toBeVisible()

  const views = toolbar.getByRole('radiogroup', {name: 'View'})
  await views.getByRole('radio', {checked: true}).press('End')
  await expect(page.getByLabel('Active view')).toHaveText('Built-in text view')
  await expect(views.getByRole('radio', {name: 'Text'})).toBeFocused()
  // Playback is the Animated mode's, beside every view.
  await expect(toolbar.getByRole('slider', {name: 'Transition'})).toBeVisible()
})

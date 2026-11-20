import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {story} from './harness.js'

/**
 * The headless fit plan's interaction lifecycle on a bar of plain controls (the harness's Fit plan story): focus follows
 * a control a new plan remounts or moves into an overflow, and a press is never replanned away before its click.
 */
test.skip(({isMobile}) => isMobile, 'A mouse press and a bar the test sizes; the desktop projects cover Chromium and WebKit.')

/** Sizes the bar and waits until its plan has settled at that width (`data-fit-settled`). */
async function setWidth(page: Page, width: number) {
  await page.evaluate(async barWidth => {
    document.querySelector<HTMLElement>('.fit-sized')!.style.width = `${barWidth}px`
    const bar = document.querySelector<HTMLElement>('[data-plan]')!
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    await frame()
    for (let i = 0; i < 600 && bar.dataset.fitSettled !== String(barWidth); i++) await frame()
  }, width)
}

const bar = (page: Page) => page.getByRole('toolbar', {name: 'Planned bar'})
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-focus-id') ?? null)
/** Marks the control now shown by `name`, so a remount (which drops the mark) shows. */
const mark = (page: Page, name: string) =>
  bar(page)
    .getByRole('button', {name})
    .evaluate(element => element.setAttribute('data-marked', ''))

test('focus follows a control that a new plan remounts, or the overflow it moves into', async ({page}) => {
  await page.goto(story('harness-default-ui--fit-plan'))
  await setWidth(page, 800)
  await expect(bar(page)).toHaveAttribute('data-plan', 'wide')

  // Zoom moves into More on the narrow plan: focus goes to More (`focusFallbacks`), not to the page.
  await bar(page).getByRole('button', {name: 'Zoom'}).focus()
  await setWidth(page, 400)
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')
  await expect.poll(() => focused(page)).toBe('more')

  // Apply is remounted in the wide plan: focus moves to its new form.
  await bar(page).getByRole('button', {name: 'Apply'}).focus()
  await mark(page, 'Apply')
  await setWidth(page, 800)
  await expect(bar(page)).toHaveAttribute('data-plan', 'wide')
  await expect(bar(page).locator('[data-marked]')).toHaveCount(0)
  await expect.poll(() => focused(page)).toBe('apply')
})

test('a press is not replanned away before its click, and the bar replans once it is released', async ({page}) => {
  await page.goto(story('harness-default-ui--fit-plan', 'lock'))
  await setWidth(page, 400)
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')
  // With focus in the bar the plan is kept, though the wide one now fits.
  await bar(page).getByRole('button', {name: 'Apply'}).focus()
  await setWidth(page, 800)
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')

  // As WebKit does, the press moves focus out of the bar, which releases the lock.
  await bar(page).evaluate(element => {
    element.addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur())
    element.addEventListener('mousedown', event => event.preventDefault())
  })
  await mark(page, 'Apply')
  const apply = await bar(page).getByRole('button', {name: 'Apply'}).boundingBox()
  await page.mouse.move(apply!.x + apply!.width / 2, apply!.y + apply!.height / 2)
  await page.mouse.down()
  // Long enough for a replan: none comes while the pointer is pressed.
  await page.evaluate(() => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 50)))
  expect(await focused(page)).toBeNull()
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')
  await expect(bar(page).locator('[data-marked]')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.getByRole('status', {name: 'Clicks'})).toHaveText('1')
  // Released, with focus out of the bar, it plans freely again.
  await expect(bar(page)).toHaveAttribute('data-plan', 'wide')
})

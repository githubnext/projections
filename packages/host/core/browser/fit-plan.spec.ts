import {test, expect, type Page} from '@playwright/test'
import {story} from './harness.js'

/**
 * The headless fit plan's interaction lifecycle on a bar of plain controls (the harness's Fit plan story): focus follows
 * a control a new plan remounts or moves into an overflow, and a press is never replanned away before its click.
 */
test.skip(({isMobile}) => isMobile, 'A mouse press and a bar the test sizes; the desktop projects cover Chromium and WebKit.')

/**
 * Sizes the bar and waits until its plan has settled at that width (`data-fit-settled`). The locator waits for the story
 * to render, which Storybook does after the page loads.
 */
async function setWidth(page: Page, width: number) {
  await page.locator('.fit-sized').evaluate(async (sized: HTMLElement, barWidth) => {
    sized.style.width = `${barWidth}px`
    const bar = sized.querySelector<HTMLElement>('[data-plan]')!
    const frame = () =>
      new Promise(resolve => {
        requestAnimationFrame(resolve)
      })
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

  // Focus moved out of the bar on purpose stays out when a new plan remounts the control it left.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await setWidth(page, 400)
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')
  expect(await focused(page)).toBeNull()
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
  await page.evaluate(
    () =>
      new Promise(resolve => {
        setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve)
          })
        }, 50)
      }),
  )
  expect(await focused(page)).toBeNull()
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')
  await expect(bar(page).locator('[data-marked]')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.getByRole('status', {name: 'Clicks'})).toHaveText('1')
  // Released, with focus out of the bar, it plans freely again.
  await expect(bar(page)).toHaveAttribute('data-plan', 'wide')
})

/** How many times the harness has committed (`data-commits`). */
const commits = (page: Page) => page.locator('main[data-commits]').evaluate(element => Number(element.getAttribute('data-commits')))
/**
 * The commits once the harness is quiet: none for five frames, so a resize observation still on its way (the observer's
 * first notice, a settle) has landed.
 */
const quietCommits = (page: Page) =>
  page.locator('main[data-commits]').evaluate(async element => {
    const read = () => element.getAttribute('data-commits')
    const frame = () =>
      new Promise(resolve => {
        requestAnimationFrame(resolve)
      })
    let last = read()
    for (let still = 0; still < 5;) {
      await frame()
      const now = read()
      still = now === last ? still + 1 : 0
      last = now
    }
    return Number(last)
  })

test('a press and its release never render the bar’s owner again, even when they hold its plan; a new plan does', async ({page}) => {
  // WebKit drops a tap's click when the page renders between its touch and its click.
  await page.goto(story('harness-default-ui--fit-plan', 'lock'))
  await setWidth(page, 800)
  await expect(bar(page)).toHaveAttribute('data-plan', 'wide')
  // A press elsewhere and its release.
  const settled = await quietCommits(page)
  const clicks = await page.getByText('Clicks:').boundingBox()
  await page.mouse.move(clicks!.x + 4, clicks!.y + 4)
  await page.mouse.down()
  await page.mouse.up()
  expect(await quietCommits(page)).toBe(settled)

  // A bar locked by focus in it (the wide plan fits, but the narrow one is kept), pressed as WebKit presses: focus leaves
  // the bar, and the plan is held for the press, without rendering.
  await setWidth(page, 400)
  await bar(page).getByRole('button', {name: 'Apply'}).focus()
  await setWidth(page, 800)
  await expect(bar(page)).toHaveAttribute('data-plan', 'narrow')
  await bar(page).evaluate(element => {
    element.addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur())
    element.addEventListener('mousedown', event => event.preventDefault())
  })
  const held = await quietCommits(page)
  const apply = await bar(page).getByRole('button', {name: 'Apply'}).boundingBox()
  await page.mouse.move(apply!.x + apply!.width / 2, apply!.y + apply!.height / 2)
  await page.mouse.down()
  expect(await quietCommits(page)).toBe(held)
  await page.mouse.up()
  await expect(page.getByRole('status', {name: 'Clicks'})).toHaveText('1')
  // Released, it plans again: the new plan renders.
  await expect(bar(page)).toHaveAttribute('data-plan', 'wide')
  expect(await commits(page)).toBeGreaterThan(held)
})

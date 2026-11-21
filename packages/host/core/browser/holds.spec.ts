import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {closeMenus, explorer, inToolbar, openSettingsSubmenu} from './harness.js'

const view = (page: Page) => page.locator('.ph')
const slider = (page: Page) => page.getByRole('slider', {name: 'Transition'})

/** A comparison with several steps, a short travel time and no loop, from the before revision. */
async function openAtStart(page: Page, holds: 'timeline' | 'pause' = 'timeline') {
  await page.goto(
    explorer(`before=v1&after=v3&loop=false&holds=${holds}&defaults=${encodeURIComponent(JSON.stringify({durationMs: 2000}))}`),
  )
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  // The renderer reports its steps after it connects; the holds sit at their ends.
  await expect(view(page)).not.toHaveAttribute('data-steps', '0')
  await slider(page).focus()
  await page.keyboard.press('Home')
  await expect(view(page)).toHaveAttribute('data-position', '0')
  // Renderers may report other step ends from the start than from the end; they arrive before the frame acknowledges progress 0.
  await expect(view(page)).toHaveAttribute('data-rendered-progress', '0')
}

/** Samples the slider's value and the presentation progress every animation frame until playback reaches the end. */
function sample(input: Locator) {
  return input.evaluate(
    (element: HTMLInputElement) =>
      new Promise<{value: number; progress: number}[]>(resolve => {
        const root = element.closest<HTMLElement>('.ph')!
        const samples: {value: number; progress: number}[] = []
        const start = performance.now()
        const tick = () => {
          samples.push({value: element.valueAsNumber, progress: Number(root.dataset.progress)})
          if (element.valueAsNumber >= 100 || performance.now() - start > 60_000) resolve(samples)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
}

/** Runs of samples showing one progress strictly between the endpoints. */
function plateaus(samples: {value: number; progress: number}[]) {
  const runs: {progress: number; from: number; to: number; count: number}[] = []
  for (const {value, progress} of samples) {
    const last = runs.at(-1)
    if (last?.progress === progress) {
      last.to = value
      last.count++
    } else runs.push({progress, from: value, to: value, count: 1})
  }
  return runs.filter(run => run.progress > 0 && run.progress < 1)
}

test('on the timeline, the slider keeps moving through a hold while the graphics stay still', async ({page}) => {
  test.slow()
  await openAtStart(page)
  await page.getByRole('button', {name: 'Play forward'}).click()
  const samples = await sample(slider(page))
  // The slider never stops or goes back while playing.
  for (let index = 1; index < samples.length; index++) expect(samples[index]!.value).toBeGreaterThanOrEqual(samples[index - 1]!.value)
  // At each step end the progress stays put while the slider moves on through the hold.
  const held = plateaus(samples).filter(run => run.count >= 3 && run.to - run.from >= 5)
  expect(
    held.length,
    `${await view(page).getAttribute('data-steps')} steps, ${samples.length} samples, last ${JSON.stringify(samples.at(-1))}: ${JSON.stringify(plateaus(samples))}`,
  ).toBeGreaterThan(0)
  await expect(view(page)).toHaveAttribute('data-progress', '1')
})

test('scrubbing across a hold changes neither the progress nor what the renderer was sent', async ({page}) => {
  await openAtStart(page)
  // Page Up lands in the middle of the first step's hold.
  await page.keyboard.press('PageUp')
  await expect.poll(async () => Number(await view(page).getAttribute('data-progress'))).toBeGreaterThan(0)
  const progress = await view(page).getAttribute('data-progress')
  const position = Number(await view(page).getAttribute('data-position'))
  expect(Number(progress)).toBeLessThan(1)
  expect(position).not.toBe(Number(progress))
  await expect(view(page)).toHaveAttribute('data-rendered-progress', progress!)
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft']) {
    await page.keyboard.press(key)
    await expect(view(page)).toHaveAttribute('data-progress', progress!)
  }
  expect(Number(await view(page).getAttribute('data-position'))).toBeCloseTo(position - 0.01, 6)
  await expect(view(page)).toHaveAttribute('data-rendered-progress', progress!)
})

test('with holds that pause, the slider stops at each step end and shows the progress', async ({page}) => {
  test.slow()
  await openAtStart(page, 'pause')
  await page.getByRole('button', {name: 'Play forward'}).click()
  const samples = await sample(slider(page))
  // The slider is the progress.
  for (const {value, progress} of samples) expect(Math.abs(value - progress * 100)).toBeLessThan(1e-6)
  // A hold is a run of frames where the slider itself stands still.
  expect(
    plateaus(samples).some(run => run.count >= 5 && run.to === run.from),
    JSON.stringify(plateaus(samples)),
  ).toBe(true)
})

test('Settings switches where playback holds', async ({page}) => {
  await openAtStart(page)
  const holds = (await openSettingsSubmenu(page, 'Playback')).getByRole('group', {name: 'Holds'})
  await expect(holds.getByRole('menuitemradio', {name: 'On the slider'})).toBeChecked()
  await holds.getByRole('menuitemradio', {name: 'Pause playback'}).click()
  await closeMenus(page)
  // With pause holds the slider position is the progress.
  await slider(page).focus()
  await page.keyboard.press('PageUp')
  await expect.poll(async () => Number(await view(page).getAttribute('data-progress'))).toBeGreaterThan(0)
  expect(await view(page).getAttribute('data-position')).toBe(await view(page).getAttribute('data-progress'))
})

test('Next and Previous stop at both ends too: past the last step Next goes to 100%, before the first Previous to 0%', async ({page}) => {
  await openAtStart(page, 'pause')
  const position = async () => Number(await view(page).getAttribute('data-position'))
  const step = (name: 'Next step' | 'Previous step') => inToolbar(page, scope => scope.getByRole('button', {name, exact: true}))
  // At 0 there is nowhere further back.
  await expect(await step('Previous step')).toBeDisabled()
  // Walk the stops with Next: every step, then the after end, where Next is unavailable.
  const stops: number[] = []
  while (!(await (await step('Next step')).isDisabled())) {
    const from = await position()
    await (await step('Next step')).click()
    await expect.poll(position).toBeGreaterThan(from)
    stops.push(await position())
  }
  expect(stops.at(-1)).toBe(1)
  expect(stops.length).toBeGreaterThan(1)
  // Renderers may report other step ends for travel back from the end, so the ends are tested from 99% and 1%,
  // past the last step and before the first (exact positions are unit-tested with \`stepStops\`).
  // Past the last step, Next goes to 100%.
  const past = 99
  await slider(page).fill(String(past))
  await expect.poll(position).toBeCloseTo(past / 100, 6)
  await (await step('Next step')).click()
  await expect.poll(position).toBe(1)
  // Before the first step, Previous goes to 0%.
  const before = 1
  await slider(page).fill(String(before))
  await expect.poll(position).toBeCloseTo(before / 100, 6)
  await (await step('Previous step')).click()
  await expect.poll(position).toBe(0)
})

import {expect, test} from '@playwright/test'
import {compareWithComparator, openRenderer, priorityOrderRules, samples} from '@githubnext/projections-renderer-harness/playwright'
import {comparisonModel, scheduleSteps, ease, motionWindow, stepProgress} from '@githubnext/projections-renderer-kit'
import type {ScheduledStep} from '@githubnext/projections-renderer-kit'
import type {Comparison, Extraction} from '@githubnext/projections-schemas'
import {loadFixture, loadPair} from '../test/fixtures.mjs'
import {checkFrameSequence, checkRenderedFrame, measureRenderedFrame} from '../test/invariants.mjs'

const before = loadFixture('before') as Extraction
const after = loadFixture('after') as Extraction
const review = process.env.PROJECTIONS_REVIEW_DIR
type Measured = ReturnType<typeof measureRenderedFrame>

/** The middle of TypeScript's resize: after the step that removes Ruby (and reads it first), so past 0.5. */
function resizing(comparison: Comparison): number {
  const schedule = scheduleSteps(comparisonModel(before, after, comparison))
  return motionWindow(schedule.find(step => step.entities.includes('language:TypeScript')) as ScheduledStep).time
}

/**
 * An oracle for the painted counts from the comparison's own schedule: each
 * language moves in its step; Ruby empties in the first 30% of its step and
 * Python fills in the last 30% of its.
 */
function oracle(comparison: Comparison) {
  const schedule = scheduleSteps(comparisonModel(before, after, comparison))
  const local = (id: string, progress: number) => stepProgress(schedule.find(step => step.entities.includes(id)) as ScheduledStep, progress)
  const part = (value: number, start: number) => ease((value - start) / 0.3)
  return {
    typescript: (progress: number) => 1000 + 400 * ease(local('language:TypeScript', progress)),
    total: (progress: number) =>
      1000 +
      400 * ease(local('language:TypeScript', progress)) +
      640 -
      120 * ease(local('language:CSS', progress)) +
      400 +
      80 +
      120 * (1 - part(local('language:Ruby', progress), 0)) +
      300 * part(local('language:Python', progress), 0.7),
  }
}
const format = (value: number) => Math.round(value).toLocaleString('en-US')

/** The total the renderer states in the host's summary bar: its count, noun and change. */
async function totalFact(renderer: {state(): Promise<{summary?: readonly unknown[]}>}) {
  const fact = ((await renderer.state()).summary ?? []).find(
    (item): item is {type: 'fact'; id: string; count: number; noun: {plural: string}; added?: number; removed?: number} =>
      (item as {type?: string}).type === 'fact' && (item as {id?: string}).id === 'total',
  )
  return fact && {count: fact.count, noun: fact.noun.plural, change: (fact.added ?? 0) - (fact.removed ?? 0)}
}

test('dense scrubbing in the real host frame keeps every bar frame exact, stable and deterministic', async ({page}, testInfo) => {
  test.setTimeout(120_000)
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 0, locale: 'en-US'})
  expect((await renderer.state()).bundle).toBe('code-statistics')
  // One hold point per comparison step: Ruby leaves, TypeScript and CSS resize, Python arrives.
  await expect.poll(async () => (await renderer.state()).steps.length).toBe(3)
  const {typescript: typescriptAt} = oracle(renderer.subject.mode === 'comparison' ? renderer.subject.comparison : undefined!)
  const measure = () => renderer.frame.locator('body').evaluate(measureRenderedFrame) as Promise<Measured>
  const first = await measure()
  const rowHeight = first.slots.find(slot => slot.id === 'language:Ruby')!.height
  expect(rowHeight).toBeGreaterThan(20)
  const painted = new Map<number, string>()
  const forward: Measured[] = [],
    backward: Measured[] = []
  let frames = 0
  const visit = async (progress: number) => {
    const frame = await measure()
    expect(frame.progress, 'the painted frame is the requested progress').toBe(progress)
    expect(checkRenderedFrame(frame, {rowHeight}), `frame at ${progress}`).toEqual([])
    expect(frame.total, "the bars draw no total: it is the host's summary bar's").toBe('')
    const typescript = frame.slots.find(slot => slot.id === 'language:TypeScript')!
    expect(typescript.value, `TypeScript at ${progress}`).toBe(format(typescriptAt(progress)))
    expect(typescript.width).toBeCloseTo((typescriptAt(progress) / 1400) * 100, 3)
    const previous = painted.get(progress)
    if (previous === undefined) painted.set(progress, frame.html)
    else expect(frame.html, `the same frame in either direction at ${progress}`).toBe(previous)
    if (frames <= 101) forward.push(frame)
    else if (frames <= 202) backward.push(frame)
    if (review && [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1].some(value => Math.abs(value - progress) < 0.005) && frames <= 101) {
      await renderer.iframe.screenshot({
        path: `${review}/stats-${testInfo.project.name}-${String(frames).padStart(3, '0')}-${progress}.png`,
      })
    }
    frames++
  }
  // 101 steps out and back: 203 painted frames, then nonadjacent jumps.
  await renderer.scrub(samples(101, {roundTrip: true}), visit)
  await renderer.scrub([0.75, 0.25, 1, 0.01, 0.5, 0], visit)
  expect(frames).toBe(209)
  expect(checkFrameSequence(forward, {maxStep: rowHeight / 3})).toEqual([])
  expect(checkFrameSequence(backward, {maxStep: rowHeight / 3})).toEqual([])
  // A language enters empty and leaves empty: it never changes its bar while fading.
  const at = (frame: Measured, id: string) => frame.slots.find(slot => slot.id === id)!
  for (const frame of forward) {
    const python = at(frame, 'language:Python'),
      ruby = at(frame, 'language:Ruby')
    if (python.opacity > 0 && python.opacity < 1) expect(python.width).toBe(0)
    if (ruby.opacity > 0 && ruby.opacity < 1) expect(ruby.width).toBe(0)
  }
  expect(at(forward.at(-1)!, 'language:Ruby').height).toBe(0)
  expect(at(forward[0]!, 'language:Python').height).toBe(0)
})

test('painted bars, hatches and counts follow the kit ease through a step, forward and reverse', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 0, locale: 'en-US'})
  await expect.poll(async () => (await renderer.state()).steps.length).toBe(3)
  const comparison = renderer.subject.mode === 'comparison' ? renderer.subject.comparison : undefined!
  const step = scheduleSteps(comparisonModel(before, after, comparison)).find(entry => entry.entities.includes('language:TypeScript'))!
  const typescript = renderer.frame.locator('[data-statistics-id="language:TypeScript"]')
  const painted = () =>
    typescript.evaluate(slot => {
      const width = (selector: string) => slot.querySelector(selector)?.getBoundingClientRect().width ?? 0
      return {
        bar: width('.stat-bar'),
        gain: width('.stat-gain'),
        track: width('.stat-track'),
        count: slot.querySelector('.stat-count')!.textContent,
      }
    })
  const locals = [0.1, 0.25, 0.5, 0.75, 0.9]
  for (const local of [...locals, ...[...locals].reverse()]) {
    await renderer.seek(motionWindow(step).time + motionWindow(step).radius * (2 * local - 1))
    const value = 1000 + 400 * ease(local)
    const frame = await painted()
    expect(frame.count, `count at local ${local}`).toBe(format(value))
    expect(frame.bar / frame.track, `bar at local ${local}`).toBeCloseTo(value / 1400, 3)
    expect(frame.gain / frame.track, `gain at local ${local}`).toBeCloseTo((value - 1000) / 1400, 3)
    // A quarter of the way in, an eased bar has covered about a tenth of its change; linear would be a quarter.
    if (local === 0.25 || local === 0.75) expect(Math.abs(frame.bar / frame.track - (1000 + 400 * local) / 1400)).toBeGreaterThan(0.03)
  }
})

test('the share chart scrubs deterministically and is neutral at both endpoints', async ({page}, testInfo) => {
  test.setTimeout(60_000)
  const renderer = await openRenderer(page, {
    renderer: 'code-statistics',
    before,
    after,
    progress: 0,
    locale: 'en-US',
    options: {chart: 'share'},
  })
  const {total} = oracle(renderer.subject.mode === 'comparison' ? renderer.subject.comparison : undefined!)
  const measure = () => renderer.frame.locator('body').evaluate(measureRenderedFrame) as Promise<Measured>
  const painted = new Map<number, string>()
  await renderer.scrub(samples(50, {roundTrip: true}), async progress => {
    const frame = await measure()
    expect(frame.chart).toBe('share')
    expect(checkRenderedFrame(frame), `share frame at ${progress}`).toEqual([])
    expect(frame.total).toBe(format(total(progress)))
    const previous = painted.get(progress)
    if (previous === undefined) painted.set(progress, frame.html)
    else expect(frame.html, `the same share frame in either direction at ${progress}`).toBe(previous)
    if (review && progress === 0.5) await renderer.iframe.screenshot({path: `${review}/stats-${testInfo.project.name}-share-0.5.png`})
  })
  await renderer.seek(resizing(renderer.subject.mode === 'comparison' ? renderer.subject.comparison : undefined!))
  await expect(renderer.frame.locator('.stat-arc-change').first()).toBeVisible()
  await expect(renderer.frame.getByRole('button', {name: /^TypeScript, 1,200 lines of code, \d+ percent, \+400, Modified$/})).toBeVisible()
})

test('host-drawn controls pivot measure, grouping and chart; the frame draws none of its own', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 1, locale: 'en-US'})
  const frame = renderer.frame
  // The languages count tests, so the Files scope joins once the document is known.
  await expect
    .poll(async () => (await renderer.state()).controls.map(control => control.id))
    .toEqual(['scope', 'measure', 'byLanguage', 'chart'])
  await expect(frame.locator('select, input, [aria-pressed][role="button"]')).toHaveCount(0)
  // The total is the host's summary bar's, worded by the measure and scope; the frame draws no header.
  await expect(frame.locator('.statistics-header, .statistics-summary')).toHaveCount(0)
  await renderer.setOptions({measure: 'comment'})
  await expect.poll(() => totalFact(renderer)).toEqual({count: 353, noun: 'comment lines', change: 38})
  await renderer.setOptions({measure: 'comment', chart: 'share'})
  await expect(frame.getByRole('group', {name: 'Share of comment lines by language'})).toBeVisible()
  await renderer.setOptions({measure: 'comment', chart: 'share', byLanguage: false})
  await expect(frame.getByRole('group', {name: 'Share of lines by line kind'})).toBeVisible()
  await expect(frame.getByText('Every physical line counts once.')).toBeVisible()
  await renderer.setOptions({measure: 'files', chart: 'bars'})
  await expect(frame.getByRole('button', {name: 'Inspect TypeScript, 14 files'})).toBeVisible()
  await renderer.setOptions({scope: 'tests'})
  await expect.poll(() => totalFact(renderer)).toEqual({count: 770, noun: 'lines of code in tests', change: 290})
  await renderer.setOptions({scope: 'other'})
  await expect.poll(() => totalFact(renderer)).toEqual({count: 1930, noun: 'lines of code outside tests', change: 170})
  // Invalid values fall back to the defaults.
  await renderer.setOptions({measure: 'words', chart: 'pie'})
  await expect.poll(() => totalFact(renderer)).toEqual({count: 2700, noun: 'lines of code', change: 460})
})

test('highlighting decorates only mid-transition and never changes values or proportions', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 0, locale: 'en-US'})
  const decoration = renderer.frame.locator('.stat-gain, .stat-loss, .stat-arc-change, .badge, .stat-delta-label, .pk-status-text')
  await expect(decoration).toHaveCount(0)
  // Count, delta and status each keep their own reserved place, so nothing in a row moves as status appears.
  const rows = () =>
    renderer.frame.locator('.stat-row').evaluateAll(items =>
      items.map(row => {
        const box = (selector: string) => {
          const rect = row.querySelector(selector)!.getBoundingClientRect()
          return [rect.x, rect.y, rect.width, rect.height].join()
        }
        return {
          value: row.querySelector('.stat-value')!.firstChild!.textContent,
          proportion: row.querySelector<HTMLElement>('.stat-bar')!.style.width,
          track: box('.stat-track'),
          count: box('.stat-count'),
          status: box('.stat-status'),
          row: box('.stat-hit'),
        }
      }),
    )
  const middle = resizing(renderer.subject.mode === 'comparison' ? renderer.subject.comparison : undefined!)
  await renderer.seek(middle)
  await expect(renderer.frame.locator('.stat-gain').first()).toBeVisible()
  await expect(renderer.frame.getByRole('button', {name: /^Inspect TypeScript, 1,200 lines of code, \+400, Modified$/})).toBeVisible()
  await expect(renderer.frame.locator('[data-entity-id="language:TypeScript"] .stat-status')).toHaveText('Modified')
  const highlighted = await rows()
  await renderer.seek(middle, {highlighting: 'off'})
  await expect(decoration).toHaveCount(0)
  expect(await rows()).toEqual(highlighted)
  await renderer.seek(1)
  await expect(decoration).toHaveCount(0)
})

test('painted rows follow the comparison steps, and a custom comparator order changes them', async ({page}) => {
  const value = (frame: Measured, id: string) => frame.slots.find(slot => slot.id === id)!
  for (const [comparison, first] of [
    [undefined, 'Ruby leaves'],
    [await compareWithComparator(before, after, priorityOrderRules, {priority: ['language:Python']}), 'Python arrives'],
  ] as const) {
    const renderer = await openRenderer(page, {
      renderer: 'code-statistics',
      before,
      after,
      ...(comparison ? {comparison} : {}),
      progress: 0,
      locale: 'en-US',
    })
    const measure = () => renderer.frame.locator('body').evaluate(measureRenderedFrame) as Promise<Measured>
    const [end] = (await renderer.state()).steps as [number]
    await renderer.seek(end)
    const frame = await measure()
    expect(checkRenderedFrame(frame)).toEqual([])
    const ruby = value(frame, 'language:Ruby'),
      python = value(frame, 'language:Python')
    if (first === 'Ruby leaves') expect([ruby.size, python.size], first).toEqual([0, 0])
    else expect([ruby.opacity, python.opacity, python.value], first).toEqual([1, 1, '300'])
    expect(value(frame, 'language:TypeScript').value, 'TypeScript has not resized').toBe('1,000')
    // The step end is inside a hold: nearby progress paints the same frame.
    await renderer.seek(end + 0.01)
    expect((await measure()).html).toBe(frame.html)
  }
})

test('rows select by pointer and keyboard, and the host selection wins', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 1, locale: 'en-US'})
  await renderer.frame.getByRole('button', {name: /^Inspect TypeScript/}).click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('language:TypeScript')
  await renderer.frame.getByRole('button', {name: /^Inspect Go/}).focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('language:Go')
  await renderer.select('language:Python')
  await expect(renderer.frame.getByRole('button', {name: /^Inspect Python/})).toHaveAttribute('aria-pressed', 'true')
  // A departed language's row is out of the tab order.
  await expect(renderer.frame.getByRole('button', {name: /^Inspect Ruby/, includeHidden: true})).toHaveAttribute('tabindex', '-1')
})

test('a single revision fits the frame with no steps and no change decoration', async ({page}, testInfo) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', extraction: after, locale: 'en-US', colorMode: 'dark'})
  expect(await renderer.state()).toMatchObject({rendered: 1, steps: []})
  await expect(renderer.frame.locator('.statistics-view')).toHaveAttribute('data-diff-highlighting', 'false')
  await expect.poll(() => totalFact(renderer)).toEqual({count: 2700, noun: 'lines of code', change: 0})
  await expect(renderer.frame.locator('.stat-gain, .stat-loss, .stat-arc-change, .badge, .stat-delta-label, .pk-status-text')).toHaveCount(
    0,
  )
  expect(await renderer.frame.locator('body').evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
    1,
  )
  if (review) await renderer.iframe.screenshot({path: `${review}/stats-${testInfo.project.name}-single-dark.png`})
})

test('the gateway migration scrubs a dozen languages without jumps, remounts or recolouring', async ({page}, testInfo) => {
  test.setTimeout(60_000)
  const gateway = loadPair('gateway') as {before: Extraction; after: Extraction}
  const renderer = await openRenderer(page, {renderer: 'code-statistics', ...gateway, progress: 0, locale: 'en-US'})
  const measure = () => renderer.frame.locator('body').evaluate(measureRenderedFrame) as Promise<Measured>
  const rowHeight = Math.max(...(await measure()).slots.map(slot => slot.height))
  const forward: Measured[] = []
  await renderer.scrub(samples(80), async progress => {
    const frame = await measure()
    expect(checkRenderedFrame(frame, {rowHeight}), `gateway frame at ${progress}`).toEqual([])
    forward.push(frame)
    if (review && [0, 0.5, 1].includes(progress)) {
      await renderer.iframe.screenshot({path: `${review}/stats-gateway-${testInfo.project.name}-${progress}.png`})
    }
  })
  expect(forward[0]!.slots).toHaveLength(12)
  // Rust and Protobuf arrive in one step, so the rows below them make room for two at once.
  expect(checkFrameSequence(forward, {maxStep: (rowHeight * 2) / 3})).toEqual([])
})

test('each bar stays one continuous shape at 2% steps: gains inside it, losses flush after it, plain at both ends', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 0})
  const shapes = () =>
    renderer.frame.locator('.stat-track').evaluateAll(tracks =>
      tracks.map(track => {
        const rect = (element: Element | null) => (element ? element.getBoundingClientRect() : null)
        const bar = rect(track.querySelector('.stat-bar'))!
        const gain = rect(track.querySelector('.stat-gain'))
        const loss = rect(track.querySelector('.stat-loss'))
        return {
          bar: [bar.left, bar.right, bar.top, bar.bottom],
          gain: gain && [gain.left, gain.right, gain.top, gain.bottom],
          loss: loss && [loss.left, loss.right, loss.top, loss.bottom],
          others: track.querySelectorAll(':scope > :not(.stat-bar, .stat-loss)').length,
        }
      }),
    )
  let sawGain = false
  let sawLoss = false
  await renderer.scrub(samples(50), async progress => {
    for (const shape of await shapes()) {
      const [left, right, top, bottom] = shape.bar
      expect(shape.others, 'nothing but the bar and its lost part on a track').toBe(0)
      if (shape.gain) {
        sawGain = true
        expect(shape.gain[0]).toBeGreaterThanOrEqual(left! - 0.5)
        expect(shape.gain[1]).toBeLessThanOrEqual(right! + 0.5)
        expect([shape.gain[2], shape.gain[3]]).toEqual([top, bottom])
      }
      if (shape.loss) {
        sawLoss = true
        expect(Math.abs(shape.loss[0]! - right!), 'the lost part is flush with the bar').toBeLessThan(0.5)
        expect([shape.loss[2], shape.loss[3]], 'and shares its height and baseline').toEqual([top, bottom])
      }
      if (progress === 0 || progress === 1) expect(shape.gain ?? shape.loss, `plain bars at ${progress}`).toBeNull()
    }
  })
  expect(sawGain && sawLoss, 'gains and losses both show mid-transition').toBe(true)
})

test('the share donut marks change by hatching within slices, never with a separate rim', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'code-statistics', before, after, progress: 0, options: {chart: 'share'}})
  let saw = false
  await renderer.scrub(samples(50), async progress => {
    const changes = await renderer.frame.locator('.stat-arc-change').count()
    if (progress === 0 || progress === 1) expect(changes).toBe(0)
    saw ||= changes > 0
  })
  expect(saw).toBe(true)
  await expect(renderer.frame.locator('.stat-ring')).toHaveCount(0)
})

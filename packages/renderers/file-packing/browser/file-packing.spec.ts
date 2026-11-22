import {expect, test, type FrameLocator} from '@playwright/test'
import {languageColor, languageNamed} from '@githubnext/projections-renderer-sdk/languages'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector, openRenderer, samples} from '@githubnext/projections-renderer-harness/playwright'
import {weightedFiles} from '../../kit/browser/fixtures.js'
import {measureFrame, type FrameMeasurement} from '../../kit/browser/invariants/frame.js'
import {scrubFailures} from '../../kit/browser/invariants/scrub.js'
import {scrubSuite, selectionSuite} from '../../kit/browser/suite.js'

scrubSuite([weightedFiles()])
selectionSuite(weightedFiles(), 'b')

const radius = (frame: FrameLocator, id: string) =>
  frame.locator(`.fp-node[data-entity-id="${id}"] .fp-surface`).evaluate(circle => Number(circle.getAttribute('r')))

test('circle areas follow weights at both endpoints', async ({page}) => {
  const {before, after} = weightedFiles()
  const renderer = await openRenderer(page, {renderer: 'file-packing', before, after, progress: 0})
  expect(((await radius(renderer.frame, 'c')) / (await radius(renderer.frame, 'b'))) ** 2).toBeCloseTo(1.5, 5)
  await renderer.seek(1)
  expect(((await radius(renderer.frame, 'b')) / (await radius(renderer.frame, 'c'))) ** 2).toBeCloseTo(35 / 15, 5)
})

test('names are drawn in the code font, folders included', async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/sample-app', progress: 1})
  const {count, proportional} = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(count).toBeGreaterThan(3)
  expect(proportional).toEqual([])
  const fonts = await renderer.frame.locator('.pk').evaluate(root => ({
    name: getComputedStyle(root.querySelector('.fp-label')!).fontFamily,
    folder: getComputedStyle(root.querySelector('.fp-folder-label')!).fontFamily,
  }))
  expect(fonts.folder).toBe(fonts.name)
})

test('files are colored by type, consistently from before to after, with the legend drawn by the host', async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/sample-app', progress: 0})
  const fill = (id: string) =>
    renderer.frame.locator(`[data-entity-id="${id}"] .fp-surface`).evaluate(circle => getComputedStyle(circle).fill)
  const before = {ts: await fill('file:src/api/client.ts'), css: await fill('file:src/styles/app.css')}
  expect(before.ts).not.toBe(before.css)
  await renderer.seek(1)
  expect(await fill('file:src/api/types.ts')).toBe(before.ts)
  expect(await fill('file:src/search/rank.ts')).toBe(before.ts)
  const {legend} = await renderer.state()
  expect(legend?.title).toBe('Languages and file types, sized by bytes')
  const typescript = languageColor(languageNamed('TypeScript')!, 'light')!
  expect(legend?.items.find(item => item.label === 'TypeScript')).toEqual({label: 'TypeScript', color: typescript, shape: 'circle'})
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(typescript.slice(index, index + 2), 16))
  expect(before.ts).toBe(`rgb(${r}, ${g}, ${b})`)
})

test('hovering a circle shows its path, size and how its size changed', async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/sample-app', progress: 1})
  await renderer.frame.locator('[data-entity-id="file:src/api/client.ts"]').hover()
  const tooltip = renderer.frame.locator('.fp-tooltip')
  await expect(tooltip).toContainText('src/api/client.ts')
  await expect(tooltip).toContainText('4.8 KB')
  await expect(tooltip).toContainText('+2.5 KB (was 2.4 KB)')
  // Another pane's hover shows the same details once the pointer leaves.
  await page.mouse.move(0, 0)
  await renderer.hover('file:src/search/rank.ts')
  await expect(tooltip).toContainText('Added')
})

test('depth and folder controls collapse and hide folders', async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/sample-app', progress: 1})
  const {controls} = await renderer.state()
  expect(controls.map(control => control.id)).toEqual([
    'maxDepth',
    'measure',
    'hideDependencies',
    'hideLockfiles',
    'show.docs',
    'show.public',
    'show.src',
    'show.test',
  ])
  await renderer.setOptions({maxDepth: 1})
  await expect(renderer.frame.locator('[data-entity-id="file:src/main.ts"]')).toHaveCount(0)
  await expect(renderer.frame.locator('.fp-file[data-entity-id="directory:src"]')).toHaveCount(1)
  await renderer.setOptions({'show.src': false, hideLockfiles: true})
  await expect(renderer.frame.locator('[data-entity-id="directory:src"]')).toHaveCount(0)
  await expect(renderer.frame.locator('[data-entity-id="file:package-lock.json"]')).toHaveCount(0)
  await expect(renderer.frame.locator('[data-entity-id="file:README.md"]')).toHaveCount(1)
})

test('the diff keeps removed files where they were and marks every change', async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/sample-app', comparisonMode: 'diff'})
  const removed = renderer.frame.locator('[data-entity-id="file:src/vendor/moment.js"]')
  await expect(removed).toHaveAttribute('aria-label', /Removed/)
  await expect(removed.locator('.fp-emphasis.removed')).toHaveCount(1)
  await expect(renderer.frame.locator('[data-entity-id="file:src/search/rank.ts"] .fp-emphasis.added')).toHaveCount(1)
  await expect(renderer.frame.locator('.fp-labels .pk-status-part.modified').first()).toBeVisible()
})

// The skill's frame review, as a regression: 2% steps through this repository's own tree there and back, every
// painted frame free of partly overlapping circles, with endpoints undecorated.
test('this repository’s tree scrubs without collisions in either direction', async ({page}) => {
  test.setTimeout(240_000)
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/opensource-tree', progress: 0})
  const frames: FrameMeasurement[] = []
  await renderer.scrub(samples(50, {roundTrip: true}), async () => {
    frames.push(await renderer.frame.locator('.pk').evaluate(measureFrame))
  })
  expect(scrubFailures(frames)).toEqual([])
  const ends = frames.filter(frame => frame.progress === 0 || frame.progress === 1)
  expect(ends.every(frame => frame.decorated.length === 0)).toBe(true)
  expect(frames.some(frame => frame.decorated.length > 0)).toBe(true)
})

// Hover must stay as cheap as in other renderers: another pane's hover and the pointer only mark the entity and show
// the tooltip, without recomputing the frame or the labels or redrawing the circles (see the performance marks).
test('hover never recomputes the layout, the labels or the circles', async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/opensource-tree', progress: 1})
  const marks = () =>
    renderer.frame
      .locator('body')
      .evaluate(() =>
        Object.fromEntries(['layout', 'labels', 'draw'].map(name => [name, performance.getEntriesByName(`file-packing:${name}`).length])),
      )
  await renderer.measure('settle')
  const settled = await marks()
  expect(settled.layout).toBeGreaterThan(0)
  const id = 'file:README.md'
  await renderer.hover(id)
  await expect(renderer.frame.locator(`[data-entity-id="${id}"][data-projections-hovered]`)).toHaveCount(1)
  await expect(renderer.frame.locator('.fp-tooltip')).toContainText('README.md')
  await renderer.hover(null)
  await renderer.frame.locator(`[data-entity-id="${id}"]`).hover()
  await expect(renderer.frame.locator('.fp-tooltip')).toContainText('README.md')
  await page.mouse.move(1, 1)
  await expect(renderer.frame.locator('.fp-tooltip')).toHaveCount(0)
  expect(await marks()).toEqual(settled)
})

test("a settings map takes the definition's kind colors and nouns, draws flags and names every group", async ({page}) => {
  const renderer = await openStage(page, harnessInspector(), {scenario: 'file-packing/settings-map', progress: 1})
  const {legend, summary} = await renderer.state()
  expect(legend?.title).toBe('Kinds, with flags as dots, sized by weight')
  expect(legend?.items.find(item => item.label === 'secret')).toEqual({label: 'secret', token: 'chart-11', shape: 'circle'})
  expect(legend?.items.find(item => item.label === 'pre-release')).toEqual({label: 'pre-release', token: 'chart-15', shape: 'circle'})
  const nouns = Object.fromEntries((summary ?? []).flatMap(item => ('kind' in item ? [[item.kind, item.noun.plural]] : [])))
  expect(nouns).toMatchObject({secret: 'secret keys', hidden: 'hidden', 'not-patchable': 'not patchable', 'pre-release': 'pre-releases'})
  // A secret, hidden key carries a hidden dot in the hidden kind's color, and says so.
  const key = renderer.frame.locator('[data-entity-id="setting:providers.atlas.credentialsFile"]')
  await expect(key).toHaveAttribute('aria-label', /flagged hidden/)
  const fill = (selector: string) =>
    renderer.frame
      .locator(selector)
      .first()
      .evaluate(circle => getComputedStyle(circle).fill)
  expect(await fill('[data-entity-id="setting:providers.atlas.credentialsFile"] .fp-flag[data-flag="hidden"]')).toBe(
    await fill('.fp-surface[data-projections-category="hidden"]'),
  )
  // Crowded or long, every group keeps a name: abbreviated, or along the bottom of its outline.
  for (const width of [1000, 640]) {
    await renderer.setWidth(width)
    await renderer.measure('settle')
    const unnamed = await renderer.frame.locator('.fp-folder').evaluateAll(folders =>
      folders
        .filter(folder => Number(folder.querySelector('.fp-surface')?.getAttribute('r')) >= 24)
        .map(folder => folder.getAttribute('data-entity-id'))
        .filter(id => !document.querySelector(`.fp-labels [data-label-for="${CSS.escape(id ?? '')}"] .fp-folder-label`)),
    )
    expect(unnamed, `at ${width} px`).toEqual([])
  }
})

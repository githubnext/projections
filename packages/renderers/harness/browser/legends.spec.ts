import {expect, test} from '@playwright/test'
import {languageColor, languageNamed} from '@githubnext/projections-renderer-sdk/languages'
import {openStage, type StageHandle} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Legends are the host's: renderers draw none in the frame and send one
 * (`legend`) that the host draws once beside every pane. The legend describes
 * the whole comparison, so it is the same at every progress, and its swatches
 * name the tokens the frame paints.
 */
test.beforeEach(({browserName}, info) => {
  test.skip(
    info.project.name !== 'chromium-desktop' && info.project.name !== 'webkit-mobile',
    `Two projects cover the protocol (not ${browserName} ${info.project.name}).`,
  )
})

const legendOf = async (stage: StageHandle) => (await stage.state()).legend

async function settledLegend(stage: StageHandle) {
  await expect.poll(async () => (await legendOf(stage))?.items.length ?? 0).toBeGreaterThan(0)
  return legendOf(stage)
}

const expected = [
  {scenario: 'file-packing/sample-app', title: 'Languages and file types, sized by bytes'},
  // One line of swatches whose meanings need no heading.
  {scenario: 'dependency-injection/scoring', title: undefined},
]

for (const {scenario, title} of expected) {
  test(`${scenario}: the legend is sent to the host, never drawn in the frame, and stays put while scrubbing`, async ({page}) => {
    const stage = await openStage(page, harnessInspector(), {scenario, progress: 0})
    const first = await settledLegend(stage)
    expect(first?.title).toBe(title)
    expect(await stage.measure('legends')).toEqual([])
    for (const progress of [0.5, 1]) {
      await stage.seek(progress)
      await stage.measure('settle')
      expect(await legendOf(stage), `at progress ${progress}`).toEqual(first)
    }
  })
}

test('code statistics keys the share chart with the colours its slices paint, and follows the controls', async ({page}) => {
  const stage = await openStage(page, harnessInspector(), {scenario: 'code-statistics/languages', progress: 1})
  // The bars are labelled inline: no key.
  await stage.measure('settle')
  expect(await legendOf(stage)).toBeUndefined()
  await stage.setOptions({chart: 'share'})
  const legend = await settledLegend(stage)
  expect(legend?.title).toBe('Languages')
  expect(await stage.measure('legends')).toEqual([])
  // Each item's swatch (a language's own colour, or a theme token) is exactly the colour of the slice with that label.
  const swatches = legend!.items.map(item => item.color ?? `var(--projections-${item.token})`)
  const painted = await stage.frame.locator('body').evaluate((body, swatches) => {
    const resolve = (value: string) => {
      const probe = document.createElement('span')
      probe.style.color = value
      body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const slices = [...body.querySelectorAll<HTMLElement>('.statistics-values .stat-slot')].map(slot => {
      const id = slot.dataset.statisticsId!
      const path = body.querySelector(`.stat-arc[data-statistics-id="${CSS.escape(id)}"] path`)
      return {
        label: slot.querySelector('.entity-link, .stat-values-row > span')?.textContent ?? '',
        fill: path ? getComputedStyle(path).fill : null,
      }
    })
    return {
      slices,
      resolve: swatches.map(resolve),
    }
  }, swatches)
  for (const [index, item] of legend!.items.entries()) {
    const slice = painted.slices.find(entry => entry.label === item.label)
    expect(slice, `a slice labelled ${item.label}`).toBeDefined()
    if (slice!.fill) expect(painted.resolve[index], item.label).toBe(slice!.fill)
  }
  // Languages are GitHub Linguist's colours (calibrated to the theme), the same as file packing draws them.
  expect(legend!.items.find(item => item.label === 'TypeScript')).toMatchObject({
    color: languageColor(languageNamed('TypeScript')!, 'light'),
  })
  // The key describes the whole comparison: the same at Before.
  await stage.seek(0)
  await stage.measure('settle')
  expect(await legendOf(stage)).toEqual(legend)
  // Grouping by line kind re-keys it; back to bars clears it.
  await stage.setOptions({chart: 'share', byLanguage: false})
  await expect.poll(async () => (await legendOf(stage))?.title).toBe('Line kinds')
  expect((await legendOf(stage))?.items.map(item => item.label)).toEqual(['Code', 'Comments', 'Blank'])
  await stage.setOptions({chart: 'bars'})
  await expect.poll(() => legendOf(stage)).toBeUndefined()
})

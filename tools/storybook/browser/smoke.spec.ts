import {readFileSync} from 'node:fs'
import {test as base, expect} from '@playwright/test'
import {storybookDirectory} from '../scripts/serve.mjs'

export type Theme = 'light' | 'dark'
const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

interface Entry {
  type: 'story' | 'docs'
  id: string
  title: string
  name: string
  tags?: string[]
}
const index = JSON.parse(readFileSync(`${storybookDirectory}index.json`, 'utf8')) as {entries: Record<string, Entry>}
const stories = Object.values(index.entries).filter(entry => entry.type === 'story')

test('the build indexes the three UIs, the core and the harness', () => {
  const titles = new Set(stories.map(story => story.title.split('/')[0] ?? ''))
  expect([...titles].sort()).toEqual(['Core', 'Default UI', 'Harness', 'VS Code UI'])
  expect(stories.length).toBeGreaterThan(80)
})

for (const story of stories) {
  test(`${story.title} › ${story.name} renders without console errors`, async ({page, theme, browserName}) => {
    // A ladder mounts 7 to 18 explorers, each with its graph renderer frames: many stories' work in one page.
    if (story.tags?.includes('ladder')) test.slow()
    // Linux WebKit on a CI runner takes 10 to 20 s per explorer of a ladder (half a second on a workstation), so a late
    // renderer misses the host's 10 s ready limit. WebKit still runs every mode, and widths down to 390px, as single
    // explorers (VS Code UI/Comparison explorer).
    test.skip(
      Boolean(process.env.CI) && browserName === 'webkit' && Boolean(story.tags?.includes('ladder')),
      'Ladders are too slow for Linux WebKit on CI',
    )
    const errors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    // WebKit reports the spec's benign "ResizeObserver loop" notice (a resize settling over two frames) as a page error,
    // as when a toolbar ladder mounts its views one after another; it is not a failure, and every other error still is.
    page.on('pageerror', error => {
      if (!/^ResizeObserver loop completed with undelivered notifications\.?$/u.test(error.message)) errors.push(error.message)
    })
    await page.goto(new URL(`iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`, process.env.PROJECTIONS_STORYBOOK_URL).href)
    await expect(page.locator('body')).toHaveClass(/sb-show-main/u)
    await expect(page.locator('body')).not.toHaveClass(/sb-show-errordisplay/u)
    await expect(page.locator('#storybook-root')).not.toBeEmpty()
    // A story that mounts its views one after another (the toolbar ladders) has mounted them all.
    await expect(page.locator('[data-story-pending]')).toHaveCount(0, {timeout: 0})
    // Comparisons finish and every renderer frame settles; none fails.
    await expect(page.getByText(/Starting the engine|Computing the comparison/u)).toHaveCount(0)
    // However long that takes within the test's budget: a ladder of views loads 14 renderer frames, which Linux WebKit
    // takes longer than one expectation's timeout to paint.
    await expect(page.locator('.ph[data-renderer-status="loading"]')).toHaveCount(0, {timeout: 0})
    await expect(page.locator('.ph[data-renderer-status="failed"]')).toHaveCount(0)
    await expect(page.locator('.ph-explorer[data-outcome="failed"]')).toHaveCount(0)
    // Late errors, for example from a renderer's first paint.
    await page.waitForTimeout(250)
    expect(errors).toEqual([])
  })
}

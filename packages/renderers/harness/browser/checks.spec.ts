import {devices, expect, test} from '@playwright/test'
import {checkScenario, type CheckId} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/**
 * Known failures of the built-in checks, each with its cause. A listed check
 * must still fail, so fixing the renderer means removing its entry here.
 */
const knownIssues: Record<string, Partial<Record<CheckId, string>>> = {
  'database/prisma-licensing': {
    'neutral-endpoints':
      'Every stage shares one card width, from the ranks of all of them: the arriving Refund table adds a rank, so at Before the cards are narrower than Before alone draws them and User.currentLicenseId wraps.',
  },
}

/**
 * The Inspector's built-in checks (neutral endpoints, still holds, per-step
 * highlighting scope, affordances, a host-drawn legend, no overflow at phone width,
 * the selection round trip, and colors, type and spacing from the theme) for every
 * built-in renderer scenario. They size their own frames, so each scenario's run
 * is once, in desktop Chromium. They are the suite's longest tests, so the runs
 * are spread over the first three projects, which CI shards separately, so that
 * no one project's jobs take them all.
 */
test.use({...devices['Desktop Chrome']})
const projects = ['chromium-desktop', 'webkit-desktop', 'chromium-mobile']

for (const [index, {key}] of scenarios.entries()) {
  test(`${key}: built-in renderer checks pass`, async ({page}, info) => {
    test.skip(info.project.name !== projects[index % projects.length], 'Each scenario runs the checks once, in desktop Chromium.')
    test.slow()
    const known = knownIssues[key] ?? {}
    const results = await checkScenario(page, harnessInspector(), key)
    const failures = results.filter(result => result.status === 'fail')
    expect(
      failures.filter(result => !known[result.id]).flatMap(result => result.details.map(detail => `${result.title}: ${detail}`)),
    ).toEqual([])
    expect(
      Object.keys(known).filter(id => !failures.some(result => result.id === id)),
      'known issues that no longer fail; remove them',
    ).toEqual([])
  })
}

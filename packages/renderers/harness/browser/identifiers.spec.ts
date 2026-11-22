import {expect, test, type Page, type TestInfo} from '@playwright/test'
import {defaultComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import {openStage, type IdentifierMeasurement} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/** Packages whose scenarios name no code identifiers to draw (code statistics shows languages and line kinds). */
const without = new Set(['code-statistics'])

function onlyFontProjects(info: TestInfo) {
  test.skip(
    info.project.name !== 'chromium-desktop' && info.project.name !== 'webkit-mobile',
    'One desktop and one phone project cover the fonts.',
  )
}

/** A scenario's identifiers in the renderer's default comparison mode. */
async function identifiers(page: Page, key: string) {
  let stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1})
  if (stage.subject.mode === 'comparison' && defaultComparisonMode((await stage.state()).capabilities?.comparisonModes ?? []) === 'diff') {
    stage = await openStage(page, harnessInspector(), {scenario: key, comparisonMode: 'diff'})
  }
  await stage.measure('settle')
  return stage.measure<IdentifierMeasurement>('identifiers')
}

/**
 * Code identifiers and symbols (names, paths, routes, event names, IDs) are
 * drawn in the theme's monospace font, and human-language labels in sans.
 * Every built-in renderer marks its identifiers (`data-projections-identifier`)
 * in at least one of its scenarios, and every marked element computes a
 * monospace font, in the renderer's default comparison mode. One test per
 * scenario: a renderer's scenarios together outlast a test's timeout on Linux WebKit.
 */
for (const directory of [...new Set(scenarios.map(item => item.directory))].filter(name => !without.has(name))) {
  const keys = scenarios.filter(item => item.directory === directory).map(item => item.key)
  test(`${directory}: identifiers are marked`, async ({page}, info) => {
    onlyFontProjects(info)
    let count = 0
    for (const key of keys) {
      count += (await identifiers(page, key)).count
      if (count > 0) break
    }
    expect(count, `${directory} marks identifiers with data-projections-identifier`).toBeGreaterThan(0)
  })
  for (const key of keys) {
    test(`${key}: identifiers are monospace`, async ({page}, info) => {
      onlyFontProjects(info)
      expect((await identifiers(page, key)).proportional, key).toEqual([])
    })
  }
}

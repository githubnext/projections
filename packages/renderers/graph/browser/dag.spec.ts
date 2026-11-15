import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {pipeline} from '../../kit/browser/fixtures.js'
import {scrubSuite, selectionSuite} from '../../kit/browser/suite.js'
import {paneStatusSuite, statusSuite} from '../../kit/browser/status.js'

scrubSuite([pipeline()])
selectionSuite(pipeline(), 'package')
statusSuite(pipeline())
paneStatusSuite(pipeline())

test('job names are monospace identifiers and kinds stay sans; no caption above the canvas', async ({page}) => {
  const {before, after} = pipeline()
  const renderer = await openRenderer(page, {renderer: 'dag', before, after, progress: 1})
  const measured = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(measured.count).toBe(after.entities.length)
  expect(measured.proportional).toEqual([])
  await expect(renderer.frame.locator('.node-label:not([data-projections-identifier])')).toHaveCount(0)
  await expect(renderer.frame.locator('.node-kind[data-projections-identifier]')).toHaveCount(0)
  await expect(renderer.frame.locator('.domain-caption')).toHaveCount(0)
})

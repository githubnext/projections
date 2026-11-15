import {resolve} from 'node:path'
import {defineConfig, devices} from '@playwright/test'

// Outside this repository, put the `projections` CLI on PATH (or set PROJECTIONS_CLI) instead.
process.env.PROJECTIONS_CLI ??= resolve(import.meta.dirname, '../../../packages/cli/dist/projections')

export default defineConfig({
  testDir: './browser',
  expect: {timeout: 10_000},
  use: {screenshot: 'only-on-failure'},
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
})

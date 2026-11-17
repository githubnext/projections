import {resolve} from 'node:path'
import {defineConfig, devices} from '@playwright/test'

// The browser checks use this checkout's build (npm run build) unless PROJECTIONS_CLI names another.
process.env.PROJECTIONS_CLI ??= resolve(import.meta.dirname, `dist/projections${process.platform === 'win32' ? '.exe' : ''}`)

export default defineConfig({
  testDir: './browser',
  expect: {timeout: 10_000},
  use: {screenshot: 'only-on-failure'},
  // The checks cover phone widths themselves; one project keeps the one-time
  // renderer install and build per run.
  timeout: 60_000,
  workers: 1,
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
})

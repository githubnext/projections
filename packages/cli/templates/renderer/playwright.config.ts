import {defineConfig, devices} from '@playwright/test'

// `npm test` runs the renderer checks with the `projections` CLI on PATH (or
// PROJECTIONS_CLI). Install the browser once: npx playwright install chromium
export default defineConfig({
  testDir: './browser',
  timeout: 120_000,
  use: {screenshot: 'only-on-failure'},
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
})

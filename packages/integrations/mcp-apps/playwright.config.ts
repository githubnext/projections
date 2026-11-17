import {resolve} from 'node:path'
import {defineConfig, devices} from '@playwright/test'

// The checks host this checkout's build of the page in a minimal MCP Apps host, with this checkout's CLI
// (npm run build) unless PROJECTIONS_CLI names another.
process.env.PROJECTIONS_CLI ??= resolve(import.meta.dirname, `../../cli/dist/projections${process.platform === 'win32' ? '.exe' : ''}`)

export default defineConfig({
  testDir: './browser',
  // One CLI and repository per file, shared by its tests.
  workers: 1,
  // Linux WebKit on CI runners is several times slower than a workstation: tests get more time there.
  timeout: process.env.CI ? 180_000 : 90_000,
  expect: {timeout: process.env.CI ? 45_000 : 20_000},
  // Traces only in CI: on macOS each traced WebKit run leaks about 2 GB of IOSurfaces into the kernel until reboot.
  // Locally, pass `--trace on` to one Chromium run when you need a trace.
  use: {screenshot: 'only-on-failure', trace: process.env.CI ? 'retain-on-failure' : 'off'},
  outputDir: './test-results',
  projects: [
    {name: 'chromium-desktop', use: {...devices['Desktop Chrome']}},
    {name: 'webkit-desktop', use: {...devices['Desktop Safari']}},
  ],
})

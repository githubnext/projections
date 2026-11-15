import {defineConfig, devices} from '@playwright/test'
export default defineConfig({
  testDir: './browser',
  fullyParallel: true,
  // CI runners have few cores; locally two workers keep memory in check beside a running editor.
  workers: process.env.CI ? '100%' : 2,
  globalSetup: './browser/setup.ts',
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: {timeout: process.env.CI ? 15_000 : 5_000},
  // Traces only in CI: on macOS each traced WebKit run leaks about 2 GB of IOSurfaces into the kernel until reboot.
  // Locally, pass `--trace on` to one Chromium run when you need a trace.
  use: {screenshot: 'only-on-failure', trace: process.env.CI ? 'retain-on-failure' : 'off'},
  // VS Code's webviews are desktop Chromium; WebKit checks the UI stays portable. Narrow widths are the toolbar specs' own.
  projects: [
    {name: 'chromium-desktop', use: {...devices['Desktop Chrome']}},
    {name: 'webkit-desktop', use: {...devices['Desktop Safari']}},
  ],
})

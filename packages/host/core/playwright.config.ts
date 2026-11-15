import {defineConfig, devices} from '@playwright/test'
export default defineConfig({
  testDir: './browser',
  fullyParallel: true,
  // CI runners have few cores (two for private repositories); more workers than cores starve Linux WebKit.
  workers: process.env.CI ? '100%' : 4,
  globalSetup: './browser/setup.ts',
  // Linux WebKit on CI runners is several times slower than a workstation: tests and expectations get more time there.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: {timeout: process.env.CI ? 15_000 : 5_000},
  // Traces only in CI: on macOS each traced WebKit run leaks about 2 GB of IOSurfaces into the kernel until reboot.
  // Locally, pass `--trace on` to one Chromium run when you need a trace.
  use: {screenshot: 'only-on-failure', trace: process.env.CI ? 'retain-on-failure' : 'off'},
  projects: [
    {name: 'chromium-desktop', use: {...devices['Desktop Chrome']}},
    {name: 'webkit-desktop', use: {...devices['Desktop Safari']}},
    {name: 'chromium-mobile', use: {...devices['Pixel 7']}},
    {name: 'webkit-mobile', use: {...devices['iPhone 13']}},
  ],
})

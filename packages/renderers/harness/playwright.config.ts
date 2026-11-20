import {defineConfig, devices} from '@playwright/test'

/**
 * Runs every renderer package's browser suite: `packages/renderers/<package>/browser/*.spec.ts`.
 * Filter by path, for example `npm run test:browser -w @githubnext/projections-renderer-harness -- database/`.
 */
export default defineConfig({
  testDir: '..',
  testMatch: /[\\/]browser[\\/][^\\/]+\.spec\.ts$/,
  testIgnore: /[\\/]node_modules[\\/]/,
  fullyParallel: true,
  // CI runners have few cores (two for private repositories); more workers than cores starve Linux WebKit.
  workers: process.env.CI ? '100%' : 4,
  globalSetup: './playwright/setup.ts',
  // Linux WebKit on CI runners is several times slower than a workstation, and these tests loop over every scenario of
  // a renderer (a graph scenario takes up to 13 s to load there): they get four times the time there.
  timeout: process.env.CI ? 120_000 : 30_000,
  expect: {timeout: process.env.CI ? 30_000 : 10_000},
  // Traces only in CI, and not on macOS: there tracing WebKit holds each context's IOSurfaces in wired memory (on a
  // 7 GB macos-latest runner, about 30 surfaces and 70 MB a context, 1.7 GB more over 20 contexts), which nothing can
  // compress or swap, so workers' WebKit processes die mid-test ("Target page, context or browser has been closed") or
  // stop answering. Locally (macOS too), pass `--trace on` to one Chromium run when you need a trace.
  use: {screenshot: 'only-on-failure', trace: process.env.CI && process.platform !== 'darwin' ? 'retain-on-failure' : 'off'},
  outputDir: './test-results',
  projects: [
    {name: 'chromium-desktop', use: {...devices['Desktop Chrome']}},
    {name: 'webkit-desktop', use: {...devices['Desktop Safari']}},
    {name: 'chromium-mobile', use: {...devices['Pixel 7']}},
    {name: 'webkit-mobile', use: {...devices['iPhone 13']}},
  ],
})

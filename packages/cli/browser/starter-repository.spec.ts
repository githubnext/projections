import {expect, test} from '@playwright/test'
import {execFileSync, spawn} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInterface} from 'node:readline'
import {startHarness} from '../../host/inspector/browser/harness.js'
import {repository} from './starter.js'

const cli = process.env.PROJECTIONS_CLI!
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Starter', '-c', 'user.email=starter@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repository,
  })

// The repository Inspector offers a custom renderer package's scenarios.json
// in its Explorer, beside the Before → After pair, made extraction documents
// with the working tree's definition and drawn by the projection's own renderer.
test('the repository Inspector presents the renderer package scenarios beside the Before → After pair', async ({page, context}) => {
  test.slow()
  git('add', '-A')
  git('commit', '--quiet', '--allow-empty', '-m', 'Start')
  // The Inspector's mountable bundle over this CLI's `serve --stdio`, as the VS Code extension hosts it in a trusted
  // workspace: the package's renderer is repository code.
  const harness = await startHarness(context, ['-C', repository, '--trust'])
  try {
    await page.goto(harness.url)
    // The Explorer's Compare section lists them as "Renderer scenarios", beside the Before → After pair.
    const scenarios = page.getByRole('list', {name: 'Renderer scenarios'})
    await expect(scenarios.getByRole('button')).toHaveCount(2)
    await expect(scenarios.getByRole('button', {name: /^Checkout splits out payments/})).toHaveAttribute('aria-pressed', 'false')
    await scenarios.getByRole('button', {name: /^Checkout splits out payments/}).click()
    await expect(scenarios.getByRole('button', {name: /^Checkout splits out payments/})).toHaveAttribute('aria-pressed', 'true')
    // Its pair, compared in the browser and drawn by the package's renderer; no extractor ran.
    await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
    const frame = page.frameLocator('iframe').first()
    await expect(frame.locator('[data-entity-id="service:payments"]')).toBeAttached()
    await expect(page.locator('.pi-titlebar').getByRole('status')).toHaveAttribute('data-activity', 'scenario')

    await scenarios.getByRole('button', {name: /^One revision/}).click()
    await expect(page.locator('.ph[data-mode="extraction"]')).toBeVisible()

    // Back to the Before → After pair.
    await page
      .getByRole('region', {name: 'Compare'})
      .getByRole('button', {name: /^Back to /})
      .click()
    await expect(scenarios.getByRole('button', {name: /^One revision/})).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.pi-titlebar').getByRole('status')).not.toHaveAttribute('data-activity', 'scenario')
  } finally {
    await harness.close()
  }
})

// `projections view --scenario` (the canvas's `scenario`, `open_projection {scenario}`) opens on the scenario: the page
// waits for the runner's definitions and the package's scenarios before it shows it, rather than the pair.
test('the viewer opens on a renderer package scenario', async ({page}) => {
  test.slow()
  git('add', '-A')
  git('commit', '--quiet', '--allow-empty', '-m', 'View')
  const cache = mkdtempSync(join(tmpdir(), 'projections-viewer-cache-'))
  const viewer = spawn(cli, ['view', '--trust', '-p', 'service-map', '--scenario', 'split'], {
    cwd: repository,
    env: {...process.env, PROJECTIONS_CACHE_DIR: cache},
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      viewer.once('exit', code => reject(new Error(`projections view exited with ${code}`)))
      createInterface({input: viewer.stdout!}).once('line', resolve)
    })
    const shown = async () => {
      const response = await fetch(new URL('control/state', url))
      return ((await response.json()) as {page?: {summary?: {scenario?: string; source?: string}}}).page?.summary
    }
    await page.goto(url)
    await expect.poll(shown, {timeout: 30_000}).toMatchObject({scenario: 'split', source: 'artifact'})
    await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
    await expect(page.frameLocator('iframe').first().locator('[data-entity-id="service:payments"]')).toBeAttached()

    // The agent shows the other scenario.
    const show = (body: unknown) =>
      fetch(new URL('control/show', url), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
    expect((await show({projection: 'service-map', scenario: 'single'})).status).toBe(200)
    await expect.poll(shown, {timeout: 15_000}).toMatchObject({scenario: 'single', source: 'artifact'})
    await expect(page.locator('.ph[data-mode="extraction"]')).toBeVisible()
  } finally {
    viewer.kill()
    rmSync(cache, {recursive: true, force: true})
  }
})

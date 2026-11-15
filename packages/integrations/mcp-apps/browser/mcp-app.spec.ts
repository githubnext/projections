// The viewer as an MCP App, hosted as Claude hosts one (harness.ts): `projections mcp` serves the view and links
// `open_projection` to it; the view, in an opaque-origin sandbox with no network, starts the shared engine and the
// renderers from itself and reaches the viewer only through the server; it shows what the agent opens in the host's
// theme, reports what the person sees, asks for full screen from its header, and can't reach the viewer's controls.
import {test, expect} from '@playwright/test'
import type {FrameLocator, Page} from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {hostVariables, serveHost, startMcp} from './harness.js'
import type {McpServer} from './harness.js'

const cli = process.env.PROJECTIONS_CLI!
let repository: string
let cache: string
let server: McpServer
let host: Awaited<ReturnType<typeof serveHost>>
let html: string

const write = (path: string, value: unknown) => {
  mkdirSync(join(repository, path, '..'), {recursive: true})
  writeFileSync(join(repository, path), typeof value === 'string' ? value : JSON.stringify(value))
}
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=App', '-c', 'user.email=app@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repository,
    stdio: 'pipe',
  })

test.beforeAll(async () => {
  repository = mkdtempSync(join(tmpdir(), 'projections-mcp-app-'))
  cache = mkdtempSync(join(tmpdir(), 'projections-mcp-app-cache-'))
  write('package.json', {name: 'root', private: true, workspaces: ['packages/*']})
  write('packages/a/package.json', {name: 'a', version: '1.0.0'})
  write('packages/b/package.json', {name: 'b', version: '1.0.0'})
  write('.github/projections/packages.json', {
    id: 'packages',
    title: 'Package map',
    extractor: 'workspace-dependencies',
    renderer: 'dependencies',
  })
  git('init', '-q', '--initial-branch=main')
  git('add', '.')
  git('commit', '-qm', 'Add the package map')
  write('packages/b/package.json', {name: 'b', version: '1.0.0', dependencies: {a: 'workspace:*'}})
  git('commit', '-qam', 'b uses a')
  server = await startMcp(cli, repository, {PROJECTIONS_CACHE_DIR: cache})
  const read = await server.call('resources/read', {uri: 'ui://projections/viewer'})
  html = read.result.contents[0].text
  host = await serveHost()
})

test.afterAll(async () => {
  server?.child.kill()
  await host?.close()
  rmSync(repository, {recursive: true, force: true})
  rmSync(cache, {recursive: true, force: true})
})

/** A tool's result as the agent reads it. */
async function tool(name: string, args: Record<string, unknown> = {}) {
  const answer = await server.call('tools/call', {name, arguments: args})
  expect(answer.error, JSON.stringify(answer.error)).toBeUndefined()
  return answer.result as {content: {text: string}[]; structuredContent: any; isError: boolean}
}

/** Opens the host with `context`, loads the view, and calls `open_projection` with `args` as the agent would. */
async function open(page: Page, context: Record<string, unknown>, args: Record<string, unknown>): Promise<FrameLocator> {
  await page.exposeFunction('mcpCall', (method: string, params: unknown) => server.call(method, params))
  await page.goto(host.url)
  await page.evaluate(([source, initial]) => (window as any).host.start(source, initial), [html, context] as const)
  await expect.poll(() => page.evaluate(() => (window as any).host.initialized)).toBe(true)
  await page.evaluate(params => (window as any).host.notify('ui/notifications/tool-input', {arguments: params}), args)
  const result = await tool('open_projection', args)
  expect(result.isError).toBe(false)
  await page.evaluate(value => (window as any).host.notify('ui/notifications/tool-result', value), result)
  return page.frameLocator('#view').frameLocator('iframe')
}

const context = (theme: 'light' | 'dark') => ({
  theme,
  displayMode: 'inline',
  availableDisplayModes: ['inline', 'fullscreen'],
  styles: {variables: hostVariables},
})

for (const theme of ['light', 'dark'] as const) {
  test(`the view shows what the agent opens, in the host's ${theme} theme`, async ({page}, testInfo) => {
    const view = await open(page, context(theme), {projection: 'packages', choice: 'last-commit'})
    await expect(view.locator('.pi-viewer-header')).toContainText('Package map')
    await expect(view.locator('.pi-viewer-compared')).toHaveText('Last commit')
    // The renderer runs in its own sandboxed Blob frame, inside the view's.
    const frame = view.locator('iframe.ph-frame').first()
    await expect(frame).toHaveAttribute('data-revealed', 'true')
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(await frame.getAttribute('src')).toMatch(/^blob:/)
    // The chrome lies on the host's own surface.
    const background = theme === 'dark' ? 'rgb(38, 38, 36)' : 'rgb(250, 249, 245)'
    await expect(view.locator('.pi-viewer-header')).toHaveCSS('background-color', background)
    // The view is a page of the viewer: the agent reads what it shows.
    await expect.poll(async () => (await tool('current_view')).structuredContent?.page?.status, {timeout: 60_000}).toBe('ok')
    // It asked for an inline height, and the host shows the expand control's request only from a click.
    const sized = await page.evaluate(() => (window as any).host.messages.filter((m: any) => m.method === 'ui/notifications/size-changed'))
    expect(sized.at(-1).params.height).toBeGreaterThanOrEqual(320)
    await page.screenshot({path: testInfo.outputPath(`inline-${theme}.png`)})
  })
}

test('the agent drives the view and hears what the person selects', async ({page}) => {
  const view = await open(page, context('light'), {projection: 'packages', choice: 'last-commit', mode: 'side-by-side'})
  const modes = view.locator('.ph-toolbar').getByRole('radiogroup', {name: 'Comparison mode'}).first()
  await expect(modes.getByRole('radio', {name: 'Side by side', exact: true})).toBeChecked()
  await modes.getByRole('radio', {name: 'Swipe', exact: true}).click()
  await expect.poll(async () => (await tool('current_view')).structuredContent?.mode, {timeout: 20_000}).toBe('swipe')
})

test('the header asks the host to show the view beside the conversation, and the view fills it', async ({page}, testInfo) => {
  const view = await open(page, context('dark'), {projection: 'packages', choice: 'last-commit'})
  const expand = view.getByRole('button', {name: 'Show beside the conversation'})
  await expand.click()
  await expect.poll(() => page.evaluate(() => (window as any).host.context.displayMode)).toBe('fullscreen')
  await expect(expand).toHaveCount(0)
  const size = page.viewportSize()!
  await expect.poll(() => view.locator('html').evaluate(root => root.getBoundingClientRect().height)).toBe(size.height)
  await expect(view.locator('iframe.ph-frame').first()).toHaveAttribute('data-revealed', 'true')
  await page.screenshot({path: testInfo.outputPath('fullscreen-dark.png')})
})

test("the view can't reach the viewer's controls, and never sees its token", async ({page}) => {
  await open(page, context('light'), {projection: 'packages', choice: 'last-commit'})
  const relay = (args: Record<string, unknown>) => server.call('tools/call', {name: 'viewer_request', arguments: args})
  expect((await relay({method: 'POST', path: '/control/show', body: {projection: 'packages'}})).error?.code).toBe(-32602)
  expect((await relay({method: 'GET', path: '/control/state'})).error?.code).toBe(-32602)
  const renderers = await relay({method: 'GET', path: '/api/renderers'})
  const answer = JSON.parse(renderers.result.content[0].text)
  expect(answer.status).toBe(200)
  const opened = (await tool('current_view')).content[0]!.text
  const token = /127\.0\.0\.1:\d+\/([0-9a-f]+)\//.exec(opened)?.[1]
  expect(token).toBeTruthy()
  expect(JSON.stringify(answer)).not.toContain(token)
})

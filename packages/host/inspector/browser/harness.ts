import type {BrowserContext, Route} from '@playwright/test'
import {execFileSync, spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, realpath, rm, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {extname, join} from 'node:path'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'

/**
 * The browser suite's host: a page at a reserved origin that mounts the Inspector's built bundle (`dist/client`,
 * `mount.js`) with a same-origin fetch transport, as the CLI's headless pages do. Nothing listens: Playwright answers
 * every request to the origin (`context.route`): the page and its script from here, the bundle's files from
 * `dist/client`, and `/api/`, `/renderers/` and `/custom-renderers/` from a real `projections serve --stdio` backend
 * over JSON-RPC, serving the same build's renderer bundles.
 */
export interface Harness {
  /** The page, with a placeholder fragment so callers can insert a query before it. */
  url: string
  close(): Promise<void>
}

const client = fileURLToPath(new URL('../dist/client', import.meta.url))
/** This checkout's CLI, unless `PROJECTIONS_CLI` names another. */
export const cli = () => process.env.PROJECTIONS_CLI ?? fileURLToPath(new URL('../../../cli/dist/projections', import.meta.url))
const policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'"
/** The renderer content security policy (`RENDERER_CSP` in packages/cli/src/service/assets/mod.rs), which stdio results don't carry. */
const rendererPolicy =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
const page =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Projections Inspector</title><link rel="stylesheet" href="/mount.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>'
const script = `import {InspectorRequestError, mountInspector, requestErrorMessage} from '/mount.js'
const transport = {
  origin: location.origin,
  async request({method, path, body, signal, responseType}) {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      ...(signal ? {signal} : {}),
      ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}),
    })
    if (!response.ok)
      throw new InspectorRequestError(requestErrorMessage(response.status, await response.text()), response.status)
    return responseType === 'blob' ? response.blob() : response.json()
  },
}
const query = new URLSearchParams(location.search)
// A host showing results with the committed definition (the VS Code extension's tabs) passes definitionRevision=HEAD.
const definitionRevision = query.get('definitionRevision')
mountInspector(document.getElementById('root'), {transport, view: query.get('view'), search: location.search, ...(definitionRevision ? {definitionRevision} : {})})
`
const types: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}
let instances = 0

/** Starts a backend (`serve --stdio` with `args`, for example `['-C', repo, '--trust']`) and routes a page origin to it. */
export async function startHarness(context: BrowserContext, args: string[]): Promise<Harness> {
  if (!existsSync(join(client, 'mount.js')))
    throw new Error('Build the Inspector first: npm run build -w @githubnext/projections-inspector')
  const tools = await mkdtemp(join(tmpdir(), 'projections-browser-tools-'))
  await symlink(await realpath(execFileSync('which', ['git'], {encoding: 'utf8'}).trim()), join(tools, 'git'))
  const child = spawn(cli(), ['serve', '--stdio', ...args], {
    // The backend serves this build's renderer bundles (with the fixtures probe), not the ones it embeds.
    env: {PATH: tools, LANG: 'C.UTF-8', PROJECTIONS_INSPECTOR_ASSETS: client},
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stderr.on('data', bytes => (diagnostics += String(bytes)))
  child.stdin.on('error', () => {})
  const exited = new Promise<void>(done => child.once('exit', () => done()))
  const pending = new Map<
    number,
    (message: {result?: {status: number; contentType: string; body: unknown}; error?: {message: string}}) => void
  >()
  const lines = createInterface({input: child.stdout})
  lines.on('line', line => {
    const message = JSON.parse(line)
    if (typeof message.id !== 'number') return
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  let next = 1
  const send = (message: object) => child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
  const call = (method: string, params?: unknown) => {
    const id = next++
    const reply = new Promise<{result?: {status: number; contentType: string; body: unknown}; error?: {message: string}}>(done =>
      pending.set(id, done),
    )
    send({id, method, ...(params === undefined ? {} : {params})})
    return {id, reply}
  }
  const started = await Promise.race([call('initialize').reply, exited.then(() => undefined)])
  if (!started?.result) throw new Error(`The backend did not start: ${diagnostics}`)

  const origin = `https://harness-${++instances}.projections.test`
  const handler = async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = `${url.pathname}${url.search}`
    if (url.pathname === '/' || url.pathname === '/index.html')
      return route.fulfill({status: 200, headers: {'content-type': types['.html']!, 'content-security-policy': policy}, body: page})
    if (url.pathname === '/harness.js') return route.fulfill({status: 200, headers: {'content-type': types['.js']!}, body: script})
    if (!/^\/(api|renderers|custom-renderers)\//.test(url.pathname)) {
      const file = join(client, ...url.pathname.split('/').filter(part => part && part !== '..'))
      if (!file.startsWith(client) || !existsSync(file)) return route.fulfill({status: 404, body: 'Not found'})
      return route.fulfill({
        status: 200,
        headers: {'content-type': types[extname(file)] ?? 'application/octet-stream'},
        body: await readFile(file),
      })
    }
    const body = request.postData()
    let parsed: unknown
    try {
      parsed = body ? JSON.parse(body) : undefined
    } catch {
      return route.fulfill({status: 400, body: 'Invalid JSON request'})
    }
    const {reply} = call('request', {method: request.method(), path, ...(parsed === undefined ? {} : {body: parsed})})
    const message = await reply
    if (!message.result) return route.fulfill({status: 502, body: message.error?.message ?? 'The backend failed'}).catch(() => {})
    const {status, contentType, body: answer} = message.result
    const base64 = (answer as {base64?: unknown} | null)?.base64
    const bytes =
      typeof base64 === 'string'
        ? Buffer.from(base64, 'base64')
        : Buffer.from(typeof answer === 'string' ? answer : answer === null ? '' : JSON.stringify(answer))
    // Renderer bundles keep the renderer policy the backend sends with them over HTTP-like hosts.
    const headers: Record<string, string> = {'content-type': contentType || 'application/octet-stream'}
    if (!url.pathname.startsWith('/api/')) headers['content-security-policy'] = rendererPolicy
    await route.fulfill({status, headers, body: bytes}).catch(() => {})
  }
  await context.route(`${origin}/**`, handler)
  // The page frames a renderer's development server on loopback, as the VS Code extension's webview may. Chromium's
  // local network access checks block that from a page they consider public, as this reserved origin is, unless granted.
  if (context.browser()?.browserType().name() === 'chromium') await context.grantPermissions(['local-network-access'], {origin})
  return {
    url: `${origin}/#harness`,
    async close() {
      await context.unroute(`${origin}/**`, handler).catch(() => {})
      child.stdin.end()
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(timer)
      lines.close()
      await rm(tools, {recursive: true, force: true})
    },
  }
}

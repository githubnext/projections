/*
 * The fixtures workbench for renderer development and tests: `projections serve --stdio --fixtures` (which has no
 * listener) behind a loopback page in this process. The page mounts the Inspector from the CLI's own assets, so the UI
 * always matches the CLI, and relays its runner requests to the backend over JSON-RPC. It imports nothing from
 * Playwright, so the `projections-renderer-workbench` command can use it.
 */
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import type {IncomingMessage, ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {resolve} from 'node:path'
import {createInterface} from 'node:readline'

/** The options of `startInspector`: the scenarios and bundles to serve, and how to run the `projections` CLI. */
export interface InspectorOptions {
  /** `scenarios.json` files, or directories that hold one. */
  fixtures: string | readonly string[]
  /** Renderer bundle directories (`index.html` and `renderer.json`), or packages whose `package.json` names one. */
  renderers?: string | readonly string[]
  /** The `projections` executable: `PROJECTIONS_CLI`, or `projections` on `PATH`, by default. */
  cli?: string
  /** Loopback port of the page; an ephemeral one by default. */
  port?: number
  /** Directory relative paths resolve from; the current directory by default. */
  cwd?: string
  /** Environment of the backend process; this process's by default. */
  env?: NodeJS.ProcessEnv
}

/** A running fixtures workbench: `projections serve --stdio --fixtures` behind a loopback page. */
export interface FixturesInspector {
  /** The workbench URL. */
  url: string
  /** The URL of a page: `?view=stage`, or `?scenario=<key>` for the workbench. */
  page: (query?: Record<string, string>) => string
  close: () => Promise<void>
}

interface RequestResult {
  status: number
  contentType: string
  headers?: Record<string, string>
  body: unknown
}

/** The page's policy: its own scripts, styles and Workers, and renderer frames from itself or a development server. */
const pageCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'"
const page =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Projections renderer workbench</title><link rel="stylesheet" href="/inspector/mount.css"></head><body><div id="root"></div><script type="module" src="/__projections/workbench.js"></script></body></html>'
// Mounts the Inspector with a same-origin fetch transport (this server relays it) and the CLI's assets.
const script = `import {InspectorRequestError, loadRendererCatalog, mountInspector, webAssets, requestErrorMessage} from '/inspector/mount.js'
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
const assets = {
  ...webAssets(new URL('/inspector/', location.origin)),
  async renderers() {
    try {
      return await loadRendererCatalog({base: new URL('/renderers/', location.origin)})
    } catch {
      return []
    }
  },
}
mountInspector(document.getElementById('root'), {transport, assets, view: new URLSearchParams(location.search).get('view'), search: location.search})
`
const relayed = ['/api/', '/renderers/', '/custom-renderers/', '/inspector/']
/**
 * The check probe a renderer development server's document loads from its host page's origin (see `devProbeScript` in
 * the SDK's Vite plugin), from the CLI's Inspector assets.
 */
const probe = {path: '/fixtures/probe.js', asset: '/inspector/fixtures/probe.js'}
const maxBody = 1024 * 1024

const list = (value: string | readonly string[] | undefined) =>
  value === undefined ? [] : typeof value === 'string' ? [value] : [...value]

/** A JSON-RPC client of `projections serve --stdio` (see the runner documentation's Stdio backend). */
function backend(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe']})
  let diagnostic = ''
  child.stderr.on('data', bytes => {
    diagnostic = (diagnostic + String(bytes)).slice(-8192)
  })
  const pending = new Map<number, {done: (value: unknown) => void; fail: (error: Error) => void}>()
  let next = 0
  let ended: Error | undefined
  const exited = new Promise<void>(done => child.once('close', () => done()))
  const end = (error: Error) => {
    ended ??= error
    for (const call of pending.values()) call.fail(ended)
    pending.clear()
  }
  child.once('error', error => end(new Error(`Could not run ${command}: ${error.message}. Pass cli or set PROJECTIONS_CLI.`)))
  void exited.then(() => end(new Error(`The Projections backend exited: ${diagnostic.trim()}`)))
  child.stdin.on('error', () => {})
  const lines = createInterface({input: child.stdout, crlfDelay: Infinity})
  lines.on('line', line => {
    let message: {id?: number; result?: unknown; error?: {message: string}}
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      return
    }
    const call = typeof message.id === 'number' ? pending.get(message.id) : undefined
    if (!call) return
    pending.delete(message.id!)
    if (message.error) call.fail(new Error(message.error.message))
    else call.done(message.result)
  })
  const write = (message: object) => {
    if (!ended) child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
  }
  return {
    call<T>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> {
      if (ended) return Promise.reject(ended)
      const id = ++next
      return new Promise<T>((done, fail) => {
        pending.set(id, {done: value => done(value as T), fail})
        write({id, method, ...(params === undefined ? {} : {params})})
        signal?.addEventListener('abort', () => {
          if (pending.delete(id)) {
            write({method: '$/cancelRequest', params: {id}})
            fail(new Error('Cancelled'))
          }
        })
      })
    },
    get diagnostic() {
      return diagnostic
    },
    async close() {
      lines.close()
      if (child.exitCode !== null || child.signalCode !== null) return
      child.stdin.end()
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
    },
    kill() {
      child.kill('SIGKILL')
      return exited
    },
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > maxBody) throw new Error('Request body too large')
    chunks.push(chunk)
  }
  return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers})
  response.end(body)
}

/** The bytes of a relayed result: JSON as text, text as it is, `{base64}` as bytes, anything else as JSON. */
function payload({contentType, body}: RequestResult): string | Buffer {
  if (body === null || body === undefined) return ''
  if (/^application\/(?:[\w.-]+\+)?json\b/iu.test(contentType)) return JSON.stringify(body)
  if (typeof body === 'string') return body
  const {base64} = body as {base64?: unknown}
  return typeof base64 === 'string' ? Buffer.from(base64, 'base64') : JSON.stringify(body)
}

/** Starts the fixtures workbench and resolves with its URL. */
export async function startInspector(options: InspectorOptions): Promise<FixturesInspector> {
  const cwd = options.cwd ?? process.cwd()
  const fixtures = list(options.fixtures).map(path => resolve(cwd, path))
  if (!fixtures.length) throw new Error('startInspector needs at least one scenarios file')
  const renderers = list(options.renderers).map(path => resolve(cwd, path))
  const command = options.cli ?? process.env.PROJECTIONS_CLI ?? 'projections'
  const args = ['serve', '--stdio', '--fixtures', ...fixtures, ...(renderers.length ? ['--renderer', ...renderers] : [])]
  const runner = backend(command, args, cwd, options.env ?? process.env)
  try {
    const info = await new Promise<{mode?: string}>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`The Projections backend didn't start within 20 seconds: ${runner.diagnostic}`)),
        20_000,
      )
      runner.call<{mode?: string}>('initialize').then(
        value => {
          clearTimeout(timer)
          done(value)
        },
        (error: Error) => {
          clearTimeout(timer)
          fail(error)
        },
      )
    })
    if (info.mode !== 'fixtures') throw new Error(`The Projections backend isn't in fixtures mode; update the projections CLI`)
  } catch (error) {
    await runner.kill()
    throw error
  }

  let hosts = new Set<string>()
  const server = createServer((request, response) => {
    void (async () => {
      // Only this address: a page on another site that rebinds a name to loopback can't reach the backend.
      if (!hosts.has(request.headers.host ?? '')) return send(response, 403, 'text/plain', 'Forbidden')
      const path = (request.url ?? '/').split('?')[0]!
      const url = request.method === 'GET' && path === probe.path ? probe.asset : (request.url ?? '/')
      if (request.method === 'GET' && path === '/') {
        return send(response, 200, 'text/html; charset=utf-8', page, {'content-security-policy': pageCsp})
      }
      if (request.method === 'GET' && path === '/__projections/workbench.js') {
        return send(response, 200, 'text/javascript; charset=utf-8', script, {'content-security-policy': pageCsp})
      }
      if ((request.method !== 'GET' && request.method !== 'POST') || !relayed.some(prefix => url.startsWith(prefix))) {
        return send(response, 404, 'text/plain', 'Not found')
      }
      const aborted = new AbortController()
      response.on('close', () => {
        if (!response.writableFinished) aborted.abort()
      })
      try {
        const body = request.method === 'POST' ? await readBody(request) : undefined
        const result = await runner.call<RequestResult>(
          'request',
          {method: request.method, path: url, ...(body === undefined ? {} : {body})},
          aborted.signal,
        )
        send(response, result.status, result.contentType || 'application/octet-stream', payload(result), result.headers)
      } catch (error) {
        // The message only: the backend's errors and a bad body say what went wrong, and a stack says nothing more.
        if (!aborted.signal.aborted) send(response, 502, 'text/plain', error instanceof Error ? error.message : 'The request failed')
      }
    })()
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(options.port ?? 0, '127.0.0.1', () => done())
  })
  const {port} = server.address() as AddressInfo
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const origin = `http://127.0.0.1:${port}`
  return {
    url: `${origin}/`,
    page: (query = {}) => `${origin}/${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>(done => server.close(() => done()))
      await runner.close()
    },
  }
}

/** A handle on a workbench someone else started, from its URL. */
export function connectInspector(url: string): FixturesInspector {
  const origin = new URL(url).origin
  return {
    url,
    page: (query = {}) => `${origin}/${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`,
    close: async () => {},
  }
}

// A minimal MCP Apps host for the browser checks, shaped like Claude's: the host page frames a sandbox proxy on another
// origin, served with the policy Claude's proxy is served with, and the proxy loads the view as an opaque-origin
// `srcdoc` document (`sandbox="allow-scripts allow-forms"`), which inherits that policy, and relays messages both ways.
// The host speaks the MCP Apps protocol (SEP-1865) to the view and relays its tool calls to a real `projections mcp`.
import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import {createServer} from 'node:http'
import type {Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {createInterface} from 'node:readline'

/**
 * The policy Claude serves its MCP Apps sandbox proxy with (`https://<id>.claudemcpcontent.com/mcp_apps`, as served in
 * November 2026), less its own origins: Wasm (`'unsafe-eval'`), Blob Workers and Blob or data frames, and no network
 * beyond its own origin.
 */
export const claudeSandboxPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob: data:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  'frame-src blob: data:',
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')

/** A host's standardized style variables, theme-aware with `light-dark()`, as hosts pass them in the host context. */
export const hostVariables = {
  '--color-background-primary': 'light-dark(#faf9f5, #262624)',
  '--color-background-secondary': 'light-dark(#f5f4ed, #30302e)',
  '--color-text-primary': 'light-dark(#141413, #faf9f5)',
  '--color-text-secondary': 'light-dark(#5e5d59, #c2c0b6)',
  '--color-border-primary': 'light-dark(rgba(31, 30, 29, 0.15), rgba(222, 220, 209, 0.15))',
  '--color-ring-primary': 'light-dark(#2c84db, #5aa2e8)',
  '--color-text-info': 'light-dark(#2c84db, #5aa2e8)',
  '--font-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  '--font-mono': 'ui-monospace, Menlo, monospace',
}

/** The sandbox proxy: one opaque-origin `srcdoc` view, and every message relayed between it and the host. */
const proxy = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><script>
const inner = document.createElement('iframe')
inner.setAttribute('sandbox', 'allow-scripts allow-forms')
document.body.append(inner)
let ready = false
let queued = []
addEventListener('message', event => {
  if (event.source === parent) {
    if (event.data && event.data.method === 'ui/notifications/sandbox-resource-ready') inner.srcdoc = event.data.params.html
    else if (ready) inner.contentWindow.postMessage(event.data, '*')
    else queued.push(event.data)
  } else if (event.source === inner.contentWindow && event.origin === 'null') {
    if (!ready) {
      ready = true
      for (const message of queued) inner.contentWindow.postMessage(message, '*')
      queued = []
    }
    parent.postMessage(event.data, '*')
  }
})
parent.postMessage({jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {}}, '*')
</script></body></html>`

/**
 * The host page: frames the proxy, answers the view's requests (`ui/initialize` with the host context, `tools/call`
 * relayed to the server through `mcpCall`, display modes, links) and records what it sent.
 */
const hostPage = (sandbox: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#888}
#view{display:block;border:0;width:860px;height:600px;margin:24px}
body.fullscreen #view{position:fixed;inset:0;width:100vw;height:100vh;margin:0}
</style></head><body><script>
let frame
const host = (window.host = {messages: [], context: {}, html: undefined, initialized: false, appModes: undefined})
// Frames the proxy, which asks for the view once it is ready.
host.start = (html, context) => {
  host.html = html
  host.context = context
  frame = document.createElement('iframe')
  frame.id = 'view'
  frame.src = ${JSON.stringify(sandbox)}
  document.body.append(frame)
}
const post = message => frame.contentWindow.postMessage({jsonrpc: '2.0', ...message}, '*')
host.notify = (method, params) => post({method, params})
host.setContext = changes => {
  Object.assign(host.context, changes)
  if (host.initialized) post({method: 'ui/notifications/host-context-changed', params: changes})
}
const dimensions = () =>
  host.context.displayMode === 'fullscreen' ? {width: innerWidth, height: innerHeight} : {width: frame.clientWidth, maxHeight: 700}
async function handle(message) {
  switch (message.method) {
    case 'ui/initialize':
      host.appModes = message.params.appCapabilities && message.params.appCapabilities.availableDisplayModes
      return {
        protocolVersion: '2026-01-26',
        hostInfo: {name: 'projections-test-host', version: '1'},
        hostCapabilities: {openLinks: {}, serverTools: {}, logging: {}},
        hostContext: {...host.context, containerDimensions: dimensions()},
      }
    case 'tools/call': {
      const answer = await window.mcpCall('tools/call', message.params)
      if (answer.error) throw Object.assign(new Error(answer.error.message), {code: answer.error.code})
      return answer.result
    }
    case 'ui/request-display-mode': {
      const mode = message.params.mode
      if (!host.context.availableDisplayModes.includes(mode) || !(host.appModes || []).includes(mode)) return {mode: host.context.displayMode}
      document.body.classList.toggle('fullscreen', mode === 'fullscreen')
      // Full screen fills the window, whatever height the view chose inline.
      if (mode === 'fullscreen') frame.style.height = ''
      host.setContext({displayMode: mode})
      host.setContext({containerDimensions: dimensions()})
      return {mode}
    }
    case 'ui/open-link':
      return {}
    case 'ping':
      return {}
    default:
      throw Object.assign(new Error('Method not found'), {code: -32601})
  }
}
addEventListener('message', async event => {
  if (!frame || event.source !== frame.contentWindow) return
  const message = event.data
  if (!message || message.jsonrpc !== '2.0') return
  if (message.method === 'ui/notifications/sandbox-proxy-ready') {
    post({method: 'ui/notifications/sandbox-resource-ready', params: {html: host.html}})
    return
  }
  host.messages.push(message)
  if (message.method === 'ui/notifications/initialized') host.initialized = true
  if (message.method === 'ui/notifications/size-changed' && host.context.displayMode !== 'fullscreen' && message.params.height)
    frame.style.height = message.params.height + 'px'
  if (message.method && message.id !== undefined) {
    try {
      post({id: message.id, result: await handle(message)})
    } catch (error) {
      post({id: message.id, error: {code: error.code || -32000, message: error.message}})
    }
  }
})
</script></body></html>`

/** The host's two origins: its page, and the sandbox proxy on another origin (`localhost` rather than `127.0.0.1`). */
export async function serveHost(): Promise<{url: string; close(): Promise<void>}> {
  const listen = (server: Server) =>
    new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
  const sandbox = createServer((request, response) => {
    if (request.url !== '/mcp_apps') return void response.writeHead(404).end()
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': claudeSandboxPolicy,
      'cache-control': 'no-store',
    })
    response.end(proxy)
  })
  const sandboxPort = await listen(sandbox)
  const page = createServer((request, response) => {
    if (request.url !== '/') return void response.writeHead(404).end()
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'})
    response.end(hostPage(`http://localhost:${sandboxPort}/mcp_apps`))
  })
  const pagePort = await listen(page)
  return {
    url: `http://127.0.0.1:${pagePort}/`,
    close: async () => {
      await Promise.all([sandbox, page].map(server => new Promise(resolve => server.close(resolve))))
    },
  }
}

export interface McpServer {
  child: ChildProcess
  call(method: string, params?: unknown): Promise<{result?: any; error?: {code: number; message: string}}>
  stderr(): string
}

/** `projections mcp` in `cwd`, initialized as an MCP Apps host initializes it. */
export async function startMcp(cli: string, cwd: string, env: NodeJS.ProcessEnv): Promise<McpServer> {
  const child = spawn(cli, ['mcp', '--trust'], {cwd, env: {...process.env, ...env}, stdio: ['pipe', 'pipe', 'pipe']})
  let stderr = ''
  child.stderr!.on('data', bytes => (stderr += String(bytes)))
  const pending = new Map<number, (message: any) => void>()
  createInterface({input: child.stdout!}).on('line', line => {
    const message = JSON.parse(line)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  let nextId = 1
  const call = (method: string, params?: unknown) => {
    const id = nextId++
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No reply to ${method}\n${stderr}`)), 150_000)
      pending.set(id, message => (clearTimeout(timer), resolve(message)))
      child.stdin!.write(`${JSON.stringify({jsonrpc: '2.0', id, method, ...(params === undefined ? {} : {params})})}\n`)
    })
  }
  const initialized = await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {extensions: {'io.modelcontextprotocol/ui': {mimeTypes: ['text/html;profile=mcp-app']}}},
    clientInfo: {name: 'projections-test-host', version: '1'},
  })
  if (!initialized.result?.capabilities?.resources)
    throw new Error(`projections mcp offered no view: ${JSON.stringify(initialized)}\n${stderr}`)
  child.stdin!.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`)
  return {child, call, stderr: () => stderr}
}

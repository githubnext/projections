// The MCP Apps protocol from the view's side (SEP-1865, `io.modelcontextprotocol/ui`): JSON-RPC 2.0 over postMessage
// with the host, which shows this page in a sandboxed frame. The view initializes (`ui/initialize`, then
// `ui/notifications/initialized`), calls its server's tools through the host (`tools/call`), asks for a display mode
// (`ui/request-display-mode`), reports its size (`ui/notifications/size-changed`), and follows the host's context
// (`ui/notifications/host-context-changed`): its theme, style variables, display mode and container size.

/** The protocol version the view speaks. */
export const protocolVersion = '2026-01-26'

export type DisplayMode = 'inline' | 'fullscreen' | 'pip'

/** What the host says about where and how it shows the view. Hosts may send any subset. */
export interface HostContext {
  theme?: 'light' | 'dark'
  styles?: {variables?: Record<string, string | undefined>; css?: {fonts?: string}}
  displayMode?: DisplayMode
  availableDisplayModes?: string[]
  containerDimensions?: {width?: number; maxWidth?: number; height?: number; maxHeight?: number}
  safeAreaInsets?: {top: number; right: number; bottom: number; left: number}
  [key: string]: unknown
}

/** A tool's result (MCP's `CallToolResult`). */
export interface ToolResult {
  content?: {type: string; text?: string}[]
  structuredContent?: unknown
  isError?: boolean
}

/** A request the host refused or didn't answer, with its JSON-RPC error code. */
export class HostError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'HostError'
  }
}

export interface RequestOptions {
  signal?: AbortSignal | undefined
  /** How long to wait for the answer; default two minutes. */
  timeoutMs?: number
}

/** The host, once the view has initialized with it. */
export interface Host {
  readonly info: {name?: string; version?: string} | undefined
  readonly capabilities: Record<string, unknown>
  /** The host context, with every change merged in. */
  context(): HostContext
  /** Hears each change of the host context; returns a function that stops listening. */
  onContext(listener: (context: HostContext) => void): () => void
  /** Hears the host's notice that it is about to tear the view down. */
  onTeardown(listener: () => void): () => void
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>
  notify(method: string, params?: unknown): void
  callTool(name: string, args: Record<string, unknown>, options?: RequestOptions): Promise<ToolResult>
}

interface Message {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
  result?: unknown
  error?: {code?: unknown; message?: unknown}
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** The channel to the host: requests and their answers, the host's own requests, and its context. */
function channel(target: Window) {
  let nextId = 1
  const pending = new Map<number, Pending>()
  const state = {context: {} as HostContext}
  const contextListeners = new Set<(context: HostContext) => void>()
  const teardownListeners = new Set<() => void>()
  const post = (message: object) => target.postMessage({jsonrpc: '2.0', ...message}, '*')

  /** Answers the host's own requests: `ping`, and the teardown notice; nothing else. */
  function answer(message: Message) {
    if (message.method === 'ping') post({id: message.id, result: {}})
    else if (message.method === 'ui/resource-teardown') {
      for (const listener of [...teardownListeners]) listener()
      post({id: message.id, result: {}})
    } else post({id: message.id, error: {code: -32601, message: 'Method not found'}})
  }

  function receive(message: Message) {
    const id = message.id
    if (typeof message.method === 'string') {
      if (typeof id === 'number' || typeof id === 'string') answer(message)
      else if (message.method === 'ui/notifications/host-context-changed' && typeof message.params === 'object' && message.params) {
        state.context = {...state.context, ...(message.params as HostContext)}
        for (const listener of [...contextListeners]) listener(state.context)
      }
      return
    }
    const request = typeof id === 'number' ? pending.get(id) : undefined
    if (!request) return
    pending.delete(id as number)
    if (message.error) request.reject(new HostError(String(message.error.message ?? 'The host refused'), Number(message.error.code ?? 0)))
    else request.resolve(message.result)
  }

  addEventListener('message', event => {
    if (event.source !== target) return
    const message = event.data as Message
    if (typeof message === 'object' && message !== null && message.jsonrpc === '2.0') receive(message)
  })

  function request<T>(method: string, params?: unknown, {signal, timeoutMs = 120_000}: RequestOptions = {}): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        pending.delete(id)
      }
      const abort = () => {
        settle()
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      const timer = setTimeout(() => {
        settle()
        reject(new HostError(`The host didn't answer ${method}`, -32001))
      }, timeoutMs)
      signal?.addEventListener('abort', abort, {once: true})
      pending.set(id, {
        resolve: value => {
          settle()
          resolve(value as T)
        },
        reject: error => {
          settle()
          reject(error)
        },
      })
      post({id, method, ...(params === undefined ? {} : {params})})
    })
  }

  return {state, contextListeners, teardownListeners, post, request}
}

/**
 * Connects to the host the page is framed by: initializes with `appInfo` and `appCapabilities`, and resolves once the
 * host has answered and been told the view is initialized. Messages are accepted only from that window.
 */
export async function connect(
  appInfo: {name: string; version: string},
  appCapabilities: Record<string, unknown>,
  {target = window.parent, timeoutMs = 30_000}: {target?: Window; timeoutMs?: number} = {},
): Promise<Host> {
  const {state, contextListeners, teardownListeners, post, request} = channel(target)
  const initialized = await request<{hostInfo?: Host['info']; hostCapabilities?: Record<string, unknown>; hostContext?: HostContext}>(
    'ui/initialize',
    {protocolVersion, appInfo, appCapabilities},
    {timeoutMs},
  )
  state.context = {...(initialized?.hostContext ?? {}), ...state.context}
  post({method: 'ui/notifications/initialized', params: {}})
  return {
    info: initialized?.hostInfo,
    capabilities: initialized?.hostCapabilities ?? {},
    context: () => state.context,
    onContext(listener) {
      contextListeners.add(listener)
      return () => contextListeners.delete(listener)
    },
    onTeardown(listener) {
      teardownListeners.add(listener)
      return () => teardownListeners.delete(listener)
    },
    request,
    notify: (method, params) => post({method, ...(params === undefined ? {} : {params})}),
    callTool: (name, args, options) => request<ToolResult>('tools/call', {name, arguments: args}, options),
  }
}

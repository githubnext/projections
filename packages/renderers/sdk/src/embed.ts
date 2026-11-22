// Running a built-in renderer in a frame nested in this renderer's document, as its host.
import {parseRendererMessage, rendererFragment, rendererLimits, rendererProtocolVersion, rendererSandbox} from './protocol.js'
import type {
  ColorMode,
  HostMessage,
  InitPayload,
  ProgressPayload,
  RendererCapabilities,
  RendererEnvironment,
  RendererMessage,
  RendererOptions,
} from './protocol.js'
import type {RendererClient} from './client.js'

/** What `embedRenderer` runs and how it reports back. */
export interface EmbedOptions {
  /** The built-in renderer to run, by name, for example `graph`. */
  renderer: string
  /** The frame's accessible name, for example `Service platform, drawn by the graph renderer`. */
  title: string
  /**
   * What the nested renderer presents, and its environment; `sizing` defaults to `fill`, the frame's own size. A
   * function is called with the renderer's capabilities once it is ready, to choose for them (diff or animated).
   */
  init: InitPayload | ((capabilities: RendererCapabilities) => InitPayload)
  /** The position to draw, or a function of the capabilities; omitted, its opening state (an extraction, or a diff). */
  progress?: ProgressPayload | ((capabilities: RendererCapabilities) => ProgressPayload | undefined)
  /** The color mode its document paints before `init`, so its first paint matches; default `init`'s, else light. */
  colorMode?: ColorMode
  /** Its settings, as `options` would carry them. */
  options?: RendererOptions
  /**
   * Each valid message the nested renderer sends, after `embedRenderer` has handled it (`ready`, `rendered`, `height`
   * and nested `document-request`s are handled; a host can follow `select`, `hover`, `error` and the rest).
   */
  onMessage?: (message: RendererMessage) => void
  /** Called once when the frame can't run: the host refused its document, or it never became ready. */
  onFailure?: (message: string) => void
}

/** A nested renderer frame, from `embedRenderer`: what to send it, and how to stop it. */
export interface EmbeddedRenderer {
  /** The sandboxed frame, transparent until the nested renderer has painted. */
  readonly iframe: HTMLIFrameElement
  /** Resolves with the nested renderer's capabilities once it is ready; rejects when it fails. */
  readonly ready: Promise<RendererCapabilities>
  /** Replaces what it presents (a new `init`), and optionally the position. */
  setInit: (init: InitPayload, progress?: ProgressPayload) => void
  /** Sends a new position to draw. */
  setProgress: (progress: ProgressPayload) => void
  /** Selects an item, by the nested renderer's own selection ID, or clears the selection (`null`). */
  select: (id: string | null) => void
  /** Sent only when the nested renderer declares `hover`. */
  hover: (id: string | null) => void
  /** Sends a new theme, motion preference, locale or pane; `sizing` stays `fill` unless it says otherwise. */
  setEnvironment: (environment: RendererEnvironment) => void
  /** Replaces its settings. */
  setOptions: (options: RendererOptions) => void
  /** Stops listening and removes the frame. */
  dispose: () => void
}

function randomToken(view: Window): string {
  const bytes = view.crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The document with its URL fragment set first thing, before its own scripts: a `srcdoc` frame has no URL of its own
 * to carry the channel, so it sets the fragment from inside, as a host's frame URL would have it. A host whose policy
 * admits scripts by nonce (an editor webview) supplies documents whose scripts carry it, and this one carries it too.
 *
 * @internal
 */
export function withFragment(html: string, fragment: string): string {
  // Only ASCII is folded, so indices stay those of `html`.
  const lower = html.replace(/[A-Z]/gu, letter => letter.toLowerCase())
  let nonce: string | undefined
  for (let tag = openingTag(lower, 'script', 0); tag && !nonce; tag = openingTag(lower, 'script', tag.end)) {
    nonce = /\snonce="([\w+/=-]+)"/u.exec(html.slice(tag.start, tag.end))?.[1]
  }
  const script = `<script${nonce ? ` nonce="${nonce}"` : ''}>location.hash=${JSON.stringify(fragment).replace(/</gu, '\\u003c')}</script>`
  const head = openingTag(lower, 'head', 0)
  if (head) return `${html.slice(0, head.end)}${script}${html.slice(head.end)}`
  return `${script}${html}`
}

// Scans with indexOf rather than a regular expression, so a document of many unclosed `<head`s stays linear.
function openingTag(lower: string, name: string, from: number): {start: number; end: number} | undefined {
  for (let start = lower.indexOf(`<${name}`, from); start >= 0; start = lower.indexOf(`<${name}`, start + 1)) {
    const next = lower[start + name.length + 1]
    if (next !== '>' && next !== '/' && !/\s/u.test(next ?? '')) continue
    const close = lower.indexOf('>', start)
    return close < 0 ? undefined : {start, end: close + 1}
  }
  return undefined
}

/**
 * Runs the built-in renderer `options.renderer` in a sandboxed frame appended to `container`, acting as its host. The
 * document comes from this renderer's host (`client.requestDocument`), which supplies only built-in renderers; the
 * frame is `<iframe sandbox="allow-scripts" srcdoc>`, so it inherits this document's content security policy and gets
 * an opaque origin of its own. Messages are accepted only from that frame, on its own channel, and only if they
 * validate strictly. The frame fills `container` and stays transparent until its renderer has painted.
 *
 * @example
 * ```ts
 * const nested = embedRenderer(client, card, {
 *   renderer: 'graph',
 *   title: 'Service platform',
 *   init: {mode: 'extraction', extraction, projection: {id: 'platform', title: 'Service platform', renderer: 'graph'}, ...environment},
 *   onMessage: message => message.type === 'select' && client.select(message.id && `platform/${message.id}`),
 * })
 * ```
 */
export function embedRenderer(
  client: Pick<RendererClient, 'requestDocument'>,
  container: HTMLElement,
  options: EmbedOptions,
): EmbeddedRenderer {
  const view = container.ownerDocument.defaultView ?? window
  const channel = randomToken(view)
  const iframe = container.ownerDocument.createElement('iframe')
  iframe.setAttribute('sandbox', rendererSandbox)
  iframe.setAttribute('allow', '')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('aria-label', options.title)
  iframe.dataset.embeddedRenderer = options.renderer
  Object.assign(iframe.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    border: '0',
    background: 'transparent',
    colorScheme: 'light dark',
    opacity: '0',
  })
  const initial = options.init
  let init: InitPayload | undefined = typeof initial === 'function' ? undefined : {sizing: 'fill', ...initial}
  let progress = typeof options.progress === 'function' ? undefined : options.progress
  let settings = options.options
  let selection: string | null = null
  let capabilities: RendererCapabilities | undefined
  let disposed = false
  let failed = false
  let readiness!: {resolve: (capabilities: RendererCapabilities) => void; reject: (error: Error) => void}
  const ready = new Promise<RendererCapabilities>((resolve, reject) => {
    readiness = {resolve, reject}
  })
  // Nobody need observe a failure for it to be handled.
  ready.catch(() => {})
  const send = (message: HostMessage) => {
    if (disposed || !capabilities) return
    iframe.contentWindow?.postMessage({projections: rendererProtocolVersion, channel, ...message}, '*')
  }
  const reveal = () => {
    iframe.style.opacity = ''
    iframe.dataset.revealed = 'true'
  }
  const timer = view.setTimeout(
    () => capabilities ?? fail(`The ${options.renderer} renderer did not become ready`),
    rendererLimits.readyTimeoutMs + rendererLimits.documentTimeoutMs,
  )
  function fail(message: string) {
    if (failed || disposed) return
    failed = true
    view.clearTimeout(timer)
    reveal()
    readiness.reject(new Error(message))
    options.onFailure?.(message)
  }
  // The frame's size, as a host reports it on load and whenever it changes.
  let size = ''
  const sendViewport = () => {
    const width = Math.round(iframe.clientWidth)
    const height = Math.round(iframe.clientHeight)
    if (!capabilities || `${width}x${height}` === size) return
    size = `${width}x${height}`
    send({type: 'viewport', width, height})
  }
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sendViewport)
  resize?.observe(iframe)
  const handle = (message: RendererMessage) => {
    if (message.type === 'ready') {
      if (capabilities) return
      capabilities = message.capabilities
      view.clearTimeout(timer)
      if (typeof initial === 'function') init = {sizing: 'fill', ...initial(capabilities)}
      if (typeof options.progress === 'function') progress = options.progress(capabilities)
      readiness.resolve(capabilities)
      if (init) send({type: 'init', ...init})
      sendViewport()
      if (settings) send({type: 'options', options: settings})
      if (selection !== null) send({type: 'select', id: selection})
      if (progress) send({type: 'progress', ...progress})
    } else if (message.type === 'rendered' || message.type === 'error') {
      reveal()
    } else if (message.type === 'document-request') {
      client.requestDocument(message.renderer).then(
        html => send({type: 'document', renderer: message.renderer, html}),
        (error: unknown) =>
          send({type: 'document', renderer: message.renderer, error: error instanceof Error ? error.message : String(error)}),
      )
    }
    // Every message is also the embedder's, through `onMessage`.
    options.onMessage?.(message)
  }
  const received = (event: MessageEvent) => {
    if (disposed || event.source === null || event.source !== iframe.contentWindow) return
    const message = parseRendererMessage(event.data, channel)
    if (message) handle(message)
  }
  view.addEventListener('message', received)
  container.append(iframe)
  client.requestDocument(options.renderer).then(
    html => {
      if (disposed) return
      const colorMode = options.colorMode ?? init?.theme.colorMode ?? 'light'
      iframe.srcdoc = withFragment(html, rendererFragment(channel, 'null', colorMode).slice(1))
    },
    (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
  )
  return {
    iframe,
    ready,
    setInit(next, position) {
      init = {sizing: 'fill', ...next}
      progress = position
      send({type: 'init', ...init})
      if (position) send({type: 'progress', ...position})
    },
    setProgress(next) {
      progress = next
      send({type: 'progress', ...next})
    },
    select(id) {
      selection = id
      send({type: 'select', id})
    },
    hover(id) {
      if (capabilities?.hover) send({type: 'hover', id})
    },
    setEnvironment(environment) {
      const sizing = environment.sizing ?? init?.sizing ?? 'fill'
      if (init) init = {...init, ...environment, sizing}
      send({type: 'environment', ...environment, sizing})
    },
    setOptions(next) {
      settings = next
      send({type: 'options', options: next})
    },
    dispose() {
      if (disposed) return
      disposed = true
      view.clearTimeout(timer)
      view.removeEventListener('message', received)
      resize?.disconnect()
      iframe.remove()
      if (!capabilities && !failed) readiness.reject(new Error('The embedded renderer was disposed'))
    },
  }
}

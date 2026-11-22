import {
  isPropertyPath,
  parseControls,
  parseHostMessage,
  parseRendererMessage,
  readRendererFragment,
  rendererLimits,
  rendererProtocolVersion,
  type AnchorRect,
  type ControlValue,
  type HostMessage,
  type InitPayload,
  type RendererControl,
  type RendererEnvironment,
  type RendererCapabilities,
  type RendererLegend,
  type RendererSummary,
  type RendererMessage,
  type ScrollPosition,
} from './protocol.js'
import {documentRings} from './rings.js'
import {optionalThemeTokenNames, resolveThemeTokens} from './tokens.js'
import {dispatch, echoedGeneration, replayed, resumeSession, type RendererHandlers} from './client/host-messages.js'
import {documentRequests} from './client/documents.js'

export type {RendererHandlers} from './client/host-messages.js'
export {embedRenderer} from './embed.js'
export type {EmbedOptions, EmbeddedRenderer} from './embed.js'

/** What `connectRenderer` declares, and where it connects. */
export interface ConnectOptions {
  /**
   * What the renderer supports, posted in `ready`; the host sends optional messages only for declared capabilities.
   * Invalid `controls` make `connectRenderer` throw.
   */
  capabilities: RendererCapabilities
  /** Defaults to the global window. Supplied in tests. */
  window?: Window
  /**
   * Hover, focus and selection rings on every entity's unit, as styling on
   * the unit's own element (see `connectRings`). On by default; `false`
   * leaves them to the renderer, which the renderer checks then hold to the
   * same contract.
   */
  rings?: false
}

/**
 * A renderer's side of the conversation with its host, from `connectRenderer`. Each method posts one message; nothing
 * is posted after `dispose`. IDs and error messages are truncated to `rendererLimits.textLength`, and coordinates
 * are rounded to hundredths of a pixel.
 */
export interface RendererClient {
  /** The frame's channel nonce, from the URL fragment. */
  readonly channel: string
  /**
   * Acknowledges that the frame for `progress` has been painted. Pass the `init` payload it painted when the
   * acknowledgement is deferred (after a paint, say), so that a paint of a document the host has since replaced isn't
   * taken for the new one; without it, the latest `init` is assumed.
   */
  rendered(progress: number, init?: InitPayload): void
  /**
   * Reports the renderer's selection, or `null` when it clears it. `path`, an
   * RFC 6901 pointer such as `/data/owner`, selects a property of the item
   * (capability `properties`); it is ignored with a `null` ID and throws if invalid.
   */
  select(id: string | null, path?: string): void
  /** Reports that the person activated the annotation marker on an item (capability `annotations`); call `select(id)` first. */
  annotation(id: string): void
  /**
   * Asks the host to draw the renderer's legend once beside the frames, with
   * the host's design system, instead of drawing one in each pane. Items use
   * theme tokens (preferred) or CSS colors; an empty list clears it. Throws
   * when the legend is invalid.
   */
  legend(legend: RendererLegend): void
  /**
   * Gives the host the words for its summary bar: a figure per extraction kind in the renderer's vocabulary
   * (`SummaryItem`), in display order; an empty list returns the bar to the host's own words. Throws when the summary
   * is invalid.
   */
  summary(summary: RendererSummary): void
  /** Requests a frame height in CSS pixels. The host clamps it. */
  height(px: number): void
  /**
   * Reports the shape (width / height) of the content the renderer fits to its stage, over the whole transition, so
   * a host can arrange held panes for the larger fitted scale. Clamped to `rendererLimits.aspect`.
   */
  aspect(ratio: number): void
  /**
   * Declares progress values at which the host may hold during playback, and optionally how many step slots the
   * presentation spans (`timelineSlots`), for the host's default pace.
   */
  steps(ends: readonly number[], slots?: number): void
  /** Asks the host to open a repository file; the host decides whether to navigate. */
  open(path: string, line?: number): void
  /** Reports a rendering failure. The host shows it and keeps its own views available. */
  error(message: string): void
  /** Reports the entity under the pointer (capability `hover`). */
  hover(id: string | null): void
  /** Reports where an entity is drawn, in this document's viewport, or `null` when it isn't visible (capability `anchors`). */
  anchor(id: string, rect: AnchorRect | null): void
  /** Reports that the person scrolled a container (capability `scrollSync`). */
  viewport(position: ScrollPosition): void
  /**
   * Replaces the controls the host draws for this renderer (initially those in
   * `capabilities.controls`). Throws if a declaration is invalid.
   */
  declareOptions(controls: readonly RendererControl[]): void
  /**
   * Sets a declared control's value from the renderer's own content, as the person changed it there (a sortable
   * column header, say). The host applies it as if they had set it in its settings and answers with `options`; it
   * ignores a value the control doesn't accept.
   */
  setControl(id: string, value: ControlValue): void
  /**
   * Asks the host for the document of the built-in renderer `name` (for example `graph`), to run in a frame nested in
   * this one (`embedRenderer` does both). Resolves with its `index.html` text, as the host runs it; rejects with the
   * host's reason when it supplies none (an unknown or custom renderer, or a host without documents), or after
   * `rendererLimits.documentTimeoutMs` without an answer. Repeated requests for one name share one answer.
   */
  requestDocument(name: string): Promise<string>
  /** Observes every valid host message after the handlers run. Returns a function that stops observing. */
  subscribe(listener: (message: HostMessage) => void): () => void
  /** Requests the height of `element` now and whenever it resizes. Returns a function that stops observing. */
  observeHeight(element: Element): () => void
  /** Stops listening for host messages. */
  dispose(): void
}

/**
 * Thrown when a renderer can't connect or is asked to send something invalid: outside a host frame, without a channel
 * in the URL fragment, or with invalid controls, legend, summary or selection path.
 */
export class RendererConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RendererConnectionError'
  }
}

/**
 * Connects a renderer document to its host. Reads the channel nonce and host
 * origin from the URL fragment, starts listening, and posts `ready` with the
 * renderer's capabilities. Messages that do not come from the parent window,
 * carry another channel or fail validation are ignored. When a document connects again on the same channel (a
 * development server's hot update), the host's current state is replayed to the new handlers.
 *
 * @throws `RendererConnectionError` outside a host frame, without a channel, or with invalid `capabilities.controls`.
 *
 * @example
 * ```ts
 * const client = connectRenderer(
 *   {
 *     init(payload) {
 *       document = payload
 *       draw(payload)
 *     },
 *     progress({progress, highlighting}) {
 *       update(progress, highlighting)
 *       const painted = document
 *       afterPaint(() => client.rendered(progress, painted))
 *     },
 *     environment: applyEnvironment,
 *   },
 *   {capabilities: {changeHighlighting: 'supported'}},
 * )
 * ```
 */
export function connectRenderer(handlers: RendererHandlers, options: ConnectOptions): RendererClient {
  if (options.capabilities.controls !== undefined && !parseControls(options.capabilities.controls)) {
    throw new RendererConnectionError('Invalid control declarations in capabilities')
  }
  const view = options.window ?? window
  const fragment = readRendererFragment(view.location.hash)
  if (!fragment) throw new RendererConnectionError('This renderer must be loaded by a Projections host; the frame URL has no channel')
  const {channel, hostOrigin} = fragment
  const parent = view.parent
  if (parent === view) throw new RendererConnectionError('This renderer must run inside a host frame')
  const target = hostOrigin === 'null' ? '*' : hostOrigin
  let disposed = false
  const post = (message: RendererMessage) => {
    if (disposed) return
    parent.postMessage({projections: rendererProtocolVersion, channel, ...message}, target)
  }
  const {messages, replay} = resumeSession(view, channel)
  const rings = options.rings === false ? null : documentRings(view)
  const documents = documentRequests(view, post, message => new RendererConnectionError(message))
  const deliver = (message: HostMessage) => {
    if (message.type === 'document') return documents.answer(message)
    if (message.type === 'select') rings?.controller.set({selected: message.id})
    if (message.type === 'hover') rings?.controller.set({hovered: message.id})
    if (message.type === 'init') rings?.controller.set({hovered: null, selected: null})
    dispatch(handlers, message)
    for (const subscriber of subscribers) subscriber(message)
  }
  const listener = (event: MessageEvent) => {
    if (event.source !== parent || (target !== '*' && event.origin !== target)) return
    const message = parseHostMessage(event.data, channel)
    if (!message) return
    if ((replayed as readonly string[]).includes(message.type)) {
      if (message.type === 'init') messages.clear()
      messages.set(message.type, message)
    }
    deliver(message)
  }
  view.addEventListener('message', listener)
  const observers = new Set<ResizeObserver>()
  const subscribers = new Set<(message: HostMessage) => void>()
  const round = (value: number) => Math.round(value * 100) / 100
  const clamp = (value: number) => Math.min(rendererLimits.maxHeight, Math.max(0, Math.ceil(value)))
  const client: RendererClient = {
    channel,
    rendered: (progress, init) =>
      post({type: 'rendered', progress: Math.min(1, Math.max(0, progress)), ...echoedGeneration(messages.get('init'), init)}),
    select(id, path) {
      if (path !== undefined && !isPropertyPath(path)) {
        throw new RendererConnectionError('A selection path must be an RFC 6901 JSON pointer')
      }
      rings?.controller.set({selected: id})
      post({type: 'select', id: id ? id.slice(0, rendererLimits.textLength) : null, ...(id && path !== undefined ? {path} : {})})
    },
    annotation(id) {
      if (id) post({type: 'annotation', id: id.slice(0, rendererLimits.textLength)})
    },
    legend(legend) {
      const message = {projections: rendererProtocolVersion, channel, type: 'legend' as const, ...legend}
      if (!parseRendererMessage(message, channel)) {
        throw new RendererConnectionError('The legend is invalid; see LegendItem and rendererLimits')
      }
      post({type: 'legend', ...legend})
    },
    summary(summary) {
      const message = {projections: rendererProtocolVersion, channel, type: 'summary' as const, ...summary}
      if (!parseRendererMessage(message, channel)) {
        throw new RendererConnectionError('The summary is invalid; see SummaryItem and rendererLimits')
      }
      post({type: 'summary', items: summary.items})
    },
    height: px => post({type: 'height', px: clamp(px)}),
    aspect: ratio =>
      post({
        type: 'aspect',
        ratio: Math.min(rendererLimits.aspect.max, Math.max(rendererLimits.aspect.min, Math.round(ratio * 1000) / 1000)),
      }),
    steps: (ends, slots) =>
      post({
        type: 'steps',
        ends: [...ends].slice(0, rendererLimits.steps),
        ...(slots === undefined || !Number.isFinite(slots) ? {} : {slots: Math.min(2 * rendererLimits.steps, Math.max(0, slots))}),
      }),
    open: (path, line) => post({type: 'open', path, ...(line === undefined ? {} : {line})}),
    error: message => post({type: 'error', message: message.slice(0, rendererLimits.textLength)}),
    hover: id => post({type: 'hover', id: id ? id.slice(0, rendererLimits.textLength) : null}),
    anchor: (id, rect) =>
      post({
        type: 'anchor',
        id: id.slice(0, rendererLimits.textLength),
        rect: rect && {
          x: round(rect.x),
          y: round(rect.y),
          width: round(Math.max(0, rect.width)),
          height: round(Math.max(0, rect.height)),
        },
      }),
    viewport: position =>
      post({
        type: 'viewport',
        x: round(Math.max(0, position.x)),
        y: round(Math.max(0, position.y)),
        ...(position.key === undefined ? {} : {key: position.key}),
      }),
    requestDocument: name => documents.request(name),
    declareOptions(controls) {
      const parsed = parseControls(controls)
      if (!parsed) throw new RendererConnectionError('Invalid control declarations')
      post({type: 'controls', controls: parsed})
    },
    setControl(id, value) {
      const message = {projections: rendererProtocolVersion, channel, type: 'control' as const, id, value}
      if (!parseRendererMessage(message, channel)) throw new RendererConnectionError('Invalid control value; see ControlValue')
      post({type: 'control', id, value})
    },
    subscribe(listener) {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    },
    observeHeight(element) {
      let last = -1
      const report = () => {
        const px = clamp(element.getBoundingClientRect().height)
        if (px !== last) {
          last = px
          client.height(px)
        }
      }
      // At once, not only at the first observation, which waits for the frame's next rendering opportunity: a paint
      // acknowledged before then would otherwise reach the host before any height.
      report()
      const observer = new ResizeObserver(report)
      observer.observe(element)
      observers.add(observer)
      return () => {
        observer.disconnect()
        observers.delete(observer)
      }
    },
    dispose() {
      disposed = true
      documents.dispose()
      rings?.release()
      view.removeEventListener('message', listener)
      for (const observer of observers) observer.disconnect()
      observers.clear()
      subscribers.clear()
    },
  }
  post({type: 'ready', capabilities: options.capabilities})
  if (replay.length) {
    const order = (type: HostMessage['type']) => (replayed as readonly string[]).indexOf(type)
    queueMicrotask(() => {
      for (const [, message] of replay.sort(([a], [b]) => order(a) - order(b))) if (!disposed) deliver(message)
    })
  }
  return client
}

/**
 * Exposes the host theme to CSS as `--projections-<token>` custom properties,
 * sets `color-scheme`, marks reduced motion with `data-reduced-motion="true"`
 * and a held pane of side by side or swipe with `data-pane="before|after"` on
 * the element (the document element by default).
 */
export function applyEnvironment(environment: RendererEnvironment, element: HTMLElement = document.documentElement): void {
  // Every token of the current set is defined, using defaults for any the host omitted.
  const tokens = resolveThemeTokens(environment.theme)
  for (const [name, value] of Object.entries(tokens)) {
    if (/^[a-z0-9-]{1,64}$/.test(name)) element.style.setProperty(`--projections-${name}`, value)
  }
  // An optional layout token the host no longer sends (a pane chip gone with its mode) falls back to the renderer's own.
  for (const name of optionalThemeTokenNames) if (!(name in tokens)) element.style.removeProperty(`--projections-${name}`)
  // The document root keeps `color-scheme: light dark`, like the host's frame element, so browsers never paint an
  // opaque backdrop for a scheme mismatch; the body and everything in it use the host's mode.
  const scheme = element === element.ownerDocument.documentElement ? (element.ownerDocument.body ?? element) : element
  scheme.style.colorScheme = environment.theme.colorMode
  element.dataset.colorMode = environment.theme.colorMode
  element.dataset.reducedMotion = String(environment.reducedMotion)
  if (environment.pane) element.dataset.pane = environment.pane
  else delete element.dataset.pane
  element.lang = environment.locale
}

/**
 * Calls `callback` once after the browser has painted the current frame.
 * Browsers pause animation frames in hidden or offscreen cross-origin frames,
 * where nothing is painted; a short timer then acknowledges instead.
 */
export function afterPaint(callback: () => void, view: Window = window, fallbackMs = 200): () => void {
  let second = 0
  let done = false
  const finish = () => {
    if (done) return
    done = true
    view.clearTimeout(timer)
    callback()
  }
  const first = view.requestAnimationFrame(() => {
    second = view.requestAnimationFrame(finish)
  })
  const timer = view.setTimeout(finish, fallbackMs)
  return () => {
    done = true
    view.cancelAnimationFrame(first)
    view.cancelAnimationFrame(second)
    view.clearTimeout(timer)
  }
}

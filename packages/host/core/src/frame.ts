import {rendererLimits, rendererProtocolVersion} from '@githubnext/projections-renderer-sdk/protocol'
import type {
  AnnotationMark,
  FilterPayload,
  HostMessage,
  InitPayload,
  RendererControl,
  ProgressPayload,
  RendererCapabilities,
  RendererEnvironment,
  RendererMessage,
  RendererOptions,
  ScrollPosition,
} from '@githubnext/projections-renderer-sdk/protocol'
import {HeightRequests, MessageGate} from './frame/admission.js'
import {ProgressFlow} from './frame/progress-flow.js'
import {initMessage, replay, selectMessage} from './frame/replay.js'
import {fillStyle, frameElement, frameUrl, nonce, observeViewport, viewportOf} from './frame/element.js'
import {FrameLifecycle} from './frame/lifecycle.js'
import {OpenedDocument} from './frame/opened.js'
import type {RendererFrameEvent, RendererFrameOptions, RendererFrameStatus} from './frame/types.js'
import type {RendererDocuments} from './registry.js'

/** The renderer's messages the frame only passes on, as events. */
const passedOn = ['aspect', 'steps', 'open', 'hover', 'anchor', 'viewport', 'control', 'annotation', 'legend', 'summary'] as const
type PassedOn = Extract<RendererMessage, {type: (typeof passedOn)[number]}>
const isPassedOn = (message: RendererMessage): message is PassedOn => passedOn.some(type => type === message.type)
const noop = () => undefined

/**
 * Hosts one renderer bundle in a sandboxed frame and speaks the renderer
 * frame protocol with it.
 *
 * - The frame gets `sandbox="allow-scripts"` only (an opaque origin), no
 *   permissions-policy features, no referrer and an accessible name (`aria-label`, not a
 *   `title`, which browsers show as a tooltip). Its
 *   bundle must be served with the renderer content security policy.
 * - Each frame has a fresh channel nonce, passed in the URL fragment.
 *   Messages are accepted only from this frame's window, from an opaque
 *   origin, on this channel, within the size and rate bounds, and only if
 *   they validate strictly. Everything else is dropped.
 * - Progress is flow-controlled: at most one progress value is unacknowledged;
 *   newer values replace any pending one and are sent when the renderer
 *   acknowledges painting the previous one.
 * - A renderer that does not become ready, navigates its frame or floods the
 *   host is stopped and reported; the host's own views remain available.
 * - A frame whose document loads but whose renderer doesn't answer (an
 *   embedding browser that blocks the frame's URL) can open the renderer's
 *   document itself once, as a Blob document in the same sandboxed frame
 *   (`documents`, by default the page's `setRendererDocuments`).
 */
export class RendererFrame {
  readonly iframe: HTMLIFrameElement
  readonly channel: string
  capabilities: RendererCapabilities | undefined
  /** The progress the renderer most recently acknowledged painting. */
  renderedProgress: number | undefined
  private readonly view: Window
  private readonly onEvent: (event: RendererFrameEvent) => void
  private init: InitPayload
  /** The environment the host last set (`setEnvironment`), which a new `init` keeps: its covers, say. */
  private environment: RendererEnvironment | undefined
  private progress: ProgressPayload | undefined
  private selection: string | null
  private selectionPath: string | undefined
  private marks: AnnotationMark[] = []
  private hovered: string | null = null
  private declared: RendererControl[] = []
  private filtering: FilterPayload | undefined
  private options: RendererOptions
  private readonly heights: HeightRequests
  private fill: boolean
  private requestedHeight = 480
  private readonly gate: MessageGate
  private readonly flow: ProgressFlow
  private readonly lifecycle: FrameLifecycle
  private readonly resize: ResizeObserver | undefined
  private readonly url: URL
  private readonly opened: OpenedDocument
  private readonly builtinDocuments: RendererDocuments | undefined

  constructor(options: RendererFrameOptions) {
    this.view = options.window ?? options.container.ownerDocument.defaultView ?? window
    this.onEvent = options.onEvent ?? noop
    this.init = options.init
    this.progress = options.progress
    this.selection = options.selection ?? null
    this.options = options.options ?? {}
    this.fill = options.fill ?? false
    this.builtinDocuments = options.builtinDocuments
    this.heights = new HeightRequests(this.view)
    this.channel = nonce(this.view)
    this.flow = new ProgressFlow(this.view, options.acknowledgementTimeoutMs ?? 1000, progress =>
      this.send({type: 'progress', ...progress}),
    )
    this.url = frameUrl(options, this.view, this.channel)
    this.opened = new OpenedDocument(options.documents)
    const iframe = frameElement(options, this.opened.first ? undefined : this.url, this.fill)
    this.iframe = iframe
    this.gate = new MessageGate(this.view, iframe, this.channel)
    const readyTimeoutMs = options.readyTimeoutMs ?? rendererLimits.readyTimeoutMs
    const reopen = this.opened.retries ? () => this.open() : undefined
    this.lifecycle = new FrameLifecycle(this.view, iframe, readyTimeoutMs, this.onEvent, () => this.teardown(), reopen)
    this.view.addEventListener('message', this.received)
    options.container.append(iframe)
    if (this.opened.first) this.open()
    this.resize = observeViewport(iframe, this.view, viewport => this.send({type: 'viewport', ...viewport}))
  }

  get status(): RendererFrameStatus {
    return this.lifecycle.status
  }

  /** Whether the frame is visible. It stays transparent until it has painted with the host theme. */
  get revealed(): boolean {
    return this.lifecycle.revealed
  }

  /** Replaces the presented documents. The renderer receives a new `init`. */
  setInit(init: InitPayload, progress?: ProgressPayload): void {
    // A new init (refreshed documents, a new focus) keeps the environment the host set since, such as the theme tokens
    // that say what covers the frame, which the host doesn't send again while they're unchanged.
    this.init = this.environment ? {...init, ...this.environment} : init
    this.progress = progress
    this.flow.reset()
    this.renderedProgress = undefined
    // Numbered, so the gate drops a renderer's acknowledgement of an earlier one.
    this.gate.generation++
    if (this.status !== 'ready') return
    this.send(initMessage(init, this.capabilities, this.gate.generation))
    if (progress) this.setProgress(progress)
  }

  setProgress(progress: ProgressPayload): void {
    this.progress = progress
    if (this.status !== 'ready') return
    this.flow.offer(progress)
  }

  /** Selects an item, and optionally a property of it (`path`, an RFC 6901 pointer into its `data`). */
  select(id: string | null, path?: string): void {
    this.selection = id
    this.selectionPath = id === null ? undefined : path
    this.send(selectMessage(id, this.selectionPath))
  }

  /** Replaces the annotation markers, if the renderer draws them. */
  annotations(items: AnnotationMark[]): void {
    this.marks = items
    if (this.capabilities?.annotations) this.send({type: 'annotations', items})
  }

  setOptions(options: RendererOptions): void {
    this.options = options
    this.send({type: 'options', options})
  }

  /** Shows hover for an entity, if the renderer supports it. */
  hover(id: string | null): void {
    this.hovered = id
    if (this.capabilities?.hover) this.send({type: 'hover', id})
  }

  /** The controls the renderer currently declares. */
  get controls(): RendererControl[] {
    return this.declared
  }

  /** Triggers one of the renderer's declared `action` controls. Unknown IDs are ignored. */
  action(id: string): void {
    if (this.declared.some(control => control.id === id && control.type === 'action')) this.send({type: 'action', id})
  }

  /** Sends the host's find and "changes only" settings, if the renderer honors them. */
  filter(payload: FilterPayload): void {
    this.filtering = payload
    if (this.capabilities?.filter) this.send({type: 'filter', ...payload})
  }

  /** Scrolls a renderer container to mirror another pane, if the renderer supports it. */
  scroll(position: ScrollPosition): void {
    if (this.capabilities?.scrollSync) this.send({type: 'scroll', ...position})
  }

  setEnvironment(environment: RendererEnvironment): void {
    this.environment = environment
    this.init = {...this.init, ...environment}
    this.send({type: 'environment', ...environment})
  }

  focus(): void {
    this.iframe.focus()
  }

  /** Fills the container's height, or follows the renderer's requested height again. */
  setFill(fill: boolean): void {
    if (fill === this.fill) return
    this.fill = fill
    // A filling frame is the flexible item of its pane's column.
    Object.assign(this.iframe.style, fillStyle(fill, `${this.requestedHeight}px`))
    const {theme, reducedMotion, locale, pane} = this.init
    this.send({type: 'environment', theme, reducedMotion, locale, ...(pane ? {pane} : {})})
  }

  /** Changes the frame's accessible name without reloading it. */
  setTitle(title: string): void {
    this.iframe.setAttribute('aria-label', title)
  }

  dispose(): void {
    this.lifecycle.dispose()
  }

  /** Opens the renderer's document itself and loads it into the frame, keeping the fragment. */
  private open(): void {
    this.opened.open(this.iframe, this.url, this.lifecycle)
  }

  private teardown(): void {
    this.opened.revoke()
    this.view.removeEventListener('message', this.received)
    this.flow.dispose()
    this.resize?.disconnect()
    this.iframe.remove()
  }

  private send(message: HostMessage): void {
    if (this.status !== 'ready') return
    // The environment says how this frame is sized: it follows the renderer's height unless it fills its container.
    const sized =
      message.type === 'init' || message.type === 'environment'
        ? {...message, sizing: this.fill ? ('fill' as const) : ('content' as const)}
        : message
    // The frame has an opaque origin, so no target origin can name it. The
    // frame is torn down as soon as it navigates, so only this document receives.
    this.iframe.contentWindow?.postMessage({projections: rendererProtocolVersion, channel: this.channel, ...sized}, '*')
  }

  private readonly received = (event: MessageEvent) => {
    if (this.lifecycle.stopped) return
    const admission = this.gate.admit(event)
    if (admission.type === 'failed') this.lifecycle.fail(admission.message)
    else if (admission.type === 'rejected') this.onEvent(admission)
    else if (admission.type === 'message') this.handle(admission.message)
  }

  private handle(message: RendererMessage): void {
    if (message.type === 'ready') {
      this.ready(message.capabilities)
      return
    }
    if (this.status !== 'ready') return
    if (isPassedOn(message)) {
      this.onEvent(message)
      return
    }
    switch (message.type) {
      case 'rendered':
        this.renderedProgress = message.progress
        this.flow.acknowledged(message.progress)
        this.onEvent({type: 'rendered', progress: message.progress})
        this.lifecycle.reveal()
        return
      case 'height': {
        const px = this.heights.settle(message.px)
        this.requestedHeight = px
        if (!this.fill && this.iframe.style.height !== `${px}px`) this.iframe.style.height = `${px}px`
        this.onEvent({type: 'height', px})
        return
      }
      case 'select':
        this.selection = message.id
        this.selectionPath = message.path
        this.onEvent(message)
        return
      case 'controls':
        this.declared = message.controls
        this.onEvent(message)
        return
      case 'document-request':
        this.supply(message.renderer)
        return
      case 'error':
        this.onEvent(message)
        // A renderer that reports an error has handled the host's messages; show its state rather than a loading one.
        this.lifecycle.reveal()
    }
  }

  /** Answers a `document-request`: the built-in renderer's document, or why the host won't supply it. */
  private supply(renderer: string): void {
    const documents = this.builtinDocuments
    const refuse = (error: unknown) =>
      this.send({
        type: 'document',
        renderer,
        error: (error instanceof Error ? error.message : String(error)).slice(0, rendererLimits.textLength),
      })
    if (!documents) {
      refuse("This host doesn't supply renderer documents")
      return
    }
    documents(renderer).then(html => this.send({type: 'document', renderer, html}), refuse)
  }

  /** The renderer became ready: sends it the presented documents and the state set while it loaded. */
  private ready(capabilities: RendererCapabilities): void {
    if (!this.lifecycle.ready()) return
    this.opened.ready()
    this.capabilities = capabilities
    this.declared = capabilities.controls ?? []
    this.onEvent({type: 'ready', capabilities})
    const {init, options, selection, selectionPath, marks, hovered, filtering} = this
    const {generation} = this.gate
    for (const message of replay({init, generation, options, selection, selectionPath, marks, hovered, filtering}, capabilities)) {
      this.send(message)
    }
    this.send({type: 'viewport', ...viewportOf(this.iframe, this.view)})
    if (this.progress) this.flow.send(this.progress)
  }
}

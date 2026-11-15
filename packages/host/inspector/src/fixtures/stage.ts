import {RendererFrame} from '@githubnext/projections-host'
import type {InitPayload, ProgressPayload, RendererEntry, RendererFrameEvent, RendererOptions} from '@githubnext/projections-host'
import type {
  ProbeCall,
  StageEnvironment,
  StageHighlighting,
  StageLoad,
  StageSeek,
  StageState,
  StageSubject,
} from '@githubnext/projections-renderer-testing'
import {recordEvent} from './stage-events.js'
import {StageProbe} from './stage-probe.js'
import {blank, frameEnvironment, presentation, sizeContainer, stageHighlighting, type PresentedEnvironment} from './stage-presentation.js'

/**
 * One renderer bundle in the real host frame (`RendererFrame`: sandboxed,
 * opaque origin, renderer policy, flow-controlled progress), driven exactly
 * like the renderer harness drives it, plus the check probe the Inspector
 * injects in fixtures mode. The checks and Playwright helpers use it.
 */
export class Stage {
  private frame: RendererFrame | undefined
  private current: StageState = blank()
  private presented: StageSubject | undefined
  private comparing = false
  /** Diff mode: one static comparison, no progress. */
  private diff = false
  private highlightingMode: StageHighlighting = 'auto'
  private environment: PresentedEnvironment = {colorMode: 'light', reducedMotion: false, locale: 'en-US', pane: null}
  private waiters: {progress: number; resolve: (state: StageState) => void; reject: (error: Error) => void}[] = []
  private readiness: {resolve: () => void; reject: (error: Error) => void} | undefined
  /** The open frame's bundle URL, and whether it was loaded with `reuse`. */
  private url: string | undefined
  private reusable = false
  private readonly probe = new StageProbe(() => (this.current.status === 'ready' ? this.frame?.iframe.contentWindow : undefined))

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: (state: StageState) => void = () => {},
  ) {}

  state(): StageState {
    return structuredClone(this.current)
  }

  subject(): StageSubject {
    if (!this.presented) throw new Error('Load a renderer first')
    return this.presented
  }

  dispose(): void {
    this.reset()
    this.current = blank()
  }

  private reset(): void {
    this.frame?.dispose()
    this.frame = undefined
    this.reusable = false
    this.probe.reset()
    for (const waiter of this.waiters) waiter.reject(new Error('A new renderer was loaded'))
    this.waiters = []
    this.readiness?.reject(new Error('A new renderer was loaded'))
    this.readiness = undefined
  }

  private changed(): void {
    this.onChange(this.state())
  }

  private highlighting(progress: number, mode: StageHighlighting): number {
    return stageHighlighting(this.comparing, progress, mode)
  }

  private fail(message: string): void {
    this.current.status = 'failed'
    this.current.failure = message
    for (const waiter of this.waiters) waiter.reject(new Error(message))
    this.waiters = []
    this.readiness?.reject(new Error(message))
    this.readiness = undefined
    this.changed()
  }

  private readonly onEvent = (event: RendererFrameEvent) => {
    const state = this.current
    switch (event.type) {
      case 'ready':
        state.status = 'ready'
        state.capabilities = event.capabilities
        state.controls = event.capabilities.controls ?? []
        this.readiness?.resolve()
        this.readiness = undefined
        break
      case 'rendered':
        state.rendered = event.progress
        this.waiters = this.waiters.filter(waiter => {
          if (waiter.progress !== event.progress) return true
          waiter.resolve(this.state())
          return false
        })
        break
      case 'failed':
        this.fail(event.message)
        return
      default:
        recordEvent(state, event)
        break
    }
    this.changed()
  }

  private rendered(progress: number): Promise<StageState> {
    return new Promise((resolve, reject) => {
      if (this.current.status === 'failed') {
        reject(new Error(this.current.failure))
        return
      }
      this.waiters.push({progress, resolve, reject})
    })
  }

  private payload(): ProgressPayload {
    return {progress: this.current.progress, highlighting: this.current.highlighting, direction: this.current.direction}
  }

  /**
   * Presents a subject with a resolved bundle and resolves once the renderer has painted the initial progress. A load
   * with `reuse` presents in the open frame, with a new `init`, when that frame shows the same bundle and was itself
   * loaded with `reuse`: the styling checks' many loads would otherwise each start a frame, and its renderer process,
   * and under that churn WebKit stops starting new frames' navigations.
   */
  async load(request: StageLoad, bundle: RendererEntry): Promise<StageState> {
    const open = this.frame
    if (request.reuse && this.reusable && open && this.current.status === 'ready' && this.url === bundle.url) {
      const capabilities = this.current.capabilities!
      const {init, progress} = this.present(request, bundle)
      Object.assign(this.current, {status: 'ready', capabilities, controls: capabilities.controls ?? []})
      this.changed()
      // The frame lays out at its new width before the renderer presents the new documents.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const first = this.rendered(this.current.progress)
      open.setFill(Boolean(request.height))
      open.setOptions(request.options ?? {})
      open.select(this.current.selection)
      open.hover(null)
      open.setEnvironment(this.frameEnvironment())
      open.setInit(init, progress)
      return first
    }
    this.reset()
    const {init, progress} = this.present(request, bundle)
    this.reusable = Boolean(request.reuse)
    this.url = bundle.url
    const ready = new Promise<void>((resolve, reject) => {
      this.readiness = {resolve, reject}
    })
    const first = this.rendered(this.current.progress)
    this.frame = new RendererFrame({
      container: this.container,
      url: bundle.url,
      title: `${bundle.title} renderer`,
      init,
      ...(progress ? {progress} : {}),
      selection: this.current.selection,
      options: request.options ?? {},
      onEvent: this.onEvent,
      ...(request.height ? {fill: true} : {}),
    })
    await ready
    return first
  }

  /** Starts presenting a load: a fresh state, the container sized, and the `init` and first progress to send. */
  private present(request: StageLoad, bundle: RendererEntry): {init: InitPayload; progress: ProgressPayload | undefined} {
    const next = presentation(request, bundle)
    // Observers see the load start before what it presents.
    this.current = {...blank(), status: 'loading', bundle: bundle.name}
    this.presented = request.subject
    this.changed()
    Object.assign(this.current, next.state)
    this.comparing = next.comparing
    this.diff = next.diff
    this.highlightingMode = next.highlightingMode
    this.environment = next.environment
    sizeContainer(this.container, request, this.environment.colorMode)
    const progress = next.sendProgress ? this.payload() : undefined
    const {projection, ...documents} = next.init
    return {init: {projection, ...this.frameEnvironment(), ...documents} as InitPayload, progress}
  }

  async seek(progress: number, options: StageSeek = {}): Promise<StageState> {
    if (!this.frame || this.current.status !== 'ready') throw new Error('Load a renderer before seeking')
    if (this.diff && (options.highlighting === undefined || options.highlighting === 'auto')) {
      // Nothing to seek in diff mode: wait for the latest paint instead. Other highlighting is sent as one progress at 1.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return this.state()
    }
    if (options.highlighting !== undefined) this.highlightingMode = options.highlighting
    const state = this.current
    state.progress = this.comparing && !this.diff ? Math.max(0, Math.min(1, progress)) : 1
    if (options.direction) state.direction = options.direction
    state.highlighting = this.highlighting(state.progress, this.highlightingMode)
    this.changed()
    const done = this.rendered(state.progress)
    this.frame.setProgress(this.payload())
    return done
  }

  select(id: string | null): void {
    this.current.selection = id
    this.frame?.select(id)
    this.changed()
  }

  setOptions(options: RendererOptions): void {
    this.frame?.setOptions(options)
  }

  action(id: string): void {
    this.frame?.action(id)
  }

  hover(id: string | null): void {
    this.frame?.hover(id)
  }

  setEnvironment(next: StageEnvironment): void {
    this.environment = {...this.environment, ...next}
    this.container.dataset.colorMode = this.environment.colorMode
    this.frame?.setEnvironment(this.frameEnvironment())
  }

  /** The environment the frame is told: the theme, motion and locale, and the pane it holds, if any. */
  private frameEnvironment() {
    return frameEnvironment(this.environment)
  }

  async setWidth(width: number | null): Promise<void> {
    this.container.style.width = width ? `${width}px` : ''
    if (!this.frame || this.current.status !== 'ready') return
    // The frame reports its new viewport to the renderer; wait for its layout, then for a fresh paint.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await this.seek(this.current.progress)
    await this.measure('settle')
  }

  /** Runs a check-probe measurement inside the renderer document. */
  measure<T = unknown>(call: ProbeCall, args?: unknown): Promise<T> {
    return this.probe.measure<T>(call, args)
  }
}

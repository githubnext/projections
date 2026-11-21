import {RendererFrame, isControlValue} from '@githubnext/projections-host'
import type {
  FilterPayload,
  InitPayload,
  ProgressPayload,
  RendererDocuments,
  RendererEntry,
  RendererFrameEvent,
  RendererOptions,
} from '@githubnext/projections-host'
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
 * How long a measurement waits for the renderer's frame to arrive at its height before it fails, ms (see
 * `Stage.arrived`): far longer than a loaded machine takes to deliver a resize, as a frame measured at the height
 * before would be measured wrong.
 */
const arrivalLimitMs = 60_000

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
  /** The open frame fills a fixed height (`StageLoad.height`) rather than taking the height its renderer asks for. */
  private filling = false
  /** Whether the open frame was last sent a filter: a reused load without one clears it. */
  private filtered = false
  /** The control values last sent, which a renderer's `control` message updates as a host's settings would. */
  private options: RendererOptions = {}
  private readonly probe = new StageProbe(() => (this.current.status === 'ready' ? this.frame?.iframe.contentWindow : undefined))

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: (state: StageState) => void = () => {},
    /** Built-in renderer documents for a renderer that nests them, from the fixtures' catalog. */
    private readonly documents?: RendererDocuments,
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
      case 'control': {
        const control = state.controls.find(item => item.id === event.id)
        // Answered with the options either way, so a value the stage declines is undone in the renderer.
        this.setOptions(control && isControlValue(control, event.value) ? {...this.options, [event.id]: event.value} : this.options)
        break
      }
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
      this.filling = Boolean(request.height)
      open.setFill(this.filling)
      this.options = request.options ?? {}
      open.setOptions(this.options)
      open.select(this.current.selection)
      open.hover(null)
      open.setEnvironment(this.frameEnvironment())
      open.setInit(init, progress)
      // A reused frame keeps the filter it was sent, so a load without one clears it rather than narrowing the new
      // documents to the last ones' scope. A frame never filtered stays unfiltered, as a host's frame opens.
      if (request.filter) open.filter(request.filter)
      else if (this.filtered) open.filter({query: '', changesOnly: false, ids: null, scope: null})
      this.filtered = Boolean(request.filter)
      return first
    }
    this.reset()
    const {init, progress} = this.present(request, bundle)
    this.options = request.options ?? {}
    this.reusable = Boolean(request.reuse)
    this.filling = Boolean(request.height)
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
      ...(this.documents ? {builtinDocuments: this.documents} : {}),
    })
    // Kept by the frame and sent right after `init` once the renderer is ready, as a host's scope is.
    if (request.filter) this.frame.filter(request.filter)
    this.filtered = Boolean(request.filter)
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
    this.options = options
    this.frame?.setOptions(options)
  }

  action(id: string): void {
    this.frame?.action(id)
  }

  hover(id: string | null): void {
    this.frame?.hover(id)
  }

  filter(payload: FilterPayload): void {
    this.frame?.filter(payload)
    this.filtered = Boolean(this.frame)
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

  /**
   * Runs a check-probe measurement inside the renderer document. `settle` first waits for the frame to arrive at its
   * height (see `arrived`), so what the checks measure is never a paint placed for the height before.
   */
  async measure<T = unknown>(call: ProbeCall, args?: unknown): Promise<T> {
    if (call === 'settle') await this.arrived()
    return this.probe.measure<T>(call, args)
  }

  /**
   * Waits until the renderer's document is as tall as the frame the host gave it: the height the renderer asked for,
   * or the fixed height it fills. The frame is a sandboxed, out-of-process document, so a resize reaches it only some
   * time after the host applies it, and on a loaded machine seconds later; a renderer that acknowledged its paint
   * before then (it waits only so long, as a host may never resize it) painted for the old height, with its view placed
   * for that. A measurement of that paint would be wrong, and two of them taken at different heights would differ
   * (cards that seem to move with change status), so this never gives up and measures anyway: it fails after
   * `arrivalLimitMs` instead. When the height arrives late, the renderer's paint at it is waited for too.
   */
  private async arrived(): Promise<void> {
    const frame = this.frame
    if (!frame || this.current.status !== 'ready') return
    const target = () => (this.filling ? frame.iframe.clientHeight : this.current.height)
    const deadline = performance.now() + arrivalLimitMs
    let late = false
    for (;;) {
      const height = target()
      if (height === undefined) return
      const {height: inner} = await this.probe.measure<{width: number; height: number}>('viewport')
      if (Math.abs(inner - height) <= 1) break
      if (performance.now() > deadline)
        throw new Error(
          `The renderer's frame is ${inner}px tall ${arrivalLimitMs / 1000} s after it was given ${height}px; nothing is measured at the height before.`,
        )
      late = true
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!late) return
    // The renderer lays out again at its new height and acknowledges that paint, if it held one for it.
    await this.nextPaint(1000)
  }

  /** The renderer's next paint acknowledgement of the current progress, or `timeoutMs`, whichever comes first. */
  private nextPaint(timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        this.waiters = this.waiters.filter(entry => entry !== waiter)
        resolve()
      }
      const waiter = {progress: this.current.progress, resolve: done, reject: done}
      const timer = setTimeout(done, timeoutMs)
      this.waiters.push(waiter)
    })
  }
}

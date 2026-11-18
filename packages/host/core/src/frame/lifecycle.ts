import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrameEvent, RendererFrameStatus} from './types.js'

/**
 * How long after its document loads a renderer has to say it is ready before the frame counts its document as not the
 * renderer's (a page the embedding browser put there instead): a renderer says so as its script starts, before then.
 */
export const unansweredLoadMs = 1500

/**
 * A renderer frame's lifecycle: loading until its renderer is ready or the ready timeout passes, transparent until it
 * has painted, and stopped for good when it fails, navigates its frame or is disposed. A frame that can open its
 * renderer's document another way (`reopen`) does so once, instead of failing, when its document loads but its renderer
 * doesn't answer, or when the ready timeout passes.
 */
export class FrameLifecycle {
  status: RendererFrameStatus = 'loading'
  /** Whether the frame is visible. It stays transparent until it has painted with the host theme. */
  revealed = false
  private loads = 0
  private readyTimer: number
  private unansweredTimer: number | undefined
  private revealTimer: number | undefined

  constructor(
    private readonly view: Window,
    private readonly iframe: HTMLIFrameElement,
    private readonly readyTimeoutMs: number,
    private readonly onEvent: (event: RendererFrameEvent) => void,
    /** Releases everything else the frame holds, once it stops. */
    private readonly teardown: () => void,
    /** Opens the renderer's document another way, at most once; the frame then loads it as its first document. */
    private reopen?: () => void,
  ) {
    iframe.addEventListener('load', this.loaded)
    this.readyTimer = this.startReadyTimer()
  }

  /** The frame is opening its renderer's document another way: the renderer gets the full ready timeout again. */
  rearm(): void {
    this.view.clearTimeout(this.unansweredTimer)
    this.view.clearTimeout(this.readyTimer)
    this.readyTimer = this.startReadyTimer()
  }

  /**
   * The frame is about to load the document it opened: that load counts as its first. Only then, so a load of the
   * frame's own document meanwhile still counts against it.
   */
  reloading(): void {
    this.loads = 0
  }

  private startReadyTimer(): number {
    return this.view.setTimeout(() => {
      if (this.status !== 'loading') return
      if (!this.retry()) this.fail(`The renderer did not become ready within ${this.readyTimeoutMs / 1000} seconds`)
    }, this.readyTimeoutMs)
  }

  /** Reopens the renderer's document another way, if the frame can and hasn't yet. */
  private retry(): boolean {
    const reopen = this.reopen
    if (!reopen || this.stopped) return false
    this.reopen = undefined
    reopen()
    return true
  }

  /** Whether the frame has failed or been disposed. */
  get stopped(): boolean {
    return this.status === 'failed' || this.status === 'disposed'
  }

  /** The renderer became ready; false when it already was, or the frame has stopped. */
  ready(): boolean {
    if (this.status !== 'loading') return false
    this.status = 'ready'
    this.view.clearTimeout(this.readyTimer)
    this.view.clearTimeout(this.unansweredTimer)
    // A renderer that never acknowledges painting is shown anyway, rather than hidden forever.
    this.revealTimer = this.view.setTimeout(() => this.reveal(), rendererLimits.readyTimeoutMs)
    return true
  }

  reveal(): void {
    if (this.revealed || this.status !== 'ready') return
    this.revealed = true
    this.view.clearTimeout(this.revealTimer)
    this.iframe.style.opacity = ''
    this.iframe.dataset.revealed = 'true'
    this.onEvent({type: 'revealed'})
  }

  fail(message: string): void {
    if (this.stopped) return
    this.status = 'failed'
    this.stop()
    this.onEvent({type: 'failed', message})
  }

  dispose(): void {
    if (this.status === 'disposed') return
    this.status = 'disposed'
    this.stop()
  }

  private stop(): void {
    this.iframe.removeEventListener('load', this.loaded)
    this.view.clearTimeout(this.readyTimer)
    this.view.clearTimeout(this.unansweredTimer)
    this.view.clearTimeout(this.revealTimer)
    this.teardown()
  }

  private readonly loaded = () => {
    // A host that resolves the renderer's URL itself (an editor webview opening it as a Blob document) sets `src`
    // after the frame is attached, so the frame first loads its initial empty document: only the renderer's count.
    if (!this.iframe.getAttribute('src')) return
    this.loads++
    if (this.loads > 1) this.fail('The renderer navigated its frame and was stopped')
    else if (this.reopen && this.status === 'loading')
      this.unansweredTimer = this.view.setTimeout(() => {
        if (this.status === 'loading') this.retry()
      }, unansweredLoadMs)
  }
}

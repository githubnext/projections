import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrameEvent, RendererFrameStatus} from './types.js'

/**
 * A renderer frame's lifecycle: loading until its renderer is ready or the ready timeout passes, transparent until it
 * has painted, and stopped for good when it fails, navigates its frame or is disposed.
 */
export class FrameLifecycle {
  status: RendererFrameStatus = 'loading'
  /** Whether the frame is visible. It stays transparent until it has painted with the host theme. */
  revealed = false
  private loads = 0
  private readonly readyTimer: number
  private revealTimer: number | undefined

  constructor(
    private readonly view: Window,
    private readonly iframe: HTMLIFrameElement,
    readyTimeoutMs: number,
    private readonly onEvent: (event: RendererFrameEvent) => void,
    /** Releases everything else the frame holds, once it stops. */
    private readonly teardown: () => void,
  ) {
    iframe.addEventListener('load', this.loaded)
    this.readyTimer = view.setTimeout(() => {
      if (this.status === 'loading') this.fail(`The renderer did not become ready within ${readyTimeoutMs / 1000} seconds`)
    }, readyTimeoutMs)
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
    this.view.clearTimeout(this.revealTimer)
    this.teardown()
  }

  private readonly loaded = () => {
    // A host that resolves the renderer's URL itself (an editor webview opening it as a Blob document) sets `src`
    // after the frame is attached, so the frame first loads its initial empty document: only the renderer's count.
    if (!this.iframe.getAttribute('src')) return
    this.loads++
    if (this.loads > 1) this.fail('The renderer navigated its frame and was stopped')
  }
}

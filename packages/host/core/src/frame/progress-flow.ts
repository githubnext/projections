import type {ProgressPayload} from '@githubnext/projections-renderer-sdk/protocol'

/**
 * Flow control for progress: at most one progress value is unacknowledged; newer values replace any pending one and
 * are sent when the renderer acknowledges painting the previous one, or after `timeoutMs` without an acknowledgement.
 */
export class ProgressFlow {
  private inFlight: ProgressPayload | undefined
  private pending: ProgressPayload | undefined
  private timer: number | undefined

  constructor(
    private readonly view: Window,
    private readonly timeoutMs: number,
    private readonly post: (progress: ProgressPayload) => void,
  ) {}

  /** Forgets the unacknowledged and pending values, for new documents. */
  reset(): void {
    this.inFlight = undefined
    this.pending = undefined
  }

  /** Sends a progress now, or keeps it pending while another is unacknowledged. */
  offer(progress: ProgressPayload): void {
    if (this.inFlight) {
      this.pending = progress
      return
    }
    this.send(progress)
  }

  send(progress: ProgressPayload): void {
    this.inFlight = progress
    this.post(progress)
    this.view.clearTimeout(this.timer)
    this.timer = this.view.setTimeout(() => this.acknowledged(undefined), this.timeoutMs)
  }

  /** The renderer painted `progress` (`undefined` when the acknowledgement timed out): sends the pending value. */
  acknowledged(progress: number | undefined): void {
    if (progress !== undefined && this.inFlight && progress !== this.inFlight.progress) return
    this.view.clearTimeout(this.timer)
    this.inFlight = undefined
    const next = this.pending
    this.pending = undefined
    if (next) this.send(next)
  }

  dispose(): void {
    this.view.clearTimeout(this.timer)
  }
}

import {parseRendererMessage, rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererMessage} from '@githubnext/projections-renderer-sdk/protocol'

/** A message's size as JSON, `Infinity` when it can't be serialized. */
function size(value: unknown): number {
  try {
    return (JSON.stringify(value) as string | undefined)?.length ?? Infinity
  } catch {
    return Infinity
  }
}

/** A token bucket of `rendererLimits.messagesPerSecond`: whether each message is within the rate limit. */
class MessageRate {
  private tokens: number = rendererLimits.messagesPerSecond
  private refilled: number

  private readonly view: Window

  constructor(view: Window) {
    this.view = view
    this.refilled = view.performance.now()
  }

  allow(): boolean {
    const now = this.view.performance.now()
    const rate = rendererLimits.messagesPerSecond
    this.tokens = Math.min(rate, this.tokens + ((now - this.refilled) * rate) / 1000)
    this.refilled = now
    if (this.tokens < 1) return false
    this.tokens--
    return true
  }
}

/** What became of a message from the renderer's frame. */
export type Admission =
  | {type: 'message'; message: RendererMessage}
  /** Ignored: not from the renderer's frame. */
  | {type: 'foreign'}
  /** Dropped, and reported: malformed, oversized, or the first over the rate limit. */
  | {type: 'rejected'; reason: 'invalid' | 'oversized' | 'rate-limited'}
  /** Dropped silently: over the rate limit again. */
  | {type: 'dropped'}
  /** Dropped silently: a paint of an earlier document, sent before the renderer received the frame's latest `init`. */
  | {type: 'stale'}
  /** The frame must be stopped. */
  | {type: 'failed'; message: string}

/**
 * Admits a frame's messages: only from its window and an opaque origin, within the rate and size limits, on this channel, and only if
 * they validate strictly.
 */
export class MessageGate {
  private readonly rate: MessageRate
  private dropped = 0
  /** The generation of the frame's latest `init`, which the renderer's `rendered` echoes (see `HostMessage`). */
  generation = 0

  private readonly frame: HTMLIFrameElement
  private readonly channel: string

  constructor(view: Window, frame: HTMLIFrameElement, channel: string) {
    this.frame = frame
    this.channel = channel
    this.rate = new MessageRate(view)
  }

  admit(event: MessageEvent): Admission {
    if (event.source === null || event.source !== this.frame.contentWindow) return {type: 'foreign'}
    // A same-origin or other-origin document in this frame means the sandbox was not applied.
    if (event.origin !== 'null') return {type: 'failed', message: 'The renderer frame is not isolated in an opaque origin and was stopped'}
    if (!this.rate.allow()) {
      this.dropped++
      if (this.dropped === 1) return {type: 'rejected', reason: 'rate-limited'}
      if (this.dropped > rendererLimits.messagesPerSecond * 10) {
        return {type: 'failed', message: 'The renderer sent too many messages and was stopped'}
      }
      return {type: 'dropped'}
    }
    if (size(event.data) > rendererLimits.messageBytes) return {type: 'rejected', reason: 'oversized'}
    const message = parseRendererMessage(event.data, this.channel)
    if (!message) return {type: 'rejected', reason: 'invalid'}
    // A renderer that echoes no generation is taken at its word.
    const stale = message.type === 'rendered' && message.generation !== undefined && message.generation !== this.generation
    return stale ? {type: 'stale'} : {type: 'message', message}
  }
}

/** Recently requested frame heights, to recognize a layout feedback loop. */
export class HeightRequests {
  private heights: {px: number; at: number}[] = []

  private readonly view: Window

  constructor(view: Window) {
    this.view = view
  }

  /** The height to apply for a request: the requested one, clamped, or the largest recent one in a feedback loop. */
  settle(px: number): number {
    const requested = Math.min(rendererLimits.maxHeight, Math.max(rendererLimits.minHeight, Math.ceil(px)))
    const now = this.view.performance.now()
    this.heights = [...this.heights.filter(entry => now - entry.at < 1000), {px: requested, at: now}].slice(-8)
    // A height that returns to one requested moments ago (A, B, A) is a feedback loop, for example a page
    // scrollbar that appears when the frame grows and narrows it so it shrinks again. Settle on the largest.
    const earlier = this.heights.slice(0, -2)
    return earlier.some(entry => entry.px === requested) ? Math.max(...this.heights.map(entry => entry.px)) : requested
  }
}

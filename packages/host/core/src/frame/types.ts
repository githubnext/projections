import type {RendererDocumentOpener} from './documents.js'
import type {
  AnchorRect,
  InitPayload,
  ProgressPayload,
  RendererCapabilities,
  RendererControl,
  RendererLegend,
  RendererOptions,
  RendererSummary,
  ScrollPosition,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererDocuments} from '../registry.js'

/**
 * A renderer frame's lifecycle: `loading` until its renderer reports ready, then `ready`; `failed` when it reports an
 * error, misses the ready timeout or navigates its frame, and `disposed` once its host disposes it. Both are final.
 */
export type RendererFrameStatus = 'loading' | 'ready' | 'failed' | 'disposed'

/** Something the frame controller observed. Renderer messages are validated before they appear here. */
export type RendererFrameEvent =
  | {type: 'ready'; capabilities: RendererCapabilities}
  | {type: 'rendered'; progress: number}
  /** The frame became visible: after the renderer's first `rendered` or `error`, or when it never acknowledges painting. */
  | {type: 'revealed'}
  /** `path` is a property of the item, when the renderer draws properties. */
  | {type: 'select'; id: string | null; path?: string}
  | {type: 'height'; px: number}
  /** The shape (width / height) of the content the renderer fits to its stage. */
  | {type: 'aspect'; ratio: number}
  | {type: 'steps'; ends: number[]; slots?: number}
  | {type: 'open'; path: string; line?: number}
  | {type: 'hover'; id: string | null}
  /** Where an entity is drawn, in the frame's viewport (CSS px), or `null` when it isn't visible. */
  | {type: 'anchor'; id: string; rect: AnchorRect | null}
  /** The person scrolled a container in the renderer. */
  | ({type: 'viewport'} & ScrollPosition)
  /** The renderer replaced its declared controls. */
  | {type: 'controls'; controls: RendererControl[]}
  /** The person activated the annotation marker on an item. */
  | {type: 'annotation'; id: string}
  /** The renderer's legend for the host to draw; no items clears it. */
  | ({type: 'legend'} & RendererLegend)
  /** The renderer's words for the host's summary bar; no items returns it to the host's words. */
  | ({type: 'summary'} & RendererSummary)
  /** The renderer reported an error. Its frame keeps running. */
  | {type: 'error'; message: string}
  /** The host stopped the renderer: it timed out, navigated away or flooded the host. */
  | {type: 'failed'; message: string}
  /** A message from the frame was dropped because it was malformed, oversized or over the rate limit. */
  | {type: 'rejected'; reason: 'invalid' | 'oversized' | 'rate-limited'}

/**
 * The options of a `RendererFrame`: where to mount the sandboxed frame, which bundle to load, the state to send it
 * first, and how its events come back.
 */
export interface RendererFrameOptions {
  /** Element the frame is appended to. */
  container: HTMLElement
  /** Renderer bundle entry (its `index.html`). */
  url: string | URL
  /** Accessible name of the frame, for example `Graph renderer`. */
  title: string
  init: InitPayload
  progress?: ProgressPayload
  selection?: string | null
  options?: RendererOptions
  onEvent?: (event: RendererFrameEvent) => void
  readyTimeoutMs?: number
  /** Time to wait for a `rendered` acknowledgement before sending a newer progress anyway. */
  acknowledgementTimeoutMs?: number
  /**
   * Built-in renderer documents for a renderer that nests them (`document-request`), usually
   * `builtinRendererDocuments` of the host's catalog. Omitted, every request is refused.
   */
  builtinDocuments?: RendererDocuments
  /** Defaults to the container's window. */
  window?: Window
  /**
   * Fill the container's height instead of following the renderer's requested
   * content height; the renderer then scrolls inside the frame.
   */
  fill?: boolean
  /**
   * Opens the renderer's document as a Blob URL, for when the frame's document loads but its renderer doesn't answer
   * (an embedding browser that refuses to load the URL into a sandboxed frame): the frame then loads that document
   * instead, once. By default the page's (`setRendererDocuments`); `null` never does.
   */
  documents?: RendererDocumentOpener | null
}

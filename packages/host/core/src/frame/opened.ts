import {openedDocumentWorked, pageRendererDocuments} from './documents.js'
import type {RendererDocumentOpener} from './documents.js'
import type {FrameLifecycle} from './lifecycle.js'

/**
 * A frame's renderer document as its page opens it (a Blob document), for when the frame's URL doesn't reach the
 * renderer: which opener the frame uses, whether it starts with it, and the Blob URL it opened, revoked once the
 * renderer is ready or the frame stops.
 */
export class OpenedDocument {
  readonly opener: RendererDocumentOpener | undefined
  /** Whether the frame opens its document from the start, as an earlier frame on the page needed to. */
  readonly first: boolean
  private url: string | undefined

  constructor(documents: RendererDocumentOpener | null | undefined) {
    const page = pageRendererDocuments()
    this.opener = documents === null ? undefined : (documents ?? page.opener)
    this.first = this.opener !== undefined && documents === undefined && page.first
  }

  /** Whether the frame opens its document itself once its URL fails to reach the renderer. */
  get retries(): boolean {
    return this.opener !== undefined && !this.first
  }

  /** Opens the document at `url` and loads it into `iframe` with the same fragment, unless the renderer answered meanwhile. */
  open(iframe: HTMLIFrameElement, url: URL, lifecycle: FrameLifecycle): void {
    const opener = this.opener
    if (!opener) return
    lifecycle.rearm()
    opener(url).then(
      blob => {
        // A renderer that answered meanwhile (one slow to start) keeps its document.
        if (lifecycle.status !== 'loading') {
          URL.revokeObjectURL(blob)
          return
        }
        this.url = blob
        lifecycle.reloading()
        iframe.src = `${blob}${url.hash}`
      },
      (error: unknown) => {
        // Nor does a renderer that answered meanwhile depend on this document.
        if (lifecycle.status !== 'loading') return
        lifecycle.fail(`The renderer's document could not be opened: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }

  /** The frame's renderer is ready: later frames on the page start with an opened document if this one needed it. */
  ready(): void {
    if (this.url && this.opener) openedDocumentWorked(this.opener)
    this.revoke()
  }

  revoke(): void {
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = undefined
  }
}

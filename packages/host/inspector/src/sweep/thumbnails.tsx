import {useEffect, useMemo, useRef, useState} from 'react'
import {Tooltip, TooltipContent, TooltipTrigger} from '@githubnext/projections-host/ui/components'
import {LoaderCircle} from 'lucide-react'
import {InspectorRequestError} from '../transport.js'
import type {InspectorApi} from '../client/api.js'
import type {SweepCell} from '../types.js'
import {cellHref, cellSummary} from './stats.js'

/**
 * Requests for one thumbnail, when they time out: the runner finishes a render that
 * outlasts a request (a first one starts a cold browser) and keeps it for the next.
 */
const THUMBNAIL_ATTEMPTS = 3

/** Renders thumbnails one at a time, visible cells first, so a sweep never runs a browser per cell. */
export class ThumbnailQueue {
  readonly #api: InspectorApi
  readonly #urls = new Map<string, Promise<string>>()
  #tail: Promise<unknown> = Promise.resolve()

  constructor(api: InspectorApi) {
    this.#api = api
  }

  /** The cell's thumbnail as an object URL, once the thumbnails asked for before it are done. */
  load(cell: SweepCell): Promise<string> {
    const key = `${cell.projection}|${cell.before}|${cell.after}`
    let url = this.#urls.get(key)
    if (!url) {
      url = this.#tail.then(() => this.#thumbnail(cell)).then(blob => URL.createObjectURL(blob))
      this.#tail = url.catch(() => undefined)
      this.#urls.set(key, url)
    }
    return url
  }

  async #thumbnail(cell: SweepCell): Promise<Blob> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#api.sweepThumbnail(cell)
      } catch (error) {
        if (attempt >= THUMBNAIL_ATTEMPTS || !(error instanceof InspectorRequestError && error.status === 408)) throw error
      }
    }
  }
}

/** One `ThumbnailQueue` per runner. */
export function useThumbnailQueue(api: InspectorApi): ThumbnailQueue {
  return useMemo(() => new ThumbnailQueue(api), [api])
}

/** A changed cell: its Diff thumbnail once it scrolls into view, larger on hover or focus. */
export function ChangedCell({cell, label, queue}: {cell: SweepCell; label: string; queue: ThumbnailQueue}) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [state, setState] = useState<{url?: string; failed?: boolean}>({})
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let live = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      queue.load(cell).then(
        url => live && setState({url}),
        () => live && setState({failed: true}),
      )
    })
    observer.observe(element)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [cell, queue])
  // The link stays the tooltip's trigger before its thumbnail arrives, so the thumbnail arriving never remounts it
  // under a click or the keyboard's focus; the preview opens once there is one to show.
  return (
    <Tooltip open={preview && Boolean(state.url)} onOpenChange={setPreview}>
      <TooltipTrigger asChild>
        <a
          ref={ref}
          href={cellHref(cell)}
          className="pj:flex pj:flex-col pj:gap-1 pj:rounded-sm pj:text-xs"
          aria-label={`${label}: ${cellSummary(cell)}. Open in the Inspector`}
        >
          <span className="pi-sweep-thumbnail" aria-hidden="true">
            {state.url ? <img src={state.url} alt="" /> : state.failed ? null : <LoaderCircle className="pj:size-4 pj:animate-spin" />}
          </span>
          <span>{cellSummary(cell)}</span>
        </a>
      </TooltipTrigger>
      {/* Only a picture: where there's no room beside the cell (a phone) it lies over the link, so it never takes the click. */}
      {state.url && (
        <TooltipContent
          side="right"
          className="pi-sweep-preview pj:pointer-events-none pj:max-w-none pj:border pj:border-divider pj:bg-background pj:p-1 pj:text-foreground"
        >
          <img src={state.url} alt={`The Diff of ${label}`} />
        </TooltipContent>
      )}
    </Tooltip>
  )
}

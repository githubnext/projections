import type {AnnotationMark} from '@githubnext/projections-renderer-sdk/protocol'
import {cn} from './lib/utils.js'

/**
 * Marker tones never use change colors, so they don't read as added, removed or modified. Open threads
 * (`attention`) take the lens, the theme's only accent; the others stay neutral.
 */
const tones: Record<string, string> = {
  neutral: 'pj:border-border pj:bg-muted pj:text-muted-foreground pj:hover:bg-accent',
  attention: 'pj:border-transparent pj:bg-lens pj:text-lens-foreground pj:hover:bg-lens/90',
  done: 'pj:border-transparent pj:bg-muted pj:text-muted-foreground pj:hover:bg-accent',
  subtle: 'pj:border-dashed pj:border-input pj:bg-background pj:text-muted-foreground pj:hover:bg-muted',
}

/** The accessible name of a row's annotation marker. */
export function annotationName(mark: Pick<AnnotationMark, 'count' | 'label'>, rowLabel: string): string {
  return `${mark.label ?? (mark.count !== undefined && mark.count !== 0 ? `${mark.count} ${mark.count === 1 ? 'annotation' : 'annotations'}` : 'Annotation')} on ${rowLabel}`
}

/**
 * A small badge showing that an embedder annotated a presented row (for example with comments): the count, or a
 * dot. Activating it reports the activation to the embedder; the host draws no annotation content itself.
 */
export function AnnotationMarker({
  mark,
  rowLabel,
  onActivate,
  className,
}: {
  mark: AnnotationMark
  rowLabel: string
  onActivate: (rowId: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'ph-annotation pj:inline-flex pj:h-5 pj:min-w-5 pj:shrink-0 pj:items-center pj:justify-center pj:rounded-full pj:border pj:px-1.5 pj:align-middle pj:text-[11px] pj:font-semibold pj:leading-none pj:tabular-nums pj:transition-colors pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring',
        tones[mark.tone ?? 'neutral'],
        className,
      )}
      data-annotation-id={mark.id}
      data-tone={mark.tone ?? 'neutral'}
      aria-label={annotationName(mark, rowLabel)}
      title={annotationName(mark, rowLabel)}
      onClick={event => {
        event.stopPropagation()
        onActivate(mark.id)
      }}
    >
      {mark.count !== undefined && mark.count !== 0 ? (
        mark.count
      ) : (
        <span aria-hidden="true" className="pj:h-1.5 pj:w-1.5 pj:rounded-full pj:bg-current" />
      )}
    </button>
  )
}

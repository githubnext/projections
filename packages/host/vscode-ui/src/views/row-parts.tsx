import type {ReactNode} from 'react'
import type {AnnotationMark, Row} from '@githubnext/projections-host'
import {VscBadge} from '../elements.js'
import type {VscodeBuiltInViewProps} from './props.js'

/** The change hues a row can be drawn in; `moved` also marks a renamed, split or merged item. */
export type ChangeHue = 'added' | 'removed' | 'modified' | 'moved'

/** The change label for a row: its status, or how its identity changed, and the hue it is drawn in. */
export function changeLabel(row: Row): {text: string; hue: ChangeHue | undefined} | undefined {
  if (!row.status) return undefined
  if (row.status === 'unchanged' && row.correspondence && !['exact', 'none'].includes(row.correspondence)) {
    return {text: row.correspondence === 'declared' ? 'Renamed' : row.correspondence === 'split' ? 'Split' : 'Merged', hue: 'moved'}
  }
  return {
    added: {text: 'Added', hue: 'added' as const},
    removed: {text: 'Removed', hue: 'removed' as const},
    modified: {text: 'Modified', hue: 'modified' as const},
    unchanged: {text: 'Unchanged', hue: undefined},
  }[row.status]
}

/**
 * The change hue a row is drawn in (the renderer tokens' `color-<hue>-muted` fill and `color-<hue>-border` edge), or
 * undefined for an unchanged row.
 */
export function changeHue(row: Row): ChangeHue | undefined {
  return changeLabel(row)?.hue
}

/** A change label in VS Code's git decoration color for its hue (`--vscode-gitDecoration-*`). */
export function ChangeLabel({row}: {row: Row}) {
  const label = changeLabel(row)
  return label ? (
    <span className="phv-change-label" data-status={row.status} data-change={label.hue}>
      {label.text}
    </span>
  ) : null
}

/** The accessible description of a marker: its label, else its count. */
export function annotationText(mark: Pick<AnnotationMark, 'count' | 'label'>): string {
  return mark.label ?? (mark.count ? `${mark.count} ${mark.count === 1 ? 'annotation' : 'annotations'}` : 'Annotation')
}

/** A row's annotation marker: a comment codicon and VS Code's count badge; its tones never use change colors. */
export function AnnotationMarker({mark, row, onActivate}: {mark: AnnotationMark; row: Row; onActivate: (rowId: string) => void}) {
  return (
    <button
      type="button"
      className="ph-annotation phv-annotation"
      data-annotation-id={mark.id}
      data-tone={mark.tone ?? 'neutral'}
      aria-label={`${annotationText(mark)} on ${row.label}`}
      title={annotationText(mark)}
      onClick={() => onActivate(row.id)}
    >
      <span className="codicon codicon-comment" aria-hidden="true" />
      {mark.count ? (
        <VscBadge variant="counter" aria-hidden="true">
          {mark.count.toLocaleString()}
        </VscBadge>
      ) : null}
    </button>
  )
}

export function Marker({
  row,
  marks,
  onActivate,
}: {
  row: Row
  marks: VscodeBuiltInViewProps['marks']
  onActivate: VscodeBuiltInViewProps['onAnnotationActivate']
}) {
  const mark = marks?.get(row.id)
  return mark && onActivate ? <AnnotationMarker mark={mark} row={row} onActivate={onActivate} /> : null
}

export function SelectButton({
  row,
  selected,
  onSelect,
  children,
}: {
  row: Row
  selected: boolean
  onSelect: (id: string | null) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="phv-select"
      aria-pressed={selected}
      data-row-id={row.id}
      onClick={() => onSelect(selected ? null : row.id)}
    >
      {children}
    </button>
  )
}

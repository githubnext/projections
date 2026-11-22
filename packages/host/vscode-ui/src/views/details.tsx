import type {ReactNode} from 'react'
import {
  propertyPath,
  rowDetails,
  rowItems,
  sameTarget,
  type AnnotationMark,
  type ProjectionSelection,
  type ProjectionTarget,
  type Row,
  type TargetAnnotation,
  type ViewSubject,
} from '@githubnext/projections-host'
import type {Entity, Evidence, Relationship} from '@githubnext/projections-schemas'
import {Prose} from '../prose.js'
import {VariedList} from '../varied.js'
import {ActionButton, VscBadge} from '../elements.js'
import {uiCodicons} from '../codicons.js'
import {AnnotationMarker, ChangeLabel, annotationText} from './row-parts.js'

/** The props of `VscodeDetails`: the row to describe in its subject, and how to close it, open evidence and select. */
export interface VscodeDetailsProps {
  subject: ViewSubject
  row: Row
  close: () => void
  onOpen?: ((path: string, line?: number) => void) | undefined
  beforeLabel: string
  afterLabel: string
  /** The current selection; its `target` marks the selected property. */
  selection?: ProjectionSelection | null | undefined
  /** Called when a property is chosen (`ProjectionController.selectTarget`). Without it, properties aren't selectable. */
  onSelectTarget?: ((target: ProjectionTarget) => void) | undefined
  /** The row's annotation marker, and the annotations it combines (to mark annotated properties). */
  mark?: AnnotationMark | undefined
  annotations?: readonly TargetAnnotation[] | undefined
  onAnnotationActivate?: ((rowId: string) => void) | undefined
  /** Consumer content below the properties, for example discussion of the selection. */
  children?: ReactNode
}

const showValue = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/** The item's `data` properties as VS Code tree rows (a property codicon, the key and the value), each a selectable target. */
function Properties({
  item,
  target,
  selection,
  onSelectTarget,
  annotations,
}: {
  item: Entity | Relationship
  target: ProjectionTarget
  selection: ProjectionSelection | null | undefined
  onSelectTarget: ((target: ProjectionTarget) => void) | undefined
  annotations: readonly TargetAnnotation[]
}) {
  const entries = Object.entries(item.data ?? {})
  if (!entries.length) return <p className="phv-muted">No properties.</p>
  return (
    <ul className="phv-properties" aria-label={`Properties of ${item.id}`}>
      {entries.map(([key, value]) => {
        const path = propertyPath(key)
        const property = {...target, path}
        const selected = Boolean(selection?.target && sameTarget(selection.target, property))
        const marked = annotations.filter(annotation => sameTarget(annotation.target, property))
        const count = marked.reduce((sum, annotation) => sum + (annotation.count ?? 0), 0)
        const note = marked.length ? annotationText(marked.length === 1 ? marked[0]! : {count: count || marked.length}) : undefined
        const content = (
          <>
            <span className="codicon codicon-symbol-property phv-property-icon" aria-hidden="true" />
            <span className="phv-property-key">{key}</span>
            <span className="phv-property-value">{showValue(value)}</span>
            {note && (
              <VscBadge variant="counter" className="phv-property-mark" aria-hidden="true">
                {count || marked.length}
              </VscBadge>
            )}
            {note && <span className="phv-visually-hidden">, {note}</span>}
          </>
        )
        const attributes = {'data-property-path': path, 'data-side': target.side, 'data-selected': selected || undefined}
        return (
          <li key={key}>
            {onSelectTarget ? (
              <button
                type="button"
                className="phv-property"
                aria-pressed={selected}
                {...attributes}
                onClick={() => onSelectTarget(selected ? target : property)}
              >
                {content}
              </button>
            ) : (
              <div className="phv-property" {...attributes}>
                {content}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The selected item's identity, change, selectable properties and source evidence, then any consumer content: the raw
 * details for a docked panel (`RawDetails`), as a VS Code view section with tree rows. It never takes focus.
 */
export function VscodeDetails({
  subject,
  row,
  close,
  onOpen,
  beforeLabel,
  afterLabel,
  selection,
  onSelectTarget,
  mark,
  annotations = [],
  onAnnotationActivate,
  children,
}: VscodeDetailsProps) {
  const items = rowItems(subject, row)
  const location = (item: Evidence) => `${item.source}${item.location ? `:${item.location.line}` : ''}`
  const evidence = (item: Evidence, index: number) => (
    <li key={index}>
      <span className="codicon codicon-file-code phv-property-icon" aria-hidden="true" />
      {onOpen ? (
        <button type="button" className="phv-link phv-evidence-link" onClick={() => onOpen(item.source, item.location?.line)}>
          {location(item)}
        </button>
      ) : (
        <code className="phv-code">{location(item)}</code>
      )}{' '}
      <span className="phv-muted">{item.kind}</span>
    </li>
  )
  return (
    <aside
      className="ph-details phv-details"
      aria-labelledby={`phv-details-${row.id}`}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <header className="ph-details-header phv-details-header">
        <h3 tabIndex={-1} id={`phv-details-${row.id}`} className="phv-details-title">
          {row.label}
        </h3>
        {mark && onAnnotationActivate && <AnnotationMarker mark={mark} row={row} onActivate={onAnnotationActivate} />}
        <ActionButton icon={uiCodicons.close} label="Close details" onClick={close} />
      </header>
      <dl className="phv-facts">
        <dt>Identity</dt>
        <dd>
          <code className="phv-code">{row.id}</code>
        </dd>
        <dt>Kind</dt>
        <dd>{row.kind || '—'}</dd>
        {row.status && (
          <>
            <dt>Change</dt>
            <dd>
              <ChangeLabel row={row} />
              {row.summary ? (
                <span className="phv-muted">
                  {' '}
                  <Prose>{row.summary}</Prose>
                </span>
              ) : null}
            </dd>
          </>
        )}
      </dl>
      {row.varied?.length ? <VariedList varied={rowDetails(subject, row, [row]).varied} /> : null}
      {(['before', 'after'] as const).map(side =>
        items[side].map(item => (
          <section key={`${side}-${item.id}`} className="phv-details-item">
            <h4 className="phv-section-title">
              {subject.mode === 'comparison' ? `${side === 'before' ? beforeLabel : afterLabel}: ${item.id}` : item.id}
            </h4>
            {'from' in item && (
              <p>
                <code className="phv-code">{item.from}</code> → <code className="phv-code">{item.to}</code>
              </p>
            )}
            {item.confidence && <p className="phv-muted">Confidence: {item.confidence}</p>}
            <Properties
              item={item}
              target={{kind: row.collection === 'entities' ? 'entity' : 'relationship', id: item.id, side}}
              selection={selection}
              onSelectTarget={onSelectTarget}
              annotations={annotations}
            />
            {item.evidence?.length ? (
              <ul className="phv-evidence" aria-label="Source evidence">
                {item.evidence.map(evidence)}
              </ul>
            ) : (
              <p className="phv-muted">No source evidence.</p>
            )}
          </section>
        )),
      )}
      {children != null && children !== false && <div className="ph-details-slot phv-details-consumer">{children}</div>}
    </aside>
  )
}

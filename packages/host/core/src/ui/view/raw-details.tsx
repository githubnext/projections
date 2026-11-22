import {X} from 'lucide-react'
import type {Evidence} from '@githubnext/projections-schemas'
import type {ProjectionController} from '../../projection.js'
import {propertyPath} from '../../targets/pointer.js'
import {sameTarget, type ProjectionTarget} from '../../targets/target.js'
import {rowItems, statusLabel, type Row} from '../../model.js'
import {rowDetails} from '../../details.js'
import {AnnotationMarker} from '../annotations.js'
import {Prose} from '../prose.js'
import {statusTone} from '../views.js'
import {VariedList} from '../detail-card/values.js'
import {Badge} from '../components/badge.js'
import {Button} from '../components/button.js'
import {cn} from '../lib/utils.js'
import type {ProjectionViewProps} from './props.js'

/** A property value in one line: strings as written, everything else as JSON. */
function propertyText(value: unknown): string {
  return typeof value === 'string' ? value : (json(value) ?? String(value))
}

/** The item's `data` properties, each selectable as a target with a property path. */
function Properties({
  p,
  row,
  target,
  data,
}: {
  p: ProjectionController
  row: Row
  target: ProjectionTarget
  data: Record<string, unknown> | undefined
}) {
  const entries = Object.entries(data ?? {})
  if (!entries.length) return <p className="pj:text-xs pj:text-muted-foreground">No properties.</p>
  const annotations = p.annotationsFor(row.id)
  return (
    <ul
      className="ph-properties pj:flex pj:min-w-0 pj:flex-col pj:overflow-hidden pj:rounded-md pj:border pj:text-xs"
      aria-label={`Properties of ${target.id}`}
    >
      {entries.map(([key, value]) => {
        const property = {...target, path: propertyPath(key)}
        const selected = p.selection?.rowId === row.id && p.selection.target !== undefined && sameTarget(p.selection.target, property)
        const marks = annotations.filter(annotation => sameTarget(annotation.target, property))
        const count = marks.reduce((sum, annotation) => sum + (annotation.count ?? 1), 0)
        const text = propertyText(value)
        return (
          <li key={key} className="pj:[&+&]:border-t">
            <button
              type="button"
              className="ph-property pj:grid pj:w-full pj:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] pj:items-baseline pj:gap-2 pj:px-2 pj:py-1.5 pj:text-left pj:transition-colors pj:hover:bg-muted/60 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-inset pj:focus-visible:ring-ring pj:aria-pressed:bg-lens-muted pj:aria-pressed:shadow-[inset_2px_0_0_var(--pj-lens)]"
              data-property-path={property.path}
              data-side={target.side}
              aria-pressed={selected}
              data-selected={selected || undefined}
              title={text}
              onClick={() => {
                p.selectTarget(selected ? target : property)
              }}
            >
              <span className="pj:break-words pj:font-mono pj:font-medium">{key}</span>
              <span className="pj:line-clamp-3 pj:break-all pj:font-mono pj:text-muted-foreground">{text}</span>
              {count > 0 ? (
                <span className="ph-property-annotation pj:inline-flex pj:h-4 pj:min-w-4 pj:items-center pj:justify-center pj:rounded-full pj:border pj:border-border pj:bg-muted pj:px-1 pj:text-[10px] pj:font-semibold pj:text-muted-foreground">
                  {count}
                  <span className="pj:sr-only"> {count === 1 ? 'annotation' : 'annotations'}</span>
                </span>
              ) : (
                <span />
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The raw details of a row (by default the selection), for a docked panel such as the Inspector's: its identity, kind
 * and change, each side's item with its `data` properties as selectable targets and its evidence (links call
 * `onOpen`), and the embedder's `renderDetails` content in `.ph-details-slot`. Escape and "Close details" call
 * `onClose` (default: clear the selection). It never takes focus. Renders nothing without a row. The views show the
 * `DetailCard` instead.
 */
export function RawDetails({
  projection: p,
  row = p.selectedRow,
  onClose,
  onOpen,
  beforeLabel = 'Before',
  afterLabel = 'After',
  renderDetails,
}: {
  projection: ProjectionController
  row?: Row | null | undefined
  onClose?: () => void
  onOpen?: ((path: string, line?: number) => void) | undefined
  beforeLabel?: string
  afterLabel?: string
  renderDetails?: ProjectionViewProps['renderDetails'] | undefined
}) {
  if (!row) return null
  return (
    <Details
      p={p}
      row={row}
      close={onClose ?? (() => p.select(null))}
      onOpen={onOpen}
      beforeLabel={beforeLabel}
      afterLabel={afterLabel}
      renderDetails={renderDetails}
    />
  )
}

function Details({
  p,
  row,
  close,
  onOpen,
  beforeLabel,
  afterLabel,
  renderDetails,
}: {
  p: ProjectionController
  row: Row
  close: () => void
  onOpen?: ((path: string, line?: number) => void) | undefined
  beforeLabel: string
  afterLabel: string
  renderDetails?: ProjectionViewProps['renderDetails'] | undefined
}) {
  const {subject} = p
  const items = rowItems(subject, row)
  const kind = row.collection === 'entities' ? ('entity' as const) : ('relationship' as const)
  const mark = p.annotationMarks.find(item => item.id === row.id)
  const location = (item: Evidence) => `${item.source}${item.location ? `:${item.location.line}` : ''}`
  const evidence = (item: Evidence, index: number) => (
    <li key={index} className="pj:flex pj:min-w-0 pj:flex-wrap pj:items-baseline pj:gap-x-2">
      {onOpen ? (
        <button
          type="button"
          className="ph-link pj:min-w-0 pj:break-all pj:rounded-xs pj:text-left pj:font-mono pj:text-xs pj:underline pj:underline-offset-4 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring"
          onClick={() => onOpen(item.source, item.location?.line)}
        >
          {location(item)}
        </button>
      ) : (
        <code className="pj:break-all pj:font-mono pj:text-xs">{location(item)}</code>
      )}
      <span className="pj:text-xs pj:text-muted-foreground">{item.kind}</span>
    </li>
  )
  return (
    <aside
      className="ph-details pj:flex pj:min-w-0 pj:flex-col pj:gap-3 pj:self-start pj:rounded-lg pj:border pj:border-divider pj:bg-surface-raised pj:p-4 pj:text-sm pj:text-card-foreground pj:shadow-xs"
      aria-labelledby={`ph-details-${row.id}`}
    >
      {/* Escape closes the details from any control in them. */}
      <div
        role="presentation"
        className="pj:contents"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }}
      >
        <header className="ph-details-header pj:-mx-4 pj:-mt-4 pj:flex pj:items-center pj:justify-between pj:gap-2 pj:rounded-t-[calc(var(--pj-radius)-1px)] pj:border-b pj:border-divider pj:bg-surface-header pj:py-1.5 pj:pr-2 pj:pl-4">
          <div className="pj:flex pj:min-w-0 pj:items-center pj:gap-2">
            <h3
              tabIndex={-1}
              id={`ph-details-${row.id}`}
              className="pj:min-w-0 pj:break-words pj:font-semibold pj:leading-tight pj:focus-visible:outline-hidden"
            >
              {row.label}
            </h3>
            {mark && <AnnotationMarker mark={mark} rowLabel={row.label} onActivate={p.activateAnnotation} />}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="pj:h-7 pj:w-7 pj:shrink-0"
            aria-label="Close details"
            onClick={close}
          >
            <X />
          </Button>
        </header>
        <dl className="pj:grid pj:grid-cols-[auto_minmax(0,1fr)] pj:gap-x-3 pj:gap-y-1 pj:text-xs">
          <dt className="pj:text-muted-foreground">Identity</dt>
          <dd className="pj:break-all">
            <code className="pj:font-mono">{row.id}</code>
          </dd>
          <dt className="pj:text-muted-foreground">Kind</dt>
          <dd>{row.kind || '—'}</dd>
          {row.status && (
            <>
              <dt className="pj:text-muted-foreground">Change</dt>
              <dd className="pj:break-words">
                <Badge variant="outline" className={cn('pj:mr-1 pj:px-1.5 pj:py-0 pj:font-medium', statusTone[row.status])}>
                  {statusLabel(row.status)}
                </Badge>
                {row.correspondence && row.correspondence !== 'exact' ? ` · ${row.correspondence}` : ''}
                {row.summary ? (
                  <>
                    {' · '}
                    <Prose>{row.summary}</Prose>
                  </>
                ) : (
                  ''
                )}
              </dd>
            </>
          )}
        </dl>
        {(row.varied?.length ?? 0) > 0 ? <VariedList varied={rowDetails(subject, row, p.rows).varied} /> : null}
        {(['before', 'after'] as const).map(side =>
          items[side].map(item => (
            <section key={`${side}-${item.id}`} className="pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5 pj:border-t pj:pt-3" data-side={side}>
              <h4 className="pj:break-words pj:text-xs pj:font-semibold">
                {subject.mode === 'comparison' ? `${side === 'before' ? beforeLabel : afterLabel}: ${item.id}` : item.id}
              </h4>
              {'from' in item && (
                <p className="pj:text-xs pj:text-muted-foreground">
                  {item.from} → {item.to}
                </p>
              )}
              {item.confidence && <p className="pj:text-xs pj:text-muted-foreground">Confidence: {item.confidence}</p>}
              <Properties p={p} row={row} target={{kind, id: item.id, side}} data={item.data} />
              {item.evidence !== undefined && item.evidence.length > 0 ? (
                <ul className="ph-evidence pj:flex pj:flex-col pj:gap-1">{item.evidence.map(evidence)}</ul>
              ) : (
                <p className="pj:text-xs pj:text-muted-foreground">No source evidence.</p>
              )}
            </section>
          )),
        )}
        {renderDetails && p.selection && (
          <div className="ph-details-slot pj:flex pj:min-w-0 pj:flex-col pj:gap-2 pj:border-t pj:pt-3">{renderDetails(p.selection, p)}</div>
        )}
      </div>
    </aside>
  )
}

/** JSON, which `JSON.stringify` doesn't give for undefined, a function or a symbol, whatever its type says. */
function json(value: unknown): string | undefined {
  return JSON.stringify(value)
}

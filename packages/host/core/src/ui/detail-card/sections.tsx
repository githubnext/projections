import type {ProjectionController} from '../../projection.js'
import type {RowDetails} from '../../details.js'
import type {DetailConnection} from '../../details/connections.js'
import type {FieldChange} from '../../details/fields.js'
import type {Row} from '../../model.js'
import {sameTarget} from '../../targets/target.js'
import type {ProjectionTarget, TargetAnnotation} from '../../targets/target.js'
import {Prose} from '../prose.js'
import {statusTone} from '../views.js'
import {Badge} from '../components/badge.js'
import {cn} from '../lib/utils.js'
import {GeneratedList} from './generated.js'
import type {DetailCardProps} from './props.js'
import {ValueChange, VariedList} from './values.js'

/** A card section's heading, and the section: rules divide consecutive sections. */
export const heading = 'pj:text-xs pj:font-semibold pj:text-muted-foreground'
export const section = 'pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5 pj:px-3 pj:py-2.5 pj:[&+&]:border-t'

/** One field of "What changed": a selectable property target when it is item data, with its annotation count. */
function FieldRow({
  projection: p,
  row,
  change,
  marks,
}: {
  projection: ProjectionController
  row: Row
  change: FieldChange
  marks: readonly TargetAnnotation[]
}) {
  const kind = row.collection === 'entities' ? ('entity' as const) : ('relationship' as const)
  const itemTarget = (side: 'before' | 'after'): ProjectionTarget | undefined => {
    const itemId = side === 'before' ? row.before[0] : row.after[0]
    return itemId === undefined ? undefined : {kind, id: itemId, side}
  }
  const item = change.side && itemTarget(change.side)
  const property = item && change.path ? {...item, path: change.path} : undefined
  const value = <ValueChange before={change.before} after={change.after} />
  const name = <span className="ph-field-name pj:break-words pj:font-mono pj:text-xs pj:text-muted-foreground">{change.name}</span>
  if (!property || !item) {
    return (
      <li key={change.key} className="ph-field pj:flex pj:min-w-0 pj:flex-col pj:gap-0.5 pj:px-2 pj:py-1.5" data-field={change.key}>
        {name}
        {value}
      </li>
    )
  }
  const selected = p.selection?.rowId === row.id && p.selection.target !== undefined && sameTarget(p.selection.target, property)
  const count = marks
    .filter(annotation => sameTarget(annotation.target, property))
    .reduce((sum, annotation) => sum + (annotation.count ?? 1), 0)
  return (
    <li key={change.key} data-field={change.key}>
      <button
        type="button"
        className="ph-field pj:flex pj:w-full pj:min-w-0 pj:items-start pj:gap-2 pj:px-2 pj:py-1.5 pj:text-left pj:transition-colors pj:hover:bg-muted/60 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-inset pj:focus-visible:ring-ring pj:aria-pressed:bg-lens-muted pj:aria-pressed:shadow-[inset_2px_0_0_var(--pj-lens)]"
        data-property-path={property.path}
        data-side={property.side}
        aria-pressed={selected}
        data-selected={selected || undefined}
        onClick={() => {
          p.selectTarget(selected ? item : property)
        }}
      >
        <span className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col pj:gap-0.5">
          {name}
          {value}
        </span>
        {count > 0 && (
          <span className="ph-property-annotation pj:inline-flex pj:h-4 pj:min-w-4 pj:shrink-0 pj:items-center pj:justify-center pj:rounded-full pj:border pj:border-border pj:bg-muted pj:px-1 pj:text-[10px] pj:font-semibold pj:text-muted-foreground">
            {count}
            <span className="pj:sr-only"> {count === 1 ? 'annotation' : 'annotations'}</span>
          </span>
        )}
      </button>
    </li>
  )
}

/** The card's "What changed" (or, for one extraction, "Properties"): parts and tags, summary and fields. */
export function ChangesSection({
  projection: p,
  row,
  details,
  id,
  marks,
}: {
  projection: ProjectionController
  row: Row
  details: RowDetails
  id: string
  marks: readonly TargetAnnotation[]
}) {
  const comparing = p.subject.mode === 'comparison'
  const changed = details.parts.length > 0 || details.fields.length > 0
  return (
    <section className={cn('ph-detail-changes', section)} aria-labelledby={`${id}-changes`}>
      <h4 id={`${id}-changes`} className={heading}>
        {comparing ? 'What changed' : 'Properties'}
      </h4>
      {(details.parts.length > 0 || details.tags.length > 0) && (
        <p className="ph-detail-status pj:flex pj:flex-wrap pj:gap-1">
          {details.parts.map(part => (
            <Badge
              key={part.label}
              variant="outline"
              className={cn('ph-change-pill pj:px-1.5 pj:py-0 pj:font-medium', statusTone[part.hue])}
              data-change={part.hue}
            >
              {part.label}
            </Badge>
          ))}
          {details.tags.map(tag => (
            <Badge
              key={tag}
              variant="outline"
              className="ph-change-tag pj:px-1.5 pj:py-0 pj:font-normal pj:text-muted-foreground"
              data-tag={tag}
            >
              {tag}
            </Badge>
          ))}
        </p>
      )}
      {details.summary && (
        <p className="pj:text-xs pj:text-muted-foreground">
          <Prose>{details.summary}</Prose>
        </p>
      )}
      <GeneratedList generated={details.generated} />
      {details.fields.length > 0 ? (
        <ul
          className="ph-fields pj:-mx-1 pj:flex pj:min-w-0 pj:flex-col pj:overflow-hidden pj:rounded-md pj:border pj:[&>li+li]:border-t"
          aria-label="Fields"
        >
          {details.fields.map(change => (
            <FieldRow key={change.key} projection={p} row={row} change={change} marks={marks} />
          ))}
        </ul>
      ) : (
        comparing &&
        !(changed && (details.varied.length || details.generated.length)) && (
          <p className="pj:text-xs pj:text-muted-foreground">{changed ? 'No field changed.' : 'Unchanged.'}</p>
        )
      )}
      {details.moreFields > 0 && (
        <p className="pj:text-xs pj:text-muted-foreground">
          and {details.moreFields} more {details.moreFields === 1 ? 'field' : 'fields'}
        </p>
      )}
      <VariedList varied={details.varied} />
    </section>
  )
}

/** Where in the code: each evidence location as a link (`evidenceLink`), an open request (`onOpen`) or text. */
export function EvidenceSection({
  details,
  id,
  comparing,
  onOpen,
  evidenceLink,
  beforeLabel,
}: {
  details: RowDetails
  id: string
  comparing: boolean
  onOpen: DetailCardProps['onOpen']
  evidenceLink: DetailCardProps['evidenceLink']
  beforeLabel: string
}) {
  return (
    <section className={cn('ph-detail-evidence', section)} aria-labelledby={`${id}-evidence`}>
      <h4 id={`${id}-evidence`} className={heading}>
        Where in the code
      </h4>
      <ul className="ph-evidence pj:flex pj:min-w-0 pj:flex-col pj:gap-1">
        {details.evidence.map(location => {
          const text = `${location.path}${location.line ? `:${location.line}` : ''}`
          const href = evidenceLink?.({path: location.path, ...(location.line ? {line: location.line} : {})}, location.side)
          const link =
            'ph-link pj:min-w-0 pj:break-all pj:rounded-xs pj:text-left pj:font-mono pj:text-xs pj:underline pj:underline-offset-4 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring'
          return (
            <li
              key={`${location.side}:${text}`}
              className="pj:flex pj:min-w-0 pj:flex-wrap pj:items-baseline pj:gap-x-2"
              data-side={location.side}
            >
              {href ? (
                <a className={cn('ph-evidence-link', link)} href={href} target="_blank" rel="noreferrer noopener">
                  {text}
                </a>
              ) : onOpen ? (
                <button type="button" className={cn('ph-evidence-link', link)} onClick={() => onOpen(location.path, location.line)}>
                  {text}
                </button>
              ) : (
                <code className="pj:break-all pj:font-mono pj:text-xs">{text}</code>
              )}
              {comparing && location.side === 'before' && <span className="pj:text-xs pj:text-muted-foreground">{beforeLabel}</span>}
            </li>
          )
        })}
      </ul>
      {details.moreEvidence > 0 && <p className="pj:text-xs pj:text-muted-foreground">and {details.moreEvidence} more</p>}
    </section>
  )
}

const directionWords: Record<DetailConnection['direction'], string> = {outgoing: '→', incoming: '←', from: 'From', to: 'To'}

/** A connection's accessible name: its direction for an endpoint, the row's label and its change. */
function connectionLabel(connection: DetailConnection): string {
  const direction = connection.direction === 'from' ? 'From: ' : connection.direction === 'to' ? 'To: ' : ''
  const parts = connection.parts.length ? `, ${connection.parts.map(part => part.label).join(', ')}` : ''
  return `${direction}${connection.rowLabel}${parts}`
}

/** The item's connections, each selecting its item (`onSelect`). */
export function ConnectionsSection({details, id, onSelect}: {details: RowDetails; id: string; onSelect: (rowId: string) => void}) {
  return (
    <section className={cn('ph-detail-connections', section)} aria-labelledby={`${id}-connections`}>
      <h4 id={`${id}-connections`} className={heading}>
        Connections
      </h4>
      <ul className="ph-connections pj:-mx-1 pj:flex pj:min-w-0 pj:flex-col">
        {details.connections.map(connection => (
          <li key={`${connection.direction}:${connection.rowId}`}>
            <button
              type="button"
              className="ph-connection pj:flex pj:w-full pj:min-w-0 pj:items-baseline pj:gap-1.5 pj:rounded-sm pj:px-1 pj:py-1 pj:text-left pj:text-xs pj:transition-colors pj:hover:bg-muted/60 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring"
              data-connection-id={connection.rowId}
              data-direction={connection.direction}
              aria-label={connectionLabel(connection)}
              onClick={() => onSelect(connection.rowId)}
            >
              <span aria-hidden="true" className="pj:shrink-0 pj:text-muted-foreground">
                {directionWords[connection.direction]}
              </span>
              <span className="pj:min-w-0 pj:break-words pj:font-medium pj:underline pj:decoration-muted-foreground/40 pj:underline-offset-4">
                {connection.label}
              </span>
              {(connection.direction === 'outgoing' || connection.direction === 'incoming') && connection.kind && (
                <span className="pj:text-muted-foreground">{connection.kind}</span>
              )}
              {connection.parts.map(part => (
                <Badge
                  key={part.label}
                  variant="outline"
                  className={cn('ph-change-pill pj:ml-auto pj:h-4 pj:px-1 pj:py-0 pj:text-[10px] pj:font-medium', statusTone[part.hue])}
                  data-change={part.hue}
                >
                  {part.label}
                </Badge>
              ))}
            </button>
          </li>
        ))}
      </ul>
      {details.moreConnections > 0 && <p className="pj:text-xs pj:text-muted-foreground">and {details.moreConnections} more</p>}
    </section>
  )
}

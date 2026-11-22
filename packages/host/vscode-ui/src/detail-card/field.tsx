import {
  sameTarget,
  type FieldChange,
  type ProjectionController,
  type ProjectionTarget,
  type Row,
  type TargetAnnotation,
} from '@githubnext/projections-host'
import {VscBadge} from '../elements.js'
import {ValueChange} from './value-change.js'

/** The item on one side of the row, as a target its fields belong to. */
function itemTarget(row: Row, side: 'before' | 'after'): ProjectionTarget | undefined {
  const kind = row.collection === 'entities' ? ('entity' as const) : ('relationship' as const)
  const itemId = side === 'before' ? row.before[0] : row.after[0]
  return itemId === undefined ? undefined : {kind, id: itemId, side}
}

/** The annotations on a field, counted. */
function AnnotationCount({count}: {count: number}) {
  return count > 0 ? (
    <span className="phv-property-mark">
      <VscBadge variant="counter" aria-hidden="true">
        {count}
      </VscBadge>
      <span className="phv-visually-hidden">
        {' '}
        {count} {count === 1 ? 'annotation' : 'annotations'}
      </span>
    </span>
  ) : null
}

/**
 * One field of the card: its name and value change, and, when it is a property of an item, a button selecting that
 * property (again: its item) with the count of annotations on it.
 */
export function FieldRow({
  change,
  projection: p,
  row,
  marks,
}: {
  change: FieldChange
  projection: ProjectionController
  row: Row
  marks: readonly TargetAnnotation[]
}) {
  const item = change.side && itemTarget(row, change.side)
  const property = item && change.path ? {...item, path: change.path} : undefined
  const content = (
    <>
      <code className="phv-property-key">{change.name}</code>
      <ValueChange before={change.before} after={change.after} />
    </>
  )
  if (!property || !item) {
    return (
      <li data-field={change.key}>
        <div className="phv-field">{content}</div>
      </li>
    )
  }
  const selected = p.selection?.rowId === row.id && p.selection.target !== undefined && sameTarget(p.selection.target, property)
  const count = marks
    .filter(annotation => sameTarget(annotation.target, property))
    .reduce((sum, annotation) => sum + (annotation.count ?? 1), 0)
  return (
    <li data-field={change.key}>
      <button
        type="button"
        className="phv-field"
        data-property-path={property.path}
        data-side={property.side}
        aria-pressed={selected}
        data-selected={selected || undefined}
        onClick={() => p.selectTarget(selected ? item : property)}
      >
        {content}
        <AnnotationCount count={count} />
      </button>
    </li>
  )
}

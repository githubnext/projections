import type {DataOf, Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'

/** A column's typed data, which the engine guarantees for every `database/v0` column; other kinds have none. */
function columnData(entity: Entity): DataOf<'database/v0', 'entities', 'column'> | undefined {
  return entity.kind === 'column' ? (entity.data as DataOf<'database/v0', 'entities', 'column'>) : undefined
}

/**
 * The most specific type a column states: its native database type
 * (`data.databaseType`, such as `varchar(200)`) when the extractor knows it,
 * otherwise `data.type`. A nullable column ends in `?`.
 */
export function columnType(entity: Entity): string {
  return `${baseType(entity)}${columnData(entity)?.nullable ? '?' : ''}`
}

/** A column's shown type without its nullability: `databaseType`, otherwise `type`. */
export function baseType(entity: Entity): string {
  const data = columnData(entity)
  return data ? data.databaseType || data.type : ''
}

/** The declared type behind a shown native type (`CharField` behind `varchar(200)`), when they differ. */
export function declaredType(entity: Entity): string | undefined {
  const data = columnData(entity)
  return data?.databaseType && data.type !== data.databaseType ? data.type : undefined
}

/** A column's type change in words, for titles and assistive technology: `type varchar(120) to varchar(200)`. */
export function typeChange(change: EntityChange<Entity>): string | undefined {
  if (!change.before || !change.after) return undefined
  const from = columnType(change.before),
    to = columnType(change.after)
  return from === to ? undefined : `type ${from} to ${to}`
}

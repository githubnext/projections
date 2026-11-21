import type {Entity} from '@githubnext/projections-schemas'

/** Tables and views are both cards of columns; an enum is a card of its values. */
export const isTable = (entity: Entity | undefined) => entity?.kind === 'table' || entity?.kind === 'view'
export const isEnum = (entity: Entity | undefined) => entity?.kind === 'enum'
export const isCard = (entity: Entity | undefined) => isTable(entity) || isEnum(entity)
export const isColumn = (entity: Entity | undefined) => entity?.kind === 'column'

export function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Column names a key or index declares: `data.columns`, or Prisma's `data.fields` (`[{name}]`). */
export function keyColumnNames(entity: Entity): string[] {
  const columns = names(entity.data?.columns)
  if (columns.length) return columns
  const fields = entity.data?.fields
  return Array.isArray(fields)
    ? fields.flatMap(field =>
        typeof field === 'string'
          ? [field]
          : typeof field === 'object' && field !== null && !Array.isArray(field) && typeof field.name === 'string'
            ? [field.name]
            : [],
      )
    : []
}

/** Kinds other extractors name differently: EF Core's `unique-key` and `check-constraint`. */
const keyAliases: Record<string, string> = {'unique-key': 'unique', 'check-constraint': 'check'}

/**
 * A key's kind: a constraint's `data.type` (`primary-key`, `unique`…), or the entity kind itself (`index`,
 * `primary-key`, EF Core's `unique-key`), with EF Core's names read as the kinds they are (`unique`, `check`).
 */
export function keyType(entity: Entity): string {
  const declared = entity.data?.type
  const type = (entity.kind === 'constraint' || entity.kind === 'key') && typeof declared === 'string' ? declared : entity.kind
  return keyAliases[type] ?? type
}
export const isPrimaryKey = (entity: Entity | undefined) => entity !== undefined && keyType(entity) === 'primary-key'

export const keyKinds: Record<string, [marker: string, title: string]> = {
  'primary-key': ['PK', 'Primary key'],
  'foreign-key': ['FK', 'Foreign key'],
  unique: ['UK', 'Unique'],
  index: ['IX', 'Index'],
  check: ['CK', 'Check'],
}
export const keyOrder = Object.keys(keyKinds)

/** An enum's values: `data.values`, as strings or `{name}` objects. */
export function enumValues(entity: Entity): string[] {
  const values = entity.data?.values
  return Array.isArray(values)
    ? values.flatMap(value =>
        typeof value === 'string'
          ? [value]
          : typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.name === 'string'
            ? [value.name]
            : [],
      )
    : []
}

/** The row ID of an enum's value: stable across revisions, so a value that stays keeps its row. */
export const enumValueId = (enumId: string, value: string) => `${enumId}\u0000value:${value}`

// The data fields a document's cards can show, and how an entity reads in each.
import type {Entity} from '@githubnext/projections-schemas'
import {isCardIconName, type ComparisonModel} from '@githubnext/projections-renderer-kit'

/** Choice values longer than this aren't offered (the protocol's limit), so neither are fields with longer pointers. */
const choiceLength = 64
/** Most fields offered per control, within the protocol's 50 choices beside `none` and `kind`. */
export const fieldLimit = 40

/** A top-level data field as an RFC 6901 JSON pointer (`/data/capabilities`). */
export function fieldPointer(field: string): string {
  return `/data/${field.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

/** The data field a `/data/<field>` pointer names, or undefined for anything else. */
export function pointerField(pointer: string): string | undefined {
  const match = /^\/data\/([^/]+)$/u.exec(pointer)
  return match ? match[1]!.replaceAll('~1', '/').replaceAll('~0', '~') : undefined
}

type Scalar = string | number | boolean
const scalar = (value: unknown): value is Scalar => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/** A document's data fields by what they can show (see `factFields`). */
export interface FactFields {
  badges: string[]
  colors: string[]
  /** Fields whose every value is a number: what cards can be sized by. */
  numbers: string[]
  /** Fields whose every value is a string: what a card's subtitle can say. */
  texts: string[]
  /** Fields of strings at least one of which names a card icon (`cardIconNames`): what can pick a card's icon. */
  icons: string[]
}

/**
 * The data fields of a document that can be badges (every value a string, number or boolean, or an array of them),
 * that can color cards (every value a string, number or boolean), that can size cards (every value a number) and that
 * can be a subtitle (every value a string), and that can pick an icon (a subtitle's field with at least one value that
 * names a card icon), in name order. A field set on no entity is none of them.
 */
export function factFields(model: ComparisonModel): FactFields {
  const seen = new Map<string, {badge: boolean; color: boolean; number: boolean; text: boolean; icon: boolean}>()
  for (const row of model.entities) {
    for (const entity of [row.before, row.after]) {
      for (const [field, value] of Object.entries(entity?.data ?? {})) {
        const known = seen.get(field) ?? {badge: true, color: true, number: true, text: true, icon: false}
        const list = Array.isArray(value) && value.every(scalar)
        seen.set(field, {
          badge: known.badge && (scalar(value) || list),
          color: known.color && scalar(value),
          number: known.number && typeof value === 'number' && Number.isFinite(value),
          text: known.text && typeof value === 'string',
          icon: known.icon || isCardIconName(value),
        })
      }
    }
  }
  const fields = [...seen]
    .filter(([field]) => fieldPointer(field).length <= choiceLength)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return {
    badges: fields.filter(([, use]) => use.badge).map(([field]) => field),
    colors: fields.filter(([, use]) => use.color).map(([field]) => field),
    numbers: fields.filter(([, use]) => use.number).map(([field]) => field),
    texts: fields.filter(([, use]) => use.text).map(([field]) => field),
    icons: fields.filter(([, use]) => use.text && use.icon).map(([field]) => field),
  }
}

/** An entity's number in a data field, for sizing its card; nothing for another value. */
export function numberValue(entity: Entity, field: string): number | undefined {
  const value = entity.data?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** An entity's text in a data field, for its subtitle; nothing for another value or an empty one. */
export function textValue(entity: Entity, field: string): string | undefined {
  const value = entity.data?.[field]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** The card icon an entity's data field names, for its card; nothing for a value outside `cardIconNames`. */
export function iconValue(entity: Entity, field: string): string | undefined {
  const value = entity.data?.[field]
  return isCardIconName(value) ? value : undefined
}

/** An entity's badges from a data field: an array's items, a string or number itself, and a true boolean the field's name. */
export function badgeValues(entity: Entity, field: string): string[] {
  const value = entity.data?.[field]
  if (Array.isArray(value)) return value.filter(scalar).map(String)
  if (value === true) return [field]
  return typeof value === 'string' || typeof value === 'number' ? [String(value)] : []
}

/** What colors a card: `kind`, or a data field's value. A boolean reads as the field's name, or `not` and the name. */
export function colorValue(entity: Entity, by: string): string | undefined {
  if (by === 'kind') return entity.kind
  const field = pointerField(by)
  const value = field === undefined ? undefined : entity.data?.[field]
  if (typeof value === 'boolean') return value ? field : `not ${field}`
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

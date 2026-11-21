import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from './presentation.js'

/** A measured value with its unit. */
export interface Quantity {
  /** An exact label such as `ms` or `lines of code`, compared as text and never converted; empty when unknown. */
  unit: string
  /** The finite measurement, or `undefined` when it is missing, which is not the same as zero. */
  value: number | undefined
}
/** The range a scale covers for one unit, always including zero (`quantityDomains`). */
export interface QuantityDomain {
  /** The smallest value, at most 0. */
  min: number
  /** The largest value, at least 0. */
  max: number
}
/** Where a bar sits on a zero-anchored track, as fractions of the track's length from its start (0 to 1). */
export interface QuantityGeometry {
  /** Where zero is: 0 for a domain without negatives, further in when it has some. */
  zero: number
  /** Where the bar starts: at `zero` for a positive value, at the value for a negative one. */
  left: number
  /** The bar's length, never negative; 0 for a missing value. */
  width: number
}

/**
 * The quantity an entity records in `data[key]` (default `value`), in `unit` or else its `data.unit`. The value is
 * `undefined` when the entity is absent, the field isn't a finite number, or the entity sets `data.defined` to `false`.
 */
export function entityQuantity(entity: Entity | undefined, key = 'value', unit?: string): Quantity {
  const value = entity?.data?.[key]
  return {
    unit: unit ?? (typeof entity?.data?.unit === 'string' ? entity.data.unit : ''),
    value: entity?.data?.defined !== false && typeof value === 'number' && Number.isFinite(value) ? value : undefined,
  }
}

/** Units are exact labels, not conversion instructions. Missing measurements are not zero. */
export function quantityAt(change: EntityChange<Entity>, progress: number, key = 'value', unit?: string): Quantity {
  const a = entityQuantity(change.before, key, unit),
    b = entityQuantity(change.after, key, unit)
  if (!change.before) return b
  if (!change.after) return a
  if (a.unit !== b.unit || a.value === undefined || b.value === undefined) return progress < 0.5 ? a : b
  return {unit: a.unit, value: a.value * (1 - progress) + b.value * progress}
}

/** One zero-anchored domain per unit, computed from both unfiltered endpoints. */
export function quantityDomains(quantities: Iterable<Quantity>): Map<string, QuantityDomain> {
  const domains = new Map<string, QuantityDomain>()
  for (const {unit, value} of quantities) {
    if (value === undefined) continue
    const domain = domains.get(unit) ?? {min: 0, max: 0}
    domain.min = Math.min(domain.min, value)
    domain.max = Math.max(domain.max, value)
    domains.set(unit, domain)
  }
  return domains
}

/**
 * Lays `value` out on a track for `domain`, scaled so the domain's largest magnitude spans it: zero-anchored, so
 * negative values extend left of `zero` and positive ones right. A missing value, or an all-zero domain, has no width.
 */
export function quantityGeometry(value: number | undefined, domain: QuantityDomain): QuantityGeometry {
  const magnitude = Math.max(Math.abs(domain.min), domain.max)
  if (!magnitude) return {zero: 0, left: 0, width: 0}
  const low = domain.min / magnitude,
    span = domain.max / magnitude - low
  const zero = domain.min === 0 ? 0 : -low / span
  const position = value === undefined ? zero : (value / magnitude - low) / span
  return {zero, left: Math.min(zero, position), width: Math.abs(position - zero)}
}

/**
 * Each value's share of their total, summing to 1, for share charts; all zeros when every value is 0. `undefined`
 * when any value is missing, negative or not finite, since a share of an unknown or negative total means nothing.
 */
export function quantityShares(values: readonly (number | undefined)[]): number[] | undefined {
  if (values.some(value => value === undefined || !Number.isFinite(value) || value < 0)) return undefined
  const maximum = values.reduce<number>((largest, value) => Math.max(largest, value ?? 0), 0)
  if (!maximum) return values.map(() => 0)
  const normalized = values.map(value => value! / maximum)
  const total = normalized.reduce((sum, value) => sum + value, 0)
  return normalized.map(value => value / total)
}

export * from './statistics.js'

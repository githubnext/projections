// Which relationships mean containment, by an extraction's domain schema and vocabularies.
import type {Extraction, Relationship} from '@githubnext/projections-schemas'

/**
 * Containment a domain schema or vocabulary defines beyond `contains`: relationship kinds, or the entity kinds at a
 * relationship's ends whatever its own kind (a vocabulary that names its structure by its entities).
 */
interface Containment {
  kinds?: readonly string[]
  ends?: readonly (readonly [from: string, to: string])[]
}
const containmentByName: Readonly<Record<string, Containment>> = {
  // A table holds its columns, its primary key and its indexes.
  'database/v0': {kinds: ['constraint', 'index']},
  // A service holds its registrations, and a registration the implementation it produces (the vocabulary's structure is
  // its entity kinds; docs/models/dependency-injection-model.md).
  'dependency-injection/v0': {
    ends: [
      ['service', 'registration'],
      ['registration', 'implementation'],
    ],
  },
}

/** The parts of an extraction `isContainment` reads. */
export type ContainmentSource = Pick<Extraction, 'schema' | 'vocabularies' | 'entities' | 'relationships'>

/**
 * Whether a relationship of an extraction means containment (`from` contains `to`): `contains` in every schema, and the
 * containment its domain schema and vocabularies define (a database table's `constraint` and `index`; a
 * dependency-injection service's registrations and a registration's implementation, by their entity kinds).
 */
export function isContainment(extraction: ContainmentSource): (relationship: Relationship) => boolean {
  const rules = [extraction.schema, ...(extraction.vocabularies ?? [])].flatMap(name => containmentByName[name] ?? [])
  const kinds = new Set(['contains', ...rules.flatMap(rule => rule.kinds ?? [])])
  const ends = new Set(rules.flatMap(rule => (rule.ends ?? []).map(([from, to]) => `${from}\n${to}`)))
  const kindOf = ends.size ? new Map(extraction.entities.map(entity => [entity.id, entity.kind])) : undefined
  return relationship =>
    kinds.has(relationship.kind) || Boolean(kindOf && ends.has(`${kindOf.get(relationship.from)}\n${kindOf.get(relationship.to)}`))
}

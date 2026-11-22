// What the comparison checks share: how entities look and differ, what each step touches and which entities changed.
import type {Comparison, Extraction} from '@githubnext/projections-schemas'
import type {EntitySample, StageSubject} from '../../types.js'

/** The properties measure/paint.ts paints, in its order, then the element's opacity. */
const paintNames = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-style',
  'outline-color',
  'outline-width',
  'box-shadow',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'filter',
  'text-decoration',
  'font-weight',
  'opacity',
]

export function looks(sample: EntitySample): string {
  return `${sample.paint}\n${sample.text}`
}

export function difference(a: EntitySample, b: EntitySample): string {
  if (a.text !== b.text) return `its text changes from "${a.text.slice(0, 60)}" to "${b.text.slice(0, 60)}"`
  if (a.opacity !== b.opacity) return `its opacity changes from ${a.opacity} to ${b.opacity}`
  if (a.box.join(',') !== b.box.join(',')) return `it moves from [${a.box.join(', ')}] to [${b.box.join(', ')}]`
  const left = a.paint.split(';'),
    right = b.paint.split(';')
  const index = left.findIndex((part, at) => part !== right[at])
  if (index < 0) return 'its paint changes'
  // The element's painted properties, in measure/paint.ts's order, before and after, so a failure says what changed.
  const values = (part: string | undefined) => part?.slice(part.indexOf(':') + 1).split('|') ?? []
  const [from, to] = [values(left[index]), values(right[index])]
  const changed = from.flatMap((value, at) => (value !== to[at] ? [`${paintNames[at] ?? at}: ${value} → ${to[at]}`] : []))
  return `its paint changes (${left[index]?.split(':')[0]?.toLowerCase() ?? 'element'} ${index}: ${changed.join(', ').slice(0, 300)})`
}

/**
 * Items whose change varied only within tolerance (`unchanged`, with `varied`): they belong to no step and must be
 * painted exactly as unchanged items, at every progress and in the diff.
 */
export function variedWithin(subject: Extract<StageSubject, {mode: 'comparison'}>): Set<string> {
  return new Set(
    subject.comparison.changes.flatMap(change =>
      change.status === 'unchanged' && (change.varied?.length ?? 0) > 0 ? [change.id, ...change.before, ...change.after] : [],
    ),
  )
}

/** IDs each step touches: changed entities and relationships, and the endpoints of changed relationships. */
export function touched(subject: Extract<StageSubject, {mode: 'comparison'}>): Set<string>[] {
  const changes = new Map(subject.comparison.changes.map(change => [change.id, change]))
  const ends = (extraction: Extraction, id: string) => {
    const relationship = extraction.relationships.find(item => item.id === id)
    return relationship ? [relationship.from, relationship.to] : []
  }
  return subject.comparison.steps.map(
    step =>
      new Set(
        step.changes.flatMap(id => {
          const change = changes.get(id)
          if (!change) return []
          if (change.collection === 'entities') return [...change.before, ...change.after]
          return [
            ...change.before,
            ...change.after,
            ...change.before.flatMap(item => ends(subject.before, item)),
            ...change.after.flatMap(item => ends(subject.after, item)),
          ]
        }),
      ),
  )
}

export function pick<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) return [...values]
  return Array.from({length: count}, (_, index) => values[Math.round((index * (values.length - 1)) / (count - 1))]!)
}

/** Entity IDs a change adds, removes, modifies or renames, with the change's own ID. */
export function changedEntities(comparison: Comparison): Comparison['changes'] {
  return comparison.changes.filter(
    change =>
      change.collection === 'entities' && (change.status !== 'unchanged' || change.before.join('\u0000') !== change.after.join('\u0000')),
  )
}

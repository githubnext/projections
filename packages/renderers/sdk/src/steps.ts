import type {Comparison, Step} from '@githubnext/projections-schemas'

/**
 * What a step does, which decides its choreography (`stepWindows` in the kit): `remove` fades items out, then closes
 * the gap; `add` makes room, then fades items in; `restructure` moves and rewires what stays.
 */
export type StepKind = 'remove' | 'restructure' | 'add'

/**
 * One comparison step in presented-row space. `kind` is inferred from the
 * entity members' statuses (all removed: `remove`, all added: `add`,
 * otherwise `restructure`; a step with no entities keeps its declared kind),
 * so a step without a declared kind, or with a kind that contradicts its
 * members, still animates coherently. `declaredKind` keeps the comparator's
 * own label.
 */
export interface PresentedStep {
  /** The step's position in its order, from 0; a final step for unplaced changes comes last. */
  index: number
  /** The kind the step animates as, inferred from its entity rows. */
  kind: StepKind
  /** The kind the comparator declared, when it declared one. */
  declaredKind?: StepKind
  /** The comparator's one-line description of the step, for captions; absent when it gave none. */
  summary?: string
  /** Presented entity row IDs that change in this step. */
  entities: string[]
  /** Presented relationship row IDs that change in this step. */
  relationships: string[]
  /** Whether the step removes an entity or relationship (absent: whether `kind` is `remove`). */
  removes?: boolean
  /** Whether the step adds an entity or relationship (absent: whether `kind` is `add`). */
  adds?: boolean
}

/** The comparison's presentation order in presented-row space. */
export interface PresentedOrder {
  /** Steps in forward presentation order. */
  steps: PresentedStep[]
  /** How playing backward orders steps: the forward steps reversed, or `reverseSteps`. */
  reverse: 'mirror' | 'explicit'
  /** Backward presentation order (first presented when leaving progress 1) when `reverse` is `explicit`. */
  reverseSteps?: PresentedStep[]
}

interface Row {
  id: string
  before?: {id: string} | undefined
  after?: {id: string} | undefined
  status: string
}

/** Entities decide a step's kind; a step of relationships alone keeps its declared kind. */
function inferKind(members: readonly Row[], declared: StepKind | undefined): StepKind {
  if (!members.length) return declared ?? 'restructure'
  if (members.every(member => member.status === 'added')) return 'add'
  if (members.every(member => member.status === 'removed')) return 'remove'
  return 'restructure'
}

/**
 * Resolves a comparison's steps (and explicit `reverseSteps`) from change IDs
 * to the presented rows that show them, including further split parts and
 * merged sources. A validated comparison places every change; anything left
 * over still animates, in a final step.
 */
export function presentOrder(rows: {entities: readonly Row[]; relationships: readonly Row[]}, comparison: Comparison): PresentedOrder {
  const rowsOf = new Map<string, {collection: 'entities' | 'relationships'; rows: string[]}>()
  for (const collection of ['entities', 'relationships'] as const) {
    const byAfter = new Map<string, string>(),
      byBefore = new Map<string, string>()
    for (const row of rows[collection]) {
      if (row.after) byAfter.set(row.after.id, row.id)
      if (row.before) byBefore.set(row.before.id, row.id)
    }
    for (const change of comparison.changes.filter(change => change.collection === collection)) {
      const ids = new Set<string>([change.id])
      for (const id of change.after.slice(1)) {
        const row = byAfter.get(id)
        if (row) ids.add(row)
      }
      for (const id of change.before.slice(1)) {
        const row = byBefore.get(id)
        if (row) ids.add(row)
      }
      rowsOf.set(change.id, {collection, rows: [...ids]})
    }
  }
  const rowById = new Map<string, Row>([...rows.entities, ...rows.relationships].map(row => [row.id, row]))
  const membership = (ids: readonly string[]) => ({
    removes: ids.some(id => rowById.get(id)?.status === 'removed'),
    adds: ids.some(id => rowById.get(id)?.status === 'added'),
  })
  const resolve = (steps: readonly Step[]): PresentedStep[] => {
    const assigned = new Set<string>()
    const result = steps.map((step, index): PresentedStep => {
      const entities: string[] = [],
        relationships: string[] = []
      for (const id of step.changes) {
        const resolved = rowsOf.get(id)
        if (!resolved) throw new Error(`Comparison step references unknown change ${id}`)
        assigned.add(id)
        ;(resolved.collection === 'entities' ? entities : relationships).push(...resolved.rows)
      }
      return {
        index,
        kind: inferKind(
          entities.map(id => rowById.get(id)!),
          step.kind,
        ),
        entities,
        relationships,
        ...membership([...entities, ...relationships]),
        ...(step.kind ? {declaredKind: step.kind} : {}),
        ...(step.summary ? {summary: step.summary} : {}),
      }
    })
    // An exact change that stays unchanged (it varied only within tolerance) belongs to no step and presents nothing.
    const leftover = comparison.changes.filter(
      change => !assigned.has(change.id) && !(change.status === 'unchanged' && change.correspondence === 'exact'),
    )
    if (leftover.length) {
      const entities = leftover.filter(change => change.collection === 'entities').flatMap(change => rowsOf.get(change.id)!.rows)
      const relationships = leftover.filter(change => change.collection === 'relationships').flatMap(change => rowsOf.get(change.id)!.rows)
      result.push({
        index: result.length,
        kind: inferKind(
          entities.map(id => rowById.get(id)!),
          undefined,
        ),
        entities,
        relationships,
        ...membership([...entities, ...relationships]),
      })
    }
    return result
  }
  const explicit = comparison.order?.reverse === 'explicit' && Array.isArray(comparison.reverseSteps)
  return {
    steps: resolve(comparison.steps),
    reverse: explicit ? 'explicit' : 'mirror',
    ...(explicit ? {reverseSteps: resolve(comparison.reverseSteps!)} : {}),
  }
}

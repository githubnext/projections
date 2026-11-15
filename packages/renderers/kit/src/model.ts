import type {Comparison, Entity, Extraction, Relationship} from '@githubnext/projections-schemas'
import {presentComparison} from '@githubnext/projections-renderer-sdk/presentation'
import type {EntityChange, PresentedChanges, PresentedStep} from '@githubnext/projections-renderer-sdk/presentation'
import type {InitPayload} from '@githubnext/projections-renderer-sdk/protocol'

export type {StepKind} from '@githubnext/projections-renderer-sdk/presentation'

/** One comparison step in presented-row space (see the SDK's `PresentedStep`). */
export type ModelStep = PresentedStep

/**
 * An extraction or comparison resolved for presentation. Identity comes only
 * from the comparison (`presentComparison` in the SDK); nothing is matched,
 * normalized or inferred here. In extraction mode `before` and `after` are the
 * same extraction and every row is unchanged.
 */
export interface ComparisonModel<X extends Extraction = Extraction> {
  /** Whether this presents one extraction or a comparison of two. */
  mode: 'extraction' | 'comparison'
  /** The extraction's domain schema; a comparison's is After's. */
  schema: string
  /** The Before extraction; the extraction itself in extraction mode. */
  before: X
  /** The After extraction; the extraction itself in extraction mode. */
  after: X
  /** One row per entity across both extractions, its Before and After versions paired by the comparison. */
  entities: EntityChange<X['entities'][number]>[]
  /** One row per relationship across both extractions, paired like `entities`. */
  relationships: EntityChange<X['relationships'][number]>[]
  /** Maps an entity ID of either extraction to the presented row that shows it. */
  entityRow: {before: ReadonlyMap<string, string>; after: ReadonlyMap<string, string>}
  /** Steps in forward presentation order. */
  steps: ModelStep[]
  /** How playing backward orders steps: the forward steps reversed, or `reverseSteps`. */
  reverse: 'mirror' | 'explicit'
  /** Backward presentation order (first presented when leaving progress 1) when `reverse` is `explicit`. */
  reverseSteps?: ModelStep[]
}

function bothSides<T extends Entity | Relationship>(items: readonly T[]): EntityChange<T>[] {
  return items.map(item => ({id: item.id, before: item, after: item, status: 'unchanged', correspondence: 'exact'}))
}

/** Presents an extraction (one state) or a comparison (two states) from the host's `init`. */
export function createModel<X extends Extraction>(init: InitPayload<X>): ComparisonModel<X> {
  if (init.mode === 'extraction') return extractionModel(init.extraction)
  return comparisonModel(init.before, init.after, init.comparison)
}

/**
 * Presents one extraction as a model: every entity and relationship is a row with itself on both sides, unchanged,
 * and there are no steps.
 */
export function extractionModel<X extends Extraction>(extraction: X): ComparisonModel<X> {
  const entities = bothSides(extraction.entities)
  const ids = new Map(entities.map(row => [row.id, row.id]))
  return {
    mode: 'extraction',
    schema: extraction.schema,
    before: extraction,
    after: extraction,
    entities,
    relationships: bothSides(extraction.relationships),
    entityRow: {before: ids, after: ids},
    steps: [],
    reverse: 'mirror',
  }
}

/**
 * Presents a comparison of `before` and `after` as a model, pairing their items exactly as `comparison` says (see
 * `presentComparison`) and resolving its steps to rows.
 *
 * @throws `Error` when `comparison` names an item neither extraction has, or leaves an item out.
 * @example
 * ```ts
 * const model = comparisonModel(before, after, comparison)
 * const added = model.entities.filter(row => row.status === 'added')
 * ```
 */
export function comparisonModel<X extends Extraction>(before: X, after: X, comparison: Comparison): ComparisonModel<X> {
  // Rows hold the items of `before` and `after` themselves, so they keep the extractions' item types.
  const presented = presentComparison(before, after, comparison) as Omit<PresentedChanges, 'entities' | 'relationships'> & {
    entities: EntityChange<X['entities'][number]>[]
    relationships: EntityChange<X['relationships'][number]>[]
  }
  const entityRow = {before: new Map<string, string>(), after: new Map<string, string>()}
  for (const row of presented.entities) {
    if (row.before) entityRow.before.set(row.before.id, row.id)
    if (row.after) entityRow.after.set(row.after.id, row.id)
  }
  return {
    mode: 'comparison',
    schema: after.schema,
    before,
    after,
    entities: presented.entities,
    relationships: presented.relationships,
    entityRow,
    steps: presented.steps ?? [],
    reverse: presented.reverse ?? 'mirror',
    ...(presented.reverseSteps ? {reverseSteps: presented.reverseSteps} : {}),
  }
}

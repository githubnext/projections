import {summaryItems, type SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'
import {
  rendererLimits,
  type ControlValue,
  type InitPayload,
  type RendererProjection,
  type RendererSummary,
  type SummaryCountItem,
  type SummaryFactItem,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonModel} from './model.js'
import {boundaryKinds, moduleGroups} from './layout/groups.js'
import {compareIds, type LayoutEdge, type LayoutNode} from './layout/model.js'

/** What a renderer's summary facts are computed from (`MountOptions.facts`): the document and its control values. */
export interface SummaryFactContext {
  /** The host's `init` message: the extraction, or both revisions and their comparison. */
  init: InitPayload
  /** The shell's model of the document (`createModel`). */
  model: ComparisonModel
  /** The value of every declared control, defaults filled in, for facts worded by a control (such as a measure). */
  controls: Record<string, ControlValue>
  /** The definition's renderer name (`init.projection.renderer`), for a bundle that presents several. */
  rendererName: string
}

/**
 * A renderer's domain facts for the host's summary bar (`SummaryFactItem`): findings no kind count says, such as `2
 * breaking changes`, `1 enforcing rule +1` or `3 to replace`, computed from the document and the control values only,
 * so the bar is the same at every progress and in every pane. The shell posts them after the kind counts.
 */
export type SummaryFacts = (context: SummaryFactContext) => readonly SummaryFactItem[]

/** A summary message's JSON budget: the protocol's message limit, less room for its envelope. */
const summaryBudget = rendererLimits.messageBytes - 512

/**
 * Facts the protocol accepts as given: at most `rendererLimits.summaryItems`, and without `ids` (so not a filter) when
 * they name more than `rendererLimits.summaryFactIds` items or the summary would outgrow a message, largest first.
 */
function boundedFacts(facts: readonly SummaryFactItem[], counted: number): SummaryFactItem[] {
  const bounded = facts
    .slice(0, rendererLimits.summaryItems)
    .map(fact => (fact.ids && fact.ids.length > rendererLimits.summaryFactIds ? withoutIds(fact) : fact))
  const size = () => JSON.stringify(bounded).length + counted
  while (size() > summaryBudget) {
    const largest = bounded.reduce<number>(
      (found, fact, index) => ((fact.ids?.length ?? 0) > (bounded[found]?.ids?.length ?? 0) ? index : found),
      0,
    )
    if (!bounded[largest]?.ids?.length) break
    bounded[largest] = withoutIds(bounded[largest])
  }
  return bounded
}

const withoutIds = ({ids: _ids, ...fact}: SummaryFactItem): SummaryFactItem => fact

/**
 * Count figures worded with the definition's nouns (`presentation.kinds.<kind>.noun`, sent as
 * `init.projection.kinds`) where it gives one: a definition names its own kinds, so its words win over the
 * renderer's. Only the words change; which kinds appear, and their order, stay the renderer's.
 */
export function withDefinitionNouns(items: SummaryCountItem[], kinds: RendererProjection['kinds']): SummaryCountItem[] {
  if (!kinds) return items
  return items.map(item => {
    const noun = Object.hasOwn(kinds, item.kind) ? kinds[item.kind]!.noun : undefined
    return noun ? {...item, noun: {singular: noun.singular, plural: noun.plural}} : item
  })
}

/**
 * The summary a kit renderer posts for a document: a figure per extraction kind with its counts, worded with the
 * renderer's `nouns` (see `SummaryNouns`) and the host's words for the rest, then the renderer's domain `facts`
 * (see `SummaryFacts`), together at most `rendererLimits.summaryItems`. The shell posts it whenever the document, the
 * nouns or the facts change, so a renderer only names its kinds and states its facts.
 */
export function rendererSummary(init: InitPayload, nouns?: SummaryNouns, facts: readonly SummaryFactItem[] = []): RendererSummary {
  // Tolerates a payload without `projection`, as tests and older hosts may build one.
  const counts = withDefinitionNouns(summaryItems(init, nouns), init.projection?.kinds)
  const stated = boundedFacts(facts, JSON.stringify(counts).length)
  return {items: [...counts.slice(0, Math.max(0, rendererLimits.summaryItems - stated.length)), ...stated]}
}

/**
 * Nouns that leave grouping boundaries out of the summary: each of the boundary kinds `compound` names (see
 * `boundaryKinds`) whose every entity is drawn as a boundary round others (see `moduleGroups`) in each revision and,
 * in a comparison, in the union of both the canvas lays out for the diff and the steps between (see `unionGraph`),
 * maps to `false`. Such a box only groups the cards it holds, which the summary counts, so it is no figure beside them;
 * a kind some of whose entities are drawn as cards anywhere (a module others depend on, or one two parents hold across
 * the revisions) is counted whole, as the protocol counts kinds. Spread it into a renderer's nouns:
 * `{contains: false, ...boundaryNouns(model, true)}`.
 */
export function boundaryNouns(model: ComparisonModel, compound: boolean | readonly string[]): SummaryNouns {
  const kinds = boundaryKinds(compound)
  const grouping = (entities: readonly LayoutNode[], relationships: readonly LayoutEdge[]) => {
    const groups = moduleGroups(entities, relationships, kinds)
    return (kind: string) => entities.every(entity => entity.kind !== kind || groups.has(entity.id))
  }
  const revisions = model.before === model.after ? [model.after] : [model.before, model.after]
  const tests = revisions.map(extraction => grouping(extraction.entities, extraction.relationships))
  if (model.mode === 'comparison') {
    const union = unionGraph(model)
    tests.push(grouping(union.nodes, union.edges))
  }
  const present = new Set(revisions.flatMap(extraction => extraction.entities.map(entity => entity.kind)))
  return Object.fromEntries(kinds.filter(kind => present.has(kind) && tests.every(test => test(kind))).map(kind => [kind, false]))
}

/**
 * The union of a comparison's revisions as the graph canvas lays it out (see `stageLayout`): a node per entity row, of
 * the first of its kinds, and a relationship whose ends differ between the revisions as both its old and its new edge,
 * between entity rows.
 */
function unionGraph(model: ComparisonModel): {nodes: LayoutNode[]; edges: LayoutEdge[]} {
  const nodes = model.entities.map(row => ({
    id: row.id,
    kind: [row.before?.kind, row.after?.kind].filter((kind): kind is string => kind !== undefined).sort(compareIds)[0]!,
  }))
  const edges: LayoutEdge[] = []
  for (const change of model.relationships) {
    const ends = (side: 'before' | 'after') => {
      const row = change[side]
      const map = model.entityRow[side]
      const from = row && map.get(row.from),
        to = row && map.get(row.to)
      return from !== undefined && to !== undefined ? {from, to} : undefined
    }
    const old = ends('before'),
      next = ends('after')
    if ((change.before && !old) || (change.after && !next)) continue
    if (old && next && old.from === next.from && old.to === next.to) edges.push({id: change.id, kind: change.after!.kind, ...next})
    else {
      if (old) edges.push({id: `${change.id}:before`, kind: change.before!.kind, ...old})
      if (next) edges.push({id: `${change.id}:after`, kind: change.after!.kind, ...next})
    }
  }
  return {nodes, edges}
}

/**
 * A measure of each revision as a summary fact's changes: its net change between `was` and `now`, `added` when it
 * grew and `removed` when it shrank (`summaryChange(37826, 39882)` is `{added: 2056}`), nothing when it held or for
 * one extraction (`was` undefined).
 */
export function summaryChange(was: number | undefined, now: number): Pick<SummaryFactItem, 'added' | 'removed'> {
  if (was === undefined || was === now) return {}
  return now > was ? {added: now - was} : {removed: was - now}
}

export type {
  RendererSummary,
  SummaryCountItem,
  SummaryFactItem,
  SummaryFactTone,
  SummaryItem,
  SummaryNoun,
} from '@githubnext/projections-renderer-sdk/protocol'
export type {SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'
export {humanizeKind, summarySentence} from '@githubnext/projections-renderer-sdk/presentation'

import {summaryItems} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {
  ControlValue,
  InitPayload,
  RendererProjection,
  RendererSummary,
  SummaryCountItem,
  SummaryFactItem,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonModel} from './model.js'

/** What a renderer's summary facts are computed from (`MountOptions.facts`): the document and its control values. */
export interface SummaryFactContext {
  /** The host's `init` message: the extraction, or both revisions and their comparison. */
  init: InitPayload
  /** The shell's model of the document (`createModel`). */
  model: ComparisonModel
  /** The value of every declared control, defaults filled in, for facts worded by a control (such as a measure). */
  controls: {[id: string]: ControlValue}
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

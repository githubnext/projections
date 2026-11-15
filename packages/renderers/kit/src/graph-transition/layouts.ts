// The ELK layouts a staged graph transition moves between.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {Point} from '../edge-arrows.js'
import {cardHeight, cardWidth, compareIds, layoutGraph} from '../layout.js'
import type {GraphLayout, LayoutEdge, LayoutNode} from '../layout.js'
import type {ComparisonModel} from '../model.js'
import type {GraphTransitionOptions} from '../graph-transition.js'
import type {Timing} from './timing.js'

/** Lays out the rows in `active` at `moment` (undefined for the union of both revisions). */
export type StageLayout = (
  active: Set<string>,
  moment: number | undefined,
  hints?: ReadonlyMap<string, Point>,
  bridge?: boolean,
  reference?: GraphLayout,
) => Promise<GraphLayout>

/**
 * How a transition lays out its stages: `entities` are the rows it presents. `bands` deepens cards to their layer's
 * depth (see `layerBands`): their height top to bottom, their width left to right.
 */
export function stageLayout(
  model: ComparisonModel,
  entities: readonly EntityChange<Entity>[],
  timing: Timing,
  options: GraphTransitionOptions,
  bands?: ReadonlyMap<string, number>,
): StageLayout {
  const {displayed, edgeAliases} = timing
  const orientation = options.orientation ?? 'vertical'
  /**
   * Relationships a layout places. Between the endpoints (`bridge`), a
   * relationship of either revision whose endpoints are both present keeps
   * shaping the layout, so dropping a link between survivors before its
   * replacement arrives never strands a card in a rank that implies a
   * structure neither revision has.
   */
  function graphEdges(active: Set<string>, moment: number, bridge = false): LayoutEdge[] {
    const result: LayoutEdge[] = []
    for (const {change, old, next, same, oldEvent, nextEvent} of edgeAliases) {
      if (same && old) {
        if (active.has(old.from) && active.has(old.to)) result.push({...old, id: change.id, kind: displayed(change, moment).kind})
        continue
      }
      if (old && (bridge || moment < oldEvent) && active.has(old.from) && active.has(old.to))
        result.push({...old, id: `${change.id}:before`, kind: change.before!.kind})
      if (next && (bridge || moment >= nextEvent) && active.has(next.from) && active.has(next.to))
        result.push({...next, id: `${change.id}:after`, kind: change.after!.kind})
    }
    return result
  }

  const compound = options.compound ?? false
  const junctions = options.junctions ?? false
  // `moment` undefined: either revision's kind, the same whichever way the comparison runs.
  const heights = options.diffOnly?.heights
  const widths = options.widths
  const footer = options.footer ?? model.mode === 'comparison'
  const nodesOf = (active: Set<string>, moment: number | undefined): LayoutNode[] =>
    entities
      .filter(row => active.has(row.id))
      .map(row => {
        const kind =
          moment === undefined
            ? [row.before?.kind, row.after?.kind].filter(kind => kind !== undefined).sort(compareIds)[0]!
            : displayed(row, moment).kind
        const band = bands?.get(row.id) ?? 0
        const own = (moment === undefined ? heights?.get(row.id) : undefined) ?? cardHeight(kind, footer) + (options.grow?.get(row.id) ?? 0)
        const height = orientation === 'vertical' ? Math.max(band, own) : own
        const width = orientation === 'horizontal' && band ? Math.max(band, widths?.get(row.id) ?? cardWidth) : widths?.get(row.id)
        return {
          id: row.id,
          kind,
          ...(height !== cardHeight(kind) ? {height} : {}),
          ...(width !== undefined && width !== cardWidth ? {width} : {}),
        }
      })
  // Every step keeps its reference's (the union's) boundaries, so a boundary emptied by removals never becomes a card.
  const kept = (reference: GraphLayout) => ({
    layerGap: reference.layerGap,
    alignment: reference.alignment,
    boundaries: new Set(reference.groups.keys()),
  })
  return (active, moment, hints, bridge = false, reference) =>
    layoutGraph(nodesOf(active, moment), graphEdges(active, moment ?? 1, bridge), {
      orientation,
      compound,
      junctions,
      ...(hints ? {hints} : {}),
      ...(reference ? kept(reference) : {}),
    })
}

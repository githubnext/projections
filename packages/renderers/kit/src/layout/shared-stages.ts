// Shared-prerequisite stages: several relationships that join and split at one junction.
import {compareIds, type LayoutEdge} from './model.js'

export interface SharedStage {
  sources: string[]
  targets: string[]
  edges: LayoutEdge[]
}

/** Complete shared-prerequisite stages, whose sources have no other outgoing relationships. */
export function sharedStages(edges: readonly LayoutEdge[]): SharedStage[] {
  const incoming = new Map<string, LayoutEdge[]>()
  for (const edge of edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge])
  const stages = new Map<string, SharedStage>()
  for (const [target, links] of incoming) {
    const sources = [...new Set(links.map(link => link.from))].toSorted(compareIds)
    if (sources.length < 2 || sources.length !== links.length || links.some(link => link.kind !== 'precedes')) continue
    const key = JSON.stringify(sources)
    const stage = stages.get(key) ?? {sources, targets: [], edges: []}
    stage.targets.push(target)
    stage.edges.push(...links)
    stages.set(key, stage)
  }
  return [...stages.values()].filter(
    stage =>
      stage.targets.length >= 2 &&
      !stage.sources.some(
        source =>
          stage.targets.includes(source) ||
          edges.some(edge => edge.from === source && (!stage.targets.includes(edge.to) || edge.kind !== 'precedes')),
      ),
  )
}

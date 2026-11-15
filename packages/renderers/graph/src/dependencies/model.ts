import type {ScheduledStep} from '@githubnext/projections-renderer-sdk/presentation'
import type {ComparisonModel, ModelStep} from '@githubnext/projections-renderer-kit'
import {collapse, summaryCards} from './collapse.js'
import {dependencyGraph} from './graph.js'
import {displayed, transitiveEdgePrefix} from './kinds.js'
import {shownEdges} from './paths.js'

/** Which transitive packages are expanded: every one, or the children of these visible rows. */
export type Expansion = 'all' | ReadonlySet<string>

/**
 * Which dependency edges to draw between shown packages: every one, or each package's primary path (from the package
 * that first pulls it in, nearest the roots) and every dependency added or removed, with its other dependents counted
 * on its card. Left out are only unchanged edges and version-range updates, whose new version the package's own card
 * shows, so every change stays visible while shared packages no longer pull edges across the graph.
 */
export type Paths = 'all' | 'primary'

export interface DependencyView {
  model: ComparisonModel
  schedule: ScheduledStep[]
  /** Workspace members, projects and target frameworks. */
  roots: ReadonlySet<string>
  /** Packages a root depends on directly. */
  direct: ReadonlySet<string>
  /** Packages hidden inside summary cards. */
  collapsed: number
  /** Each shown package's dependents whose edges `primary` paths leave out. */
  otherDependents: ReadonlyMap<string, readonly string[]>
  /** Each shown package's dependents and dependencies among shown packages, every edge included. */
  neighbors: ReadonlyMap<string, {dependents: readonly string[]; dependencies: readonly string[]}>
}

/**
 * Dependency graph rows to present: every root and direct dependency, every
 * changed package and the endpoints of every changed relationship, with the
 * shortest path that pulls each changed package in, plus the children of
 * expanded rows. Unchanged packages beyond that collapse into one summary card
 * per visible package that pulls them in first, so a large lockfile stays
 * readable and every change stays visible. An expanded package keeps a card
 * with the same ID as its summary, to collapse it again. Everything is ordered
 * by ID, so the same documents always present the same graph.
 */
export function dependencyView(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
  expansion: Expansion,
  paths: Paths = 'all',
): DependencyView {
  const graph = dependencyGraph(model)
  const {visible, owner, owned, opened} = collapse(graph, expansion)
  const {summaries, summaryEdges, summaryOf} = summaryCards(graph.rows, owned, opened)
  const entityRow = {before: new Map(model.entityRow.before), after: new Map(model.entityRow.after)}
  for (const row of summaries) {
    entityRow.before.set(row.id, row.id)
    entityRow.after.set(row.id, row.id)
  }
  const {shown, neighbors, otherDependents} = shownEdges(graph, visible, paths)
  // Summary cards arrive and leave with the package that owns them.
  const withSummaries = <S extends ModelStep>(step: S): S => {
    const owners = step.entities.filter(id => summaryOf.has(id))
    return owners.length
      ? {
          ...step,
          entities: [...step.entities, ...owners.map(id => summaryOf.get(id)!)],
          relationships: [...step.relationships, ...owners.map(id => `${transitiveEdgePrefix}${id}`)],
        }
      : step
  }
  return {
    model: {
      ...model,
      entities: [...model.entities.filter(row => visible.has(row.id)).map(displayed), ...summaries],
      relationships: [...shown, ...summaryEdges],
      entityRow,
      steps: model.steps.map(withSummaries),
      ...(model.reverseSteps ? {reverseSteps: model.reverseSteps.map(withSummaries)} : {}),
    },
    schedule: schedule.map(withSummaries),
    roots: graph.rootSet,
    direct: graph.direct,
    collapsed: owner.size,
    otherDependents,
    neighbors,
  }
}

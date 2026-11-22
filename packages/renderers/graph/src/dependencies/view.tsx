import {useEffect, useMemo, useState} from 'react'
import {countText, entityKindLine, stepEmphasis} from '@githubnext/projections-renderer-kit'
import {GraphCanvas, graphCanvasControls, useSummaryNouns, type RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {Entity} from '@githubnext/projections-schemas'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {dependencyView, type DependencyView} from './model.js'
import {dependencyNouns} from './facts.js'
import {isCollapseCard, isTransitiveSummary, summaryOwner} from './kinds.js'
import {versionOf, versionStatus} from './versions.js'

/** The host draws these for the dependency graph: the canvas zoom and whether every transitive package is shown. */
export const dependencyControls: readonly RendererControl[] = [
  ...graphCanvasControls,
  {
    id: 'transitive',
    label: 'All packages',
    description: 'Show every transitive package instead of summarizing unchanged ones',
    type: 'toggle',
    group: 'packages',
    groupLabel: 'Packages',
    default: false,
  },
  {
    id: 'paths',
    label: 'Every dependency',
    description: 'Draw every dependency edge instead of the path that pulls each package in',
    type: 'toggle',
    group: 'dependencies',
    groupLabel: 'Dependencies',
    default: false,
  },
]

/**
 * A package dependency graph, left to right from the workspace members or
 * projects: what each one pulls in, directly and transitively. Changed packages
 * and the path that pulls them in are always shown; unchanged transitive
 * packages collapse into a summary card per package that pulls them in, which
 * expands when selected; in its place, a card to collapse them again.
 */
export function DependencyGraph(props: RendererProps) {
  const {declareControls, model, schedule, progress, highlighting, onSelect} = props
  useEffect(() => declareControls(dependencyControls), [declareControls])
  useSummaryNouns(
    props.declareNouns,
    useMemo(() => dependencyNouns(model), [model]),
  )
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const all = props.controls.transitive === true
  const paths = props.controls.paths === true ? 'all' : 'primary'
  const view = useMemo(() => dependencyView(model, schedule, all ? 'all' : expanded, paths), [model, schedule, all, expanded, paths])
  const emphasis = useMemo(
    () => stepEmphasis(view.schedule, progress, highlighting, props.pane),
    [view.schedule, progress, highlighting, props.pane],
  )
  const {diff, locale, selectedId} = props
  const select = (id: string | null) => {
    if (id === null || !isTransitiveSummary(id)) {
      onSelect(id)
      return
    }
    const owner = summaryOwner(id)
    if (!expanded.has(owner)) {
      setExpanded(new Set([...expanded, owner]))
      return
    }
    const rest = new Set(expanded)
    rest.delete(owner)
    setExpanded(rest)
    // A selected package the collapse hides is no longer selected.
    if (selectedId && !shows(dependencyView(model, schedule, rest, paths), selectedId)) onSelect(null)
  }
  // A summary card names what it opens or closes: `Collapse 6 transitive packages of body-parser`.
  const syntheticAction = (entity: Entity) => {
    if (!isTransitiveSummary(entity.id)) return undefined
    const count = typeof entity.data?.count === 'number' ? entity.data.count : 0
    const owner = view.model.entities.find(row => row.id === summaryOwner(entity.id))
    const name = (owner?.after ?? owner?.before)?.label ?? summaryOwner(entity.id)
    const open = isCollapseCard(entity)
    return {
      label: `${open ? 'Collapse' : 'Show'} ${countText(count, 'transitive package', 'transitive packages', locale)} of ${name}`,
      expanded: open,
    }
  }
  // A package with dependents beyond the one its path comes from says how many on its kind line.
  const kindLine = useMemo(
    () => (entity: Entity) => {
      const others = view.otherDependents.get(entity.id)?.length
      return others !== undefined && others !== 0
        ? {...entityKindLine(entity.kind), note: `+${countText(others, 'dependent', 'dependents', locale)}`}
        : undefined
    },
    [view.otherDependents, locale],
  )
  // Selecting a package brings forward what depends on it and what it depends on, every edge counted.
  const focus = useMemo(() => {
    const links = selectedId ? view.neighbors.get(selectedId) : undefined
    if (!selectedId || !links) return undefined
    const name = view.model.entities.find(row => row.id === selectedId)
    const label = (name?.after ?? name?.before)?.label ?? selectedId
    const dependents = countText(links.dependents.length, 'package depends', 'packages depend', locale)
    const dependencies = countText(links.dependencies.length, 'package', 'packages', locale)
    return {
      ids: new Set([selectedId, ...links.dependents, ...links.dependencies]),
      label: `${dependents} on ${label}; it depends on ${dependencies}`,
    }
  }, [selectedId, view, locale])
  return (
    <GraphCanvas
      {...props}
      model={view.model}
      schedule={view.schedule}
      emphasis={emphasis}
      onSelect={select}
      orientation="horizontal"
      detail={entity => (entity.kind === 'transitive' ? undefined : versionOf(entity))}
      kindLine={kindLine}
      focus={focus}
      describeStatus={diff ? bumpStatus : versionStatus}
      prose={entity => entity.kind === 'transitive'}
      synthetic={id => id.startsWith('transitive')}
      syntheticAction={syntheticAction}
      source={model}
    />
  )
}

function shows(view: DependencyView, id: string) {
  return view.model.entities.some(row => row.id === id) || view.model.relationships.some(row => row.id === id)
}

function bumpStatus(change: Parameters<typeof versionStatus>[0]) {
  return versionStatus(change, {bump: true})
}

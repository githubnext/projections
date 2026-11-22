import '@githubnext/projections-renderer-kit/react.css'
import {useEffect, useMemo} from 'react'
import {followContext, boundaryNouns, type SummaryFactContext, type SummaryNouns} from '@githubnext/projections-renderer-kit'
import {
  GraphCanvas,
  graphCanvasControls,
  graphCanvasPace,
  mountRenderer,
  useSummaryNouns,
  type RendererProps,
} from '@githubnext/projections-renderer-kit/react'
import type {Entity} from '@githubnext/projections-schemas'
import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import {actionPart, attributeChanges, boundaryKinds, infrastructureStatus, plannedAction, resourceType} from './infrastructure/resources.js'
import {dependents} from './infrastructure/dependents.js'
import {planFacts} from './infrastructure/facts.js'
import {DependencyGraph} from './dependencies/view.js'
import {ArchitectureRenderer} from './architecture/view.js'
import {dependencyFacts} from './dependencies/facts.js'
import {accepts} from './accepts.js'
import {graphNouns} from './nouns.js'
import {FactGraph} from './fact-graph.js'
import {unknownIconFacts} from './facts.js'

/**
 * Resources, data sources and their boundaries, in the infrastructure's words; containment is drawn as boundaries, and a
 * kind drawn only as boundaries round others is no figure either (see `boundaryNouns`).
 */
const infrastructureNouns = {
  resource: {singular: 'resource', plural: 'resources'},
  'data-source': {singular: 'data source', plural: 'data sources'},
  module: {singular: 'module', plural: 'modules'},
  'resource-group': {singular: 'resource group', plural: 'resource groups'},
  contains: false,
} satisfies SummaryNouns

const infrastructureControls = defineControls([
  ...graphCanvasControls,
  {
    id: 'dependents',
    label: 'Dependents',
    description: 'Highlight everything that depends on the selected resource',
    type: 'toggle',
    default: true,
  },
])

/**
 * Infrastructure as a resource graph: resource types as the kind line,
 * modules, resource groups and parent resources as boundaries, and each
 * change worded as its planned action (Create, Update in place, Replace,
 * Destroy). Selecting a resource brings forward everything that depends on it.
 */
function InfrastructureRenderer(props: RendererProps) {
  const {model, comparing, selectedId, declareControls} = props
  useEffect(() => declareControls(infrastructureControls), [declareControls])
  // One revision: the pending action is part of what the revision describes.
  const kindLine = useMemo(
    () => (entity: Entity) => {
      const type = resourceType(entity)
      const action = comparing ? undefined : plannedAction(entity)
      // The action's first word (`Update`, not `Update in place`), so the type keeps its room.
      const note = action ? actionPart(action, entity)?.label.split(' ')[0] : undefined
      return type && note ? {...type, note} : type
    },
    [comparing],
  )
  // The host's summary bar counts the resources and states the plan: how many each planned action touches.
  useSummaryNouns(
    props.declareNouns,
    useMemo(() => ({...infrastructureNouns, ...boundaryNouns(model, boundaryKinds)}), [model]),
  )
  const focus = useMemo(() => {
    if (props.controls.dependents === false || !selectedId) return undefined
    const row = model.entities.find(entity => entity.id === selectedId)
    const entity = row && (row.after ?? row.before)
    if (!entity || (entity.kind !== 'resource' && entity.kind !== 'data-source')) return undefined
    const found = dependents(model, selectedId)
    const name = entity.label
    const label = found.size
      ? `${found.size.toLocaleString(props.locale)} ${found.size === 1 ? 'resource depends' : 'resources depend'} on ${name}`
      : `Nothing depends on ${name}`
    return {ids: new Set([selectedId, ...found]), label}
  }, [model, selectedId, props.controls.dependents, props.locale])
  // Diff mode: each changed resource's attributes on its card.
  return (
    <div className="infrastructure-view">
      <GraphCanvas
        changedFields={attributeChanges}
        {...props}
        compound={boundaryKinds}
        kindLine={kindLine}
        describeStatus={comparing ? infrastructureStatus : undefined}
        focus={focus}
      />
    </div>
  )
}

/**
 * One bundle for every staged-graph renderer name, so the graph layout engine
 * ships once: `graph`, `graph-horizontal` (the same graph left to right),
 * `dag`, `architecture`, `infrastructure` and `dependencies` (a package dependency graph).
 */
function GraphRenderer(props: RendererProps<typeof accepts>) {
  if (props.rendererName === 'dependencies') return <DependencyGraph {...props} />
  if (props.rendererName === 'architecture') return <ArchitectureRenderer {...props} />
  if (props.rendererName === 'infrastructure') return <InfrastructureRenderer {...props} />
  return <FactGraph {...props} orientation={props.rendererName === 'graph-horizontal' ? 'horizontal' : 'vertical'} />
}

/**
 * The summary bar's facts, by renderer: an infrastructure plan's actions (`2 to add`, `1 to replace`), and a dependency
 * graph's upgrades and downgrades by bump with the direct dependencies that changed. The other graphs' kind counts say
 * everything their diff marks; they warn only of cards whose **Icon** field names an icon they don't draw.
 */
function graphFacts({model, rendererName, controls}: SummaryFactContext) {
  if (rendererName === 'infrastructure') return planFacts(model)
  if (rendererName === 'dependencies') return dependencyFacts(model)
  return unknownIconFacts(model, controls.icon)
}

mountRenderer(GraphRenderer, {
  name: 'graph',
  // The Changes scope lays out only the changes and their context: the rest takes no room. A dependency graph keeps each
  // changed package's path from the workspace, which says why it is installed.
  scope: {
    layout: 'subset',
    context: (all, changes, renderer) => (renderer === 'dependencies' ? followContext(all, changes, {incoming: () => true}) : []),
  },
  accepts,
  capabilities: {changeHighlighting: 'supported', pace: graphCanvasPace, comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff']},
  controls: graphCanvasControls,
  nouns: graphNouns,
  facts: graphFacts,
})

import {useMemo, useState} from 'react'
import {boundaryNouns, countText, entityKindLine, type SummaryNouns} from '@githubnext/projections-renderer-kit'
import {useSummaryNouns, type GraphAnchor, type RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {Entity} from '@githubnext/projections-schemas'
import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import {FactGraph} from '../fact-graph.js'
import {drawnKinds, withRelationships} from '../facts.js'
import {architectureView, isSynthetic} from './collapse.js'
import {replacement} from './replacement.js'

/**
 * Containment is drawn as boundaries, so it is no figure of the summary bar, which counts the components by kind; nor
 * are modules that are only boundaries round them (see `boundaryNouns`).
 */
const architectureNouns = (model: RendererProps['model']): SummaryNouns => ({contains: false, ...boundaryNouns(model, true)})

/** For an architecture large enough to collapse its unchanged boundaries, whether to show them all. */
const componentsControls = defineControls([
  {
    id: 'components',
    label: 'Every component',
    description: 'Show every component instead of collapsing unchanged boundaries into summary cards',
    type: 'toggle',
    group: 'components',
    groupLabel: 'Components',
    default: false,
  },
])

/**
 * Module boundaries around their components. A large comparison (see `architectureView`) collapses each unchanged
 * boundary into a summary card that names it and counts its components, and the unchanged components of a changed one
 * into a card beside its changes; activating the card expands it, and a card in its place collapses it again. Selecting a hidden component, or a link joined to a summary card, expands what it
 * belongs to. One revision draws every component up to `oneRevisionCollapseAbove`, and the canvas opens at the readable
 * text floor on the start of a large one.
 */
export function ArchitectureRenderer(props: RendererProps) {
  const {model, selectedId, onSelect, locale} = props
  useSummaryNouns(
    props.declareNouns,
    useMemo(() => architectureNouns(model), [model]),
  )
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // The card activated last, which the next view keeps in place (see `GraphAnchor`).
  const [anchor, setAnchor] = useState<GraphAnchor>()
  const [document, setDocument] = useState(model)
  if (document !== model) {
    setDocument(model)
    setExpanded(new Set())
    setAnchor(undefined)
  }
  const all = props.controls.components === true
  const focused = props.focusRequest?.id
  const pinned = useMemo(() => new Set(focused ? [focused] : []), [focused])
  // Only the relationships the **Relationships** control draws join summary cards.
  const kinds = useMemo(() => drawnKinds(model, 'architecture'), [model])
  const shown = kinds.length > 1 ? String(props.controls.relationships ?? 'all') : 'all'
  const drawn = useMemo(() => withRelationships(model, shown), [model, shown])
  const view = useMemo(() => architectureView(drawn, all ? 'all' : expanded, pinned), [drawn, all, expanded, pinned])
  const extraControls = view.collapsible ? componentsControls : undefined
  // A component selected elsewhere (the host's table, the other pane) opens the boundary that hides it.
  // Activating a card, or opening the card that hides a component, keeps that card's place on screen.
  const activate = (boundaries: readonly string[]) => {
    const [id, card] = [...view.cards].find(([, card]) => !card.open && boundaries.includes(card.boundary)) ?? []
    if (id && card) setAnchor({from: id, to: replacement(card)})
    setExpanded(new Set([...expanded, ...boundaries]))
  }
  const hiding = selectedId === null ? undefined : view.hidden.get(selectedId)
  if (hiding !== undefined) activate([hiding])
  const select = (id: string | null) => {
    const card = id === null ? undefined : view.cards.get(id)
    const link = id === null ? undefined : view.links.get(id)
    if (card) {
      const next = new Set(expanded)
      if (card.open) next.delete(card.boundary)
      else next.add(card.boundary)
      setAnchor({from: id!, to: replacement(card)})
      setExpanded(next)
    } else if (link) activate(link)
    else onSelect(id)
  }
  const kindLine = useMemo(
    () => (entity: Entity) => {
      const card = view.cards.get(entity.id)
      if (!card) return undefined
      if (card.rest && !card.open) return entityKindLine('unchanged')
      return card.open
        ? entityKindLine('module')
        : {...entityKindLine('module'), note: countText(card.count, 'component', 'components', locale)}
    },
    [view.cards, locale],
  )
  const syntheticAction = (entity: Entity) => {
    const card = view.cards.get(entity.id)
    if (!card) return undefined
    const name = view.model.entities.find(row => row.id === card.boundary) ?? model.entities.find(row => row.id === card.boundary)
    const boundary = (name?.after ?? name?.before)?.label ?? card.boundary
    const components = countText(
      card.count,
      card.rest ? 'unchanged component' : 'component',
      card.rest ? 'unchanged components' : 'components',
      locale,
    )
    return {label: `${card.open ? 'Collapse' : 'Show'} ${components} of ${boundary}`, expanded: card.open}
  }
  return (
    <div className="architecture-view">
      <FactGraph
        {...props}
        document={model}
        extraControls={extraControls}
        model={view.model}
        anchor={anchor}
        onSelect={select}
        compound
        kindLine={kindLine}
        prose={entity => (entity.kind === 'collapse' || entity.kind === 'unchanged') && isSynthetic(entity.id)}
        synthetic={isSynthetic}
        syntheticAction={syntheticAction}
        source={model}
      />
    </div>
  )
}

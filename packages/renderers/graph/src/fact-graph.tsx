// The graph, DAG and architecture presentations: the staged graph canvas with the card facts a definition asks for.
import {useEffect, useMemo} from 'react'
import {GraphCanvas, graphCanvasControls, useLegend, type GraphCanvasProps} from '@githubnext/projections-renderer-kit/react'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {cardChanges, cardFacts, drawnKinds, factControls, factFields, pointerField, withRelationships} from './facts.js'

/**
 * A graph whose cards can show a data field's text as a subtitle, the icon a field names before their kind, and its values as badges or labels, be sized by a
 * numeric field and colored by kind or a data field, and whose relationships can be limited to one kind and colored by
 * kind, all described in the host legend (see `factControls`). A modified card lists its changed data fields in the diff.
 */
export function FactGraph(
  props: GraphCanvasProps & {
    /** The whole document, when `model` is a view of it (collapsed boundaries): facts, controls and colors come from it. */
    document?: ComparisonModel
    /** The presentation's own controls, declared after the canvas's and before the card facts'. */
    extraControls?: readonly RendererControl[] | undefined
  },
) {
  const {document, extraControls, ...canvas} = props
  const {rendererName, declareControls, controls, colorMode} = canvas
  const model = document ?? canvas.model
  const fields = useMemo(() => factFields(model), [model])
  const kinds = useMemo(() => drawnKinds(model, rendererName), [model, rendererName])
  const declared = useMemo(
    () => [...graphCanvasControls, ...(extraControls ?? []), ...factControls(fields, kinds)],
    [extraControls, fields, kinds],
  )
  useEffect(() => declareControls(declared), [declareControls, declared])
  const option = (id: string, fallback = 'none') => String(controls[id] ?? fallback)
  const badges = option('badges'),
    labels = option('labels'),
    colorBy = option('colorBy'),
    subtitle = option('subtitle'),
    icon = option('icon'),
    sizeBy = option('sizeBy'),
    highlights = option('highlights'),
    tags = option('tags')
  const shown = kinds.length > 1 ? option('relationships', 'all') : 'all'
  const drawn = useMemo(() => (shown === 'all' ? kinds : kinds.filter(kind => kind === shown)), [kinds, shown])
  const colored = controls.relationshipColors === true && drawn.length > 1
  const {locale} = canvas
  const facts = useMemo(
    () =>
      cardFacts(model, {badges, labels, highlights, tags, colorBy, subtitle, icon, sizeBy, kinds: colored ? drawn : [], colorMode, locale}),
    [model, badges, labels, highlights, tags, colorBy, subtitle, icon, sizeBy, colored, drawn, colorMode, locale],
  )
  // Diff mode: a modified card's changed data fields, except those the card itself marks as changed.
  const changedFields = useMemo(() => {
    const shown = [sizeBy, badges, labels, highlights, tags].map(pointerField).filter((field): field is string => field !== undefined)
    return (row: EntityChange<Entity>) => cardChanges(row, shown, locale)
  }, [sizeBy, badges, labels, highlights, tags, locale])
  // Only the chosen kind of relationship is drawn; a presentation that derives its model (architecture) limits it first.
  const graph = useMemo(() => withRelationships(canvas.model, shown), [canvas.model, shown])
  useLegend(props.reportLegend, facts.legend)
  // A synthetic card (a collapsed boundary's summary) carries the facts its presentation gives it in its `data`.
  return (
    <GraphCanvas
      changedFields={changedFields}
      {...canvas}
      model={graph}
      badges={facts.badges}
      accent={facts.accent}
      subtitle={facts.subtitle}
      icon={facts.icon}
      detail={facts.detail ?? canvas.detail}
      relationshipColor={facts.relationshipColor}
    />
  )
}

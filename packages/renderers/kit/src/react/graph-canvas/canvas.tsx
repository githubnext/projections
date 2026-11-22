// The graph canvas: lays out each comparison step, then draws the transition.
import {useEffect, useMemo, useRef, useState} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {statusParts} from '../../emphasis.js'
import {createGraphTransition} from '../../graph-transition/create.js'
import type {GraphTransition, TransitionNode} from '../../graph-transition.js'
import {compareIds} from '../../layout.js'
import {cardWidthRange, entityKindLine, graphCardWidth} from '../../card-text.js'
import {hasIcon} from '../../card-icons.js'
import {usePaintGate} from '../shell/frame.js'
import {diffCardText} from '../../diff-card/text.js'
import type {DiffCardText} from '../../diff-card/metrics.js'
import type {FieldLine} from '../../diff/lines.js'
import {graphEntityLimit} from './props.js'
import type {GraphCanvasProps} from './props.js'
import {LaidOutGraph} from './laid-out-graph.js'
import {expanderMetrics} from './entity-card.js'
import {badgeCardWidth, badgeGrowth} from '../../graph-canvas/badges.js'
import {fanInWidths} from '../../graph-canvas/fan-in.js'
import {subtitleGrowth} from './subtitle.js'

/**
 * The room a row's card keeps at the right of its kind line for its expander, when it has one (see `EntityCard`): on
 * top of what its text needs, even at the widest text width (`cardWidthRange`).
 */
function expanderRoom(props: GraphCanvasProps, row: EntityChange<Entity>): number {
  const expands = props.synthetic?.(row.id) && props.syntheticAction?.((row.after ?? row.before)!)?.expanded !== undefined
  return expands ? expanderMetrics.size + 4 : 0
}

/** A row as the node a renderer's `describeStatus` reads: its change, wherever it is drawn. */
function statusNode(row: EntityChange<Entity>): TransitionNode {
  return {...row, x: 0, y: 0, width: 0, height: 0, group: false, opacity: 1, local: 1}
}

/**
 * The theme's extra-small type size (card text) over the default 12, read once when the canvas mounts, after the host
 * theme is applied; 1 outside a browser. Cards are sized to their text at that size (see `GraphCardText.textScale`).
 */
function useCardTextScale(): number {
  const [scale] = useState(() => {
    if (typeof document === 'undefined') return 1
    const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--projections-font-size-xs'))
    return size > 0 ? Math.round((size / 12) * 1000) / 1000 : 1
  })
  return scale
}

/** Inputs a transition was laid out for, to tell a current layout from a stale one. */
interface Laid {
  inputs: readonly unknown[]
  source: unknown
  transition?: GraphTransition
  error?: Error
}

/**
 * The staged graph canvas shared by the graph, DAG and architecture renderers:
 * ELK layouts per comparison step (laid out off the main thread before the
 * first paint), identity-stable cards, spline relationships that morph on the
 * same clock as their cards, stable framing across the whole transition, and
 * host-driven change emphasis.
 */
export function GraphCanvas(props: GraphCanvasProps) {
  const {model, schedule, comparing, visibleIds} = props
  // Under the Changes scope the model is a view of the whole one, which a renderer's own `source` (its input model) is
  // in All: Changes and All are views of one document, so the drawing stays while the other is laid out, and moves to it.
  const source = props.scope?.all ?? props.source
  const orientation = props.orientation ?? 'vertical'
  const compound = props.compound ?? false
  const {include, count} = useMemo(() => {
    const ids = model.entities.map(row => row.id).filter(id => !visibleIds || visibleIds.has(id))
    return {include: new Set([...ids].sort(compareIds).slice(0, graphEntityLimit)), count: ids.length}
  }, [model, visibleIds])
  // Shared prerequisites join and split at one point in a pipeline's own layout; comparisons draw every link.
  const junctions = !comparing && model.schema === 'dag/v0' && model.entities.every(row => (row.after ?? row.before)!.kind === 'job')
  // Diff mode lays out one union, with modified cards grown for their field changes.
  const diff = props.diff && comparing
  // A held pane of side by side or swipe draws one revision, so it lays out only that one.
  const held = comparing && !diff ? props.pane : undefined
  const {changedFields} = props
  const fields = useMemo(() => {
    if (!diff || !changedFields) return undefined
    const lines = new Map<string, readonly FieldLine[]>()
    for (const row of model.entities) {
      const found = row.status === 'modified' ? changedFields(row) : undefined
      if (found?.length) lines.set(row.id, found)
    }
    return lines
  }, [diff, changedFields, model])
  // A graph's cards share the width its longest card text needs (`graphCardsWidth`), and a diff card's text is laid out
  // whole, its card growing to hold it. The card's text functions are read as they are now, without relaying out when a renderer passes new but
  // equivalent ones.
  const text = useRef(props)
  text.current = props
  const textScale = useCardTextScale()
  // Cards with badges grow a row for each row of them, and are at least as wide as their widest badge needs.
  const {badges, icon} = props
  const badgeWidth = useMemo(() => badgeCardWidth(model.entities, badges, textScale), [model, badges, textScale])
  const cards = useMemo(() => {
    if (!diff) return undefined
    const {kindLine, detail, prose, describeStatus} = text.current
    const card = (row: EntityChange<Entity>, width?: number) => {
      const entity = (row.after ?? row.before)!
      return diffCardText({
        before: row.before,
        after: row.after,
        kind: kindLine?.(entity) ?? entityKindLine(entity.kind),
        icon: hasIcon(row, icon),
        detail,
        prose: prose?.(entity) ?? false,
        fields: fields?.get(row.id),
        status: describeStatus?.(statusNode(row)) ?? statusParts(row),
        textScale,
        width,
        reserve: expanderRoom(text.current, row),
      })
    }
    // The graph's cards share the width the widest needs, and their text wraps to it.
    const width = Math.max(cardWidthRange.min, badgeWidth, ...model.entities.map(row => card(row).width))
    return new Map(model.entities.map(row => [row.id, card(row, width)]))
  }, [diff, model, fields, textScale, badgeWidth, icon])
  // Hubs grow so the relationships into them keep apart (see `fanInWidths`); otherwise the cards keep one width and
  // line up in columns.
  const {subtitle} = props
  const widths = useMemo(() => {
    if (cards) return fanInWidths(model, new Map([...cards].map(([id, card]) => [id, card.width])), orientation)
    const {kindLine, detail, prose, describeStatus} = text.current
    const status = describeStatus && ((row: EntityChange<Entity>) => describeStatus(statusNode(row)))
    const rowText = {kindLine, detail, prose, icon, status, comparing, textScale}
    const width = Math.max(
      badgeWidth,
      cardWidthRange.min,
      ...model.entities.map(row => graphCardWidth(row, rowText) + expanderRoom(text.current, row)),
    )
    return fanInWidths(model, new Map(model.entities.map(row => [row.id, width] as const)), orientation)
  }, [cards, model, comparing, textScale, badgeWidth, orientation, icon])
  // Cards grow for their badge rows and their subtitle's lines.
  const badgeRows = useMemo(
    () => (badges ? badgeGrowth(model.entities, badges, widths, textScale) : undefined),
    [badges, model, widths, textScale],
  )
  const subtitleRows = useMemo(
    () => (subtitle ? subtitleGrowth(model.entities, subtitle, widths, textScale) : undefined),
    [subtitle, model, widths, textScale],
  )
  const grow = useMemo(() => {
    if (!badgeRows && !subtitleRows) return undefined
    const total = new Map(badgeRows)
    for (const [id, height] of subtitleRows ?? []) total.set(id, (total.get(id) ?? 0) + height)
    return total
  }, [badgeRows, subtitleRows])
  const inputs = useMemo(
    () => [model, schedule, orientation, compound, include, junctions, diff, cards, widths, grow, held],
    [model, schedule, orientation, compound, include, junctions, diff, cards, widths, grow, held],
  )
  const [laid, setLaid] = useState<Laid>()
  useEffect(() => {
    let current = true
    const heights = new Map([...(cards ?? [])].map(([id, card]) => [id, card.height + (grow?.get(id) ?? 0)]))
    createGraphTransition(model, schedule, {
      orientation,
      compound,
      include,
      junctions,
      widths,
      footer: comparing,
      ...(grow ? {grow} : {}),
      ...(held ? {held} : {}),
      ...(diff ? {diffOnly: {heights}} : {}),
    }).then(
      transition => {
        if (current) setLaid({inputs, source, transition})
      },
      (error: unknown) => {
        if (current) setLaid({inputs, source, error: error instanceof Error ? error : new Error(String(error))})
      },
    )
    return () => {
      current = false
    }
  }, [inputs, source, model, schedule, orientation, compound, include, junctions, diff, cards, widths, grow, comparing, held])
  const ready = laid?.inputs === inputs
  usePaintGate(ready)
  if (ready && laid.error) throw laid.error
  // While a new step order, or a new view of the same document, is laid out, the current layout stays rather than
  // flashing empty, so cards keep their focus.
  const same = laid && (laid.inputs[0] === model || (source !== undefined && laid.source === source))
  const transition = same ? laid.transition : undefined
  // While another document is laid out, the graph drawn last stays as it was (its rendered acknowledgement waits for
  // the new one), so presenting another document is one change, not empty and then drawn. Another document is drawn
  // afresh (framed and zoomed as it opens); a new layout or view of the same one keeps the view.
  const document = source ?? model
  const drawn = useRef<Drawn>(undefined)
  const last = drawn.current
  // A layout the props have moved past is drawn only in place of a view of the same document already shown. As the
  // first view it would open on what the host no longer shows (every item, while the scope it sent with its documents
  // is laid out), then jump to the layout it asked for.
  const shown: Drawn | undefined =
    transition && (ready || last?.document === document)
      ? {
          key: last && last.document === document ? last.key : (last?.key ?? 0) + 1,
          document,
          props,
          transition,
          orientation,
          count,
          fields,
          cards,
          textScale,
          badgeGrowth: badgeRows,
          subtitleGrowth: subtitleRows,
          stale: !ready,
        }
      : last
  drawn.current = shown
  return shown ? (
    <LaidOutGraph
      key={shown.key}
      {...shown.props}
      transition={shown.transition}
      orientation={shown.orientation}
      count={shown.count}
      fields={shown.fields}
      cards={shown.cards}
      textScale={shown.textScale}
      badgeGrowth={shown.badgeGrowth}
      subtitleGrowth={shown.subtitleGrowth}
      stale={shown.stale}
    />
  ) : (
    <div className="graph-container">
      <div className="graph-loading" role="status" aria-busy="true">
        <span>Laying out the graph…</span>
      </div>
    </div>
  )
}

/** The graph drawn last: its document and the props and layout it was drawn with. */
interface Drawn {
  key: number
  /** The document drawn (its `source`, else its model). */
  document: unknown
  props: GraphCanvasProps
  transition: GraphTransition
  orientation: 'vertical' | 'horizontal'
  count: number
  fields: ReadonlyMap<string, readonly FieldLine[]> | undefined
  cards: ReadonlyMap<string, DiffCardText> | undefined
  textScale: number
  badgeGrowth: ReadonlyMap<string, number> | undefined
  subtitleGrowth: ReadonlyMap<string, number> | undefined
  /** Whether `transition` was laid out for earlier props than `props` (see `LaidOutGraphProps.stale`). */
  stale: boolean
}

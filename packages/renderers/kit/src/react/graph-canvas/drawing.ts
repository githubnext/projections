// What every drawn part of a laid-out graph reads: its props, accessible names, change marks and focus.
import type {CSSProperties} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import type {StatusPart, ChangeClassification} from '../../emphasis.js'
import {describeChange} from '../../emphasis.js'
import type {GraphTransition, TransitionEdge, TransitionNode} from '../../graph-transition.js'
import {changeMark} from '../../diff/model.js'
import type {DiffCardText} from '../../diff-card/metrics.js'
import type {FieldLine} from '../../diff/lines.js'
import type {KindLineText} from '../../card-text.js'
import type {GraphCanvasProps} from './props.js'
import {badgeText} from '../../graph-canvas/badges.js'

export type LaidOutGraphProps = GraphCanvasProps & {
  transition: GraphTransition
  orientation: 'vertical' | 'horizontal'
  count: number
  fields: ReadonlyMap<string, readonly FieldLine[]> | undefined
  cards: ReadonlyMap<string, DiffCardText> | undefined
  textScale: number
  /** How much each card grows for its badge rows (see `GraphCanvasProps.badges`). */
  badgeGrowth: ReadonlyMap<string, number> | undefined
  /** How much each card grows for its subtitle (see `GraphCanvasProps.subtitle`). */
  subtitleGrowth: ReadonlyMap<string, number> | undefined
  /**
   * Whether `transition` is the layout of earlier props, drawn while the current ones are laid out: a new scope, say,
   * whose items the layout may not place yet. The view keeps the focus it opened on until its own layout arrives.
   */
  stale?: boolean
}

export interface Drawing {
  props: LaidOutGraphProps
  /** Whether this is diff mode's static frame. */
  diff: boolean
  /** How far a change border is inset into its card (see `emphasisInset`). */
  inset: number
  /** A plain card's border width, `--stroke`, in layout units. */
  stroke: number
  kindOf(entity: Entity): KindLineText | undefined
  statusOf(node: TransitionNode): StatusPart[] | undefined
  /** A card's or boundary's accessible name. */
  label(node: TransitionNode, entity: Entity): string
  /** A change's mark in the diff: its status and emphasis. */
  mark(change: ChangeClassification | TransitionNode, emphasis: number): object
  /** Selects `id` on Enter or Space. */
  select(id: string): (event: {key: string; preventDefault(): void}) => void
  /** Whether a row recedes behind the focus. */
  receded(id: string): boolean
}

export function drawing(props: LaidOutGraphProps, diff: boolean, inset: number, stroke = 1): Drawing {
  const {onSelect, comparing} = props
  const kindOf = (entity: Entity) => props.kindLine?.(entity)
  const statusOf = (node: TransitionNode) => props.describeStatus?.(node)
  // The comparison's own status word, then a domain's wording of it, for assistive technology: "Modified, Replace".
  const describe = (node: TransitionNode) => {
    const generic = describeChange(node)
    const worded = statusOf(node)
      ?.map(part => part.label)
      .join(', ')
    return worded && worded !== generic ? `${generic}, ${worded}` : generic
  }
  const label = (node: TransitionNode, entity: Entity) => {
    const kind = kindOf(entity)?.text
    const was = diff && node.before && node.after && node.before.label !== node.after.label ? `, was ${node.before.label}` : ''
    const lines = props.fields?.get(node.id)
    const changed = lines?.length
      ? `, ${lines.map(line => (line.summary ? line.key : `${line.key} ${line.before} to ${line.after}`)).join(', ')}`
      : ''
    const facts = [props.subtitle?.(entity), props.accent?.(entity)?.label, ...(props.badges?.(entity) ?? []).map(badgeText)].filter(
      Boolean,
    )
    const told = facts.length ? `, ${facts.join(', ')}` : ''
    return `Inspect ${kind ? `${kind} ` : ''}${entity.label}${told}${comparing ? `, ${describe(node)}${was}${changed}` : ''}`
  }
  const focus = props.focus
  const receded = (id: string) => Boolean(focus && !focus.ids.has(id))
  const select = (id: string) => (event: {key: string; preventDefault(): void}) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(id)
    }
  }
  const mark = (change: ChangeClassification | TransitionNode, emphasis: number) =>
    diff ? {...changeMark(change), style: {'--emphasis': emphasis} as CSSProperties} : {}
  return {props, diff, inset, stroke, kindOf, statusOf, label, mark, select, receded}
}

/** A relationship's change in its accessible name: which endpoints a rewired one's route has. */
export function edgeDescription(edge: TransitionEdge): string {
  return edge.part ? `${describeChange(edge)}, ${edge.part === 'before' ? 'old endpoints' : 'new endpoints'}` : describeChange(edge)
}

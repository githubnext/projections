import type {CSSProperties} from 'react'
import type {ComparisonMode, Side} from '../modes.js'
import {paneGeometry} from './arrangement.js'

/**
 * How side by side and swipe label their panes (`ProjectionStageProps.paneLabels`): a header band above each pane, a
 * chip overlaid on its frame's top corner, or only for assistive technology.
 */
export type PaneLabels = 'visible' | 'chips' | 'hidden'

/** The stage's accent: the connector and, unless a host sets `--ph-swipe-edge`, the swipe divider. */
export const accent = 'var(--projections-color-accent, #0969da)'

/**
 * The edge of a pane: a CSS `border` shorthand (1px wide, or none) and a `border-radius`; with `between` (a 1px `border`
 * shorthand), left and right panes in side by side meet at that rule, drawn on the after pane's left, with no gutter.
 */
export interface PaneEdge {
  border: string
  radius: string
  between?: string
}

/** The space between left and right panes with this edge: none but its rule (`between`), or the gutter. */
export const columnGapOf = (edge: PaneEdge) => (edge.between ? paneGeometry.ruleGap : paneGeometry.columnGap)

/**
 * A pane of side by side or swipe: one card around its label band and its frame. Its edge is a border, drawn inside
 * its box like every edge the stage draws, and it clips band and frame to its corners, so band and frame share one
 * continuous outline whose sides can't drift apart.
 */
const paneCard = (edge: PaneEdge): CSSProperties => ({
  boxSizing: 'border-box',
  // Each side apart, so a pane can draw the rule between panes on one side without mixing a shorthand with it.
  borderTop: edge.border,
  borderRight: edge.border,
  borderBottom: edge.border,
  borderLeft: edge.border,
  borderRadius: edge.radius,
  overflow: 'clip',
})

/**
 * How far a pane's frame extends past its start and end edges, for a stage that bleeds `bleed` CSS px past its own
 * (see `ProjectionStageProps.bleed`): every frame on both sides, except where left and right panes meet.
 */
export function paneBleed(mode: ComparisonMode, stacked: boolean, side: Side | 'main', bleed: number): {start: number; end: number} {
  if (mode !== 'side-by-side' || stacked || side === 'main') return {start: bleed, end: bleed}
  return side === 'before' ? {start: bleed, end: 0} : {start: 0, end: bleed}
}

/**
 * The stage body's layout for a mode: one section (animated or diff), side by side's grid of two cards (left and
 * right, or stacked beside the connector gutter), or swipe's two stacked layers clipped at the divider (`percent`).
 * When filling, every section passes the height on to its pane. With `bleed`, sections no longer clip their frames,
 * and swipe's layers clip at the divider but `bleed` past the stage's outer edges.
 */
export function stageLayout({
  mode,
  fill,
  stacked,
  percent,
  paneEdge,
  bleed = 0,
}: {
  mode: ComparisonMode
  fill: boolean
  stacked: boolean
  percent: string
  paneEdge: PaneEdge
  bleed?: number
}) {
  const filled: CSSProperties = fill ? {display: 'flex', flexDirection: 'column', minHeight: 0} : {}
  const layer: CSSProperties = {position: 'relative', gridArea: '1 / 1', minWidth: 0, ...filled}
  const paneStyle: CSSProperties = fill
    ? {position: 'relative', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column'}
    : {position: 'relative', minWidth: 0}
  const sectionStyle = (side: Side): CSSProperties =>
    mode === 'swipe'
      ? {
          ...layer,
          ...paneCard(paneEdge),
          ...(bleed > 0 ? {overflow: 'visible'} : {}),
          ...(side === 'before'
            ? {zIndex: 1, clipPath: `inset(0 calc(100% - ${percent}) 0 ${-bleed}px)`}
            : {clipPath: `inset(0 ${-bleed}px 0 ${percent})`}),
        }
      : mode === 'side-by-side'
        ? {
            ...paneStyle,
            ...paneCard(paneEdge),
            ...(bleed > 0 ? {overflow: 'visible'} : {}),
            ...(side === 'after' && !stacked && paneEdge.between ? {borderLeft: paneEdge.between} : {}),
          }
        : {position: 'relative', minWidth: 0, ...filled}
  const sectionClass = (side: Side) =>
    mode === 'swipe' ? `ph-swipe-layer ph-swipe-${side}` : mode === 'side-by-side' ? 'ph-pane' : 'ph-single'
  const fillBody: CSSProperties = fill
    ? {flex: '1 1 0', minHeight: 0, gridTemplateRows: mode === 'side-by-side' && stacked ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)'}
    : {}
  const bodyStyle: CSSProperties =
    mode === 'swipe'
      ? ({
          '--ph-split': percent,
          position: 'relative',
          display: 'grid',
          minWidth: 0,
          isolation: 'isolate',
          overflow: bleed > 0 ? 'visible' : 'clip',
          ...fillBody,
        } as CSSProperties)
      : mode === 'side-by-side'
        ? {
            position: 'relative',
            display: 'grid',
            minWidth: 0,
            gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
            gap: stacked ? paneGeometry.rowGap : paneEdge.between ? 0 : paneGeometry.columnGap,
            paddingLeft: stacked ? paneGeometry.gutter : 0,
            ...fillBody,
          }
        : {position: 'relative', display: 'grid', minWidth: 0, ...fillBody}

  return {sectionStyle, sectionClass, bodyStyle}
}

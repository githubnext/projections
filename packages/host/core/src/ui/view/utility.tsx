import {useRef, useState, type CSSProperties, type ReactNode} from 'react'
import type {ProjectionController} from '../../projection.js'
import {useSize} from '../../stage/arrangement.js'
import {utilityInset, utilitySide} from '../../stage/utility.js'
import type {ViewKind} from '../blocks.js'
import {Playback} from '../playback.js'
import {glassSupported, overlaySurface} from './glass.js'

/** The utility area's playback bar's height, CSS px: a 40px row (the 32px lens and its ring) inside a 1px edge. */
export const utilityBarHeight = 42
/** The widest the playback bar grows, CSS px: wider, a slider is harder to scrub, not easier. */
const widest = 560
/** Below this room, CSS px, the bar keeps the play button and the slider and moves the steps and percent into its overflow. */
const compactBelow = 440

/**
 * The playback slider in the stage's utility area (`ProjectionViewProps.utilityArea`): the toolbar's playback group in
 * a bar as wide as it needs, up to `widest` and at most the `room` the stage leaves it (the bar's edge included).
 */
export function UtilityPlayback({
  projection: p,
  beforeLabel,
  afterLabel,
  always,
  room,
}: {
  projection: ProjectionController
  beforeLabel: string
  afterLabel: string
  always: boolean
  room: number | undefined
}) {
  const width = Math.max(0, Math.floor(Math.min(widest, (room ?? widest + 2) - 2)))
  return (
    <div
      data-toolbar-region="playback"
      className="ph-toolbar-playback ph-utility-playback pj:flex pj:min-w-0 pj:items-center pj:pr-2 pj:pl-0.5"
      style={{width, height: utilityBarHeight - 2}}
    >
      <Playback
        projection={p}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
        always={always}
        compact={width < compactBelow}
        sliderMin={64}
        className="pj:flex-1"
      />
    </div>
  )
}

/**
 * The look of the stage's overlays in the default view (the utility area's bar and chips, the foot, "Updating…"): the
 * toolbar's surface and divider, as glass where it is supported (`overlaySurface`) and solid elsewhere, so the content
 * passing under them stays legible.
 */
const overlayTheme = (glass: boolean) =>
  ({
    '--ph-utility-fg': 'var(--pj-foreground)',
    // The bar's own muted text (its percent), which the stage's chips draw their names in.
    '--ph-utility-muted': 'var(--pj-muted-foreground)',
    ...overlaySurface(glass),
    '--ph-utility-border': '1px solid var(--pj-divider)',
    '--ph-utility-radius': 'var(--pj-radius-md)',
  }) as CSSProperties

/**
 * What the default view puts in the stage's utility area: the host's own content (`ProjectionViewProps.utility`), the
 * floating playback, or both in one bar, the host's first and the playback under it, one rule between them. Nothing
 * when there's neither, so the stage shows no bar.
 */
export function stageUtility(host: ReactNode, playback: ReactNode): ReactNode {
  // The stage shows a bar whenever its `utility` is truthy, so nothing here is `undefined`, not an empty element.
  const hasHost = Boolean(host)
  const hasPlayback = Boolean(playback)
  if (!hasHost) return hasPlayback ? playback : undefined
  // The host's content keeps one place whether or not the playback shows, so React keeps it mounted, with its state
  // and focus, across a switch between diff and animated.
  return (
    <div className="ph-utility-stack pj:flex pj:min-w-0 pj:flex-col">
      {host}
      {hasPlayback ? <div className="pj:border-t pj:border-divider">{playback}</div> : null}
    </div>
  )
}

/**
 * The default view's floating playback, with a `utility` area while it shows playback: the bar for the panel `panel` measures, and the top padding a view
 * that scrolls under it (table, text) takes, the band the bar covers and the view's own 12px.
 */
export function useUtilityPlayback({
  projection,
  utility,
  showPlayback,
  view,
  beforeLabel,
  afterLabel,
}: {
  projection: ProjectionController
  utility: boolean
  showPlayback: boolean
  view: ViewKind
  beforeLabel: string
  afterLabel: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const {width} = useSize(panel)
  const [glass] = useState(glassSupported)
  const floating =
    utility && showPlayback ? (
      <UtilityPlayback
        projection={projection}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
        always={view !== 'renderer'}
        room={Number.isFinite(width) ? width - 2 * utilitySide : undefined}
      />
    ) : undefined
  const scrollTop: CSSProperties | undefined = floating ? {paddingTop: utilityInset + utilityBarHeight + 12} : undefined
  return {
    panel,
    floating,
    scrollTop,
    /** Whether the toolbar still plans a playback row: only without a utility area. */
    toolbarPlayback: showPlayback && !utility,
    paneLabels: utility ? ('chips' as const) : ('visible' as const),
    rootStyle: overlayTheme(glass),
  }
}

import type {CSSProperties, ReactNode} from 'react'
import type {ProjectionController} from './projection.js'
import {StageBody} from './stage/body.js'
import type {Side} from './modes.js'
import type {PaneState} from './pane.js'
import type {PaneEdge, PaneLabels} from './stage/layout.js'
import {ProjectionLegend} from './stage/legend.js'

/** The props of `ProjectionStage`: the controller to present and how the stage lays out and labels its panes. */
export interface ProjectionStageProps {
  projection: ProjectionController
  /** Visible labels for the before and after panes, for example revision names. Accessible names always say "Before revision" and "After revision". */
  labels?: {before?: ReactNode; after?: ReactNode}
  /**
   * How side by side and swipe show each pane's label: as a header band above it (default `visible`), or as a quiet chip
   * overlaid on its frame (`chips`), on the renderer's own stage, taking no height. In side by side each pane has its
   * chip at its top start; in swipe the before chip is at the top left and the after chip at the top right, each
   * revealed with its side. Frames under chips get the `stage-inset-top` theme token, so renderers that honour it
   * start their content below the chip. `hidden` leaves the panes to the renderer, for a host that names the revisions elsewhere. Single-frame
   * modes show no pane label (the playback slider names the revisions). Either way the labels name the panes for
   * assistive technology.
   */
  paneLabels?: PaneLabels
  /**
   * The stage's utility area in animated and diff, its one-frame modes: controls (such as the playback slider) in a bar
   * floating over the stage's top edge, inset from its sides and as wide as they need, instead of a toolbar row above
   * it. Side by side and swipe have their pane labels there instead (with `paneLabels: 'chips'`). The stage measures
   * what it overlays on each frame and sends it as the frame's `stage-cover` and `stage-inset-top` theme tokens, so a
   * renderer keeps its content clear of the bar (a fitted canvas only where its drawing would reach it) and shows
   * under it as it pans or scrolls. A new cover is fitted to at once, never eased.
   */
  utility?: ReactNode
  /** Hides the stage while keeping its renderer frames loaded, for example while a table view is shown. */
  hidden?: boolean
  /** Below this width (CSS px) side-by-side panes stack. Default 640. */
  stackBelow?: number
  /**
   * Renders a pane's loading or failure state. While the pane loads, the
   * slot covers the frame's area and centers what it renders; the default is
   * `LoadingStatus` while loading and plain, accessible text for a failure;
   * `null` hides it (for UIs that show `rendererStatus` and `rendererErrors`
   * themselves).
   */
  renderStatus?: ((pane: PaneState, side: Side | 'main') => ReactNode) | null
  /**
   * Draws the renderer's legend once below the panes (outside the swipe layers). Default true; pass false to draw
   * `projection.legend` yourself.
   */
  legend?: boolean
  /**
   * Fill the container's height: panes share it, and frames fill their pane instead of growing to the renderer's
   * content (renderers scroll inside). Give the container a definite height. Default false.
   */
  fill?: boolean
  /**
   * The edge of each pane in side by side and swipe, around its label band and frame: a 1px `border` shorthand and a
   * `radius`, drawn inside the pane's box, and `between`, the rule left and right panes meet at in place of a gutter.
   * Defaults to flat panes, like the single frame, meeting at a divider hairline.
   */
  paneEdge?: PaneEdge
  /**
   * How far, CSS px, renderer frames extend past the stage's outer start and end edges (default 0), for a host that
   * lines renderer content up with its page's column: it sends the same `stage-inset` theme token, so the content
   * starts at the stage's edge and focus rings there still show, in the page's gutter. The edges panes meet at (side
   * by side's middle) don't bleed. Use flat pane edges (no radius) with it: panes no longer clip their frames.
   */
  bleed?: number
  className?: string
  style?: CSSProperties
}

const defaultPaneEdge: PaneEdge = {border: '0 none', radius: '0', between: '1px solid var(--projections-color-divider, #83827d)'}

/**
 * The renderer frames for a projection: one frame in animated mode; before
 * and after panes with shared selection, hover and (when the host turns on
 * `connector`) a connector in side by side;
 * stacked layers behind a divider in swipe. Structure only, styled inline with
 * the theme tokens, so it needs no stylesheet. Controls belong to the embedding UI.
 *
 * The after pane keeps its place in the document in every mode, so the
 * animated frame becomes the after pane (and back) without reloading: a mode
 * switch loads at most the before frame.
 */
export function ProjectionStage({
  projection,
  labels,
  paneLabels = 'visible',
  hidden = false,
  stackBelow = 640,
  renderStatus,
  legend = true,
  fill = false,
  paneEdge = defaultPaneEdge,
  bleed = 0,
  utility,
  className,
  style,
}: ProjectionStageProps) {
  if (!projection.renderer) return null
  return (
    <div
      className={`ph-stage ${className ?? ''}`}
      hidden={hidden}
      data-comparison-mode={projection.comparing ? projection.mode : undefined}
      data-fill={fill || undefined}
      style={{
        minWidth: 0,
        ...(fill ? {display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0} : {}),
        ...(hidden ? {display: 'none'} : {}),
        ...style,
      }}
    >
      <StageBody
        projection={projection}
        beforeLabel={labels?.before ?? 'Before'}
        afterLabel={labels?.after ?? 'After'}
        stackBelow={stackBelow}
        renderStatus={renderStatus}
        fill={fill}
        paneEdge={paneEdge}
        bleed={bleed}
        paneLabels={paneLabels}
        utility={utility}
      />
      {legend && projection.legend && <ProjectionLegend projection={projection} />}
    </div>
  )
}

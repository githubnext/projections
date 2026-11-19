import {comparisonModes} from '@githubnext/projections-host'
import type {ComparisonMode, ProjectionController} from '@githubnext/projections-host'

/** A view of the projection: the renderer's, or the host's built-in table or text view. */
export type ViewKind = 'renderer' | 'table' | 'text'

/** Which controls and views the VS Code UI offers. Every feature defaults on. */
export interface VscodeProjectionFeatures {
  /** Play, pause, step and scrub an animated comparison. */
  playback?: boolean
  /** The comparison modes to offer, or `false` to hide the mode switch. */
  modes?: readonly ComparisonMode[] | false
  /** Change highlighting in Settings. */
  highlighting?: boolean
  /** The scope (Changes, All, Noise): the toolbar's scope switch and "Show" in Settings. */
  changesOnly?: boolean
  /** The Filter action with "Filter rows". */
  search?: boolean
  /** Choosing among compatible renderer bundles in Settings. */
  rendererChoice?: boolean
  /** Playback speed in Settings. */
  speed?: boolean
  /** Controls a renderer declares, in Settings. */
  rendererControls?: boolean
  /** The renderer's `zoom` group in the toolbar (`ZoomControls`); off, those controls are in Settings. */
  zoom?: boolean
  /** The built-in table view. */
  table?: boolean
  /** The built-in text view. */
  text?: boolean
  /** The About this projection action. */
  info?: boolean
  /** The full screen action. */
  fullscreen?: boolean
  /** The projection title heading (visually hidden), for example off when the page already titles it. */
  title?: boolean
  /** Annotation markers in the renderer, table, text and details views. Off, `annotations` aren't shown anywhere. */
  annotations?: boolean
  /**
   * The summary bar along the bottom of the view (`SummaryBar`): a figure per kind, the changes of each, and the varied
   * toggle. Off, the varied toggle returns to the toolbar.
   */
  summary?: boolean
}

export const on = (features: VscodeProjectionFeatures | undefined, name: Exclude<keyof VscodeProjectionFeatures, 'modes'>) =>
  features?.[name] !== false

/** The modes a feature set offers, in display order. */
export function offeredModes(features: VscodeProjectionFeatures | undefined): readonly ComparisonMode[] {
  const all = comparisonModes.map(option => option.value)
  const chosen = features?.modes ? all.filter(mode => (features.modes as readonly ComparisonMode[]).includes(mode)) : all
  return chosen.length ? chosen : all
}

/** The active renderer as the host labels it, for example "Graph renderer · built-in, sandboxed". */
export function rendererLabel(projection: Pick<ProjectionController, 'renderer'>): string {
  const {renderer} = projection
  return renderer
    ? `${renderer.title} renderer · ${renderer.source === 'builtin' ? 'built-in' : 'custom'}, sandboxed`
    : 'No renderer · built-in table and text views'
}

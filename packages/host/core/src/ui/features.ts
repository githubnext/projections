import {comparisonModes} from '../modes.js'
import type {ComparisonMode} from '../modes.js'
import type {ProjectionController} from '../projection.js'

/** The presentations a `ViewSwitch` offers: the renderer, and the host's table and text views. */
export type ViewKind = 'renderer' | 'table' | 'text'

/** Which controls and views the prebuilt views offer. Every feature defaults on. */
export interface ProjectionFeatures {
  /** Play, pause, step and scrub an animated comparison. */
  playback?: boolean
  /** The comparison modes to offer, or `false` to hide the mode switch. */
  modes?: readonly ComparisonMode[] | false
  /** Change highlighting in Settings. */
  highlighting?: boolean
  /** The scope (Changes, All, Noise): the toolbar's scope switch and "Show" in Settings. */
  changesOnly?: boolean
  /** The Filter button with "Filter rows". */
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
  /** The About this projection button. */
  info?: boolean
  /** The full screen button. */
  fullscreen?: boolean
  /** The projection title heading (visually hidden in the dense layout), for example off when the page already titles it. */
  title?: boolean
  /** Annotation markers in the renderer, table, text and details views. Off, `annotations` aren't shown anywhere. */
  annotations?: boolean
  /**
   * The summary bar along the bottom of the view (`SummaryBar`): a figure per kind, the changes of each, and the varied
   * toggle. Off, the varied toggle returns to the toolbar.
   */
  summary?: boolean
}

/** Whether a feature is on (every feature defaults on). */
export const featureOn = (features: ProjectionFeatures | undefined, name: Exclude<keyof ProjectionFeatures, 'modes'>) =>
  features?.[name] !== false

/** The modes a feature set offers, in display order. */
export function offeredModes(features: ProjectionFeatures | undefined): readonly ComparisonMode[] {
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

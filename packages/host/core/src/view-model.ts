// What a host UI offers around a projection: its views, which controls show, and the scope's choices, derived from the
// controller and the host's feature switches. Every UI takes these defaults from here and changes them only through
// the options, so the default UI, the VS Code UI and custom UIs behave alike unless one chooses otherwise.
import type {ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {comparisonModes} from './modes.js'
import type {ComparisonMode} from './modes.js'
import type {ProjectionController} from './projection/types.js'
import {nothingHiddenTitle} from './scope.js'
import {zoomControlGroup} from './settings.js'

/** A presentation of the projection: the renderer's, or the host's built-in table or text view. */
export type ViewKind = 'renderer' | 'table' | 'text'

/** Which controls and views a host UI offers. Every feature defaults on. */
export interface ProjectionFeatures {
  /** Play, pause, step and scrub an animated comparison. */
  playback?: boolean
  /** The comparison modes to offer, or `false` to hide the mode switch. */
  modes?: readonly ComparisonMode[] | false
  /** Change highlighting in Settings. */
  highlighting?: boolean
  /** The scope (Changes, All, Noise): the toolbar's scope switch and "Show" in Settings. */
  changesOnly?: boolean
  /** Find: the Filter control with "Filter rows". */
  search?: boolean
  /** Choosing among compatible renderer bundles in Settings. */
  rendererChoice?: boolean
  /** Playback speed in Settings. */
  speed?: boolean
  /** Controls a renderer declares, in Settings and (its `zoom` group) the toolbar. */
  rendererControls?: boolean
  /** The renderer's `zoom` group in the toolbar; off, those controls are in Settings. */
  zoom?: boolean
  /** The built-in table view. */
  table?: boolean
  /** The built-in text view. */
  text?: boolean
  /** About this projection. */
  info?: boolean
  /** Full screen. */
  fullscreen?: boolean
  /** The projection title heading (visually hidden in the dense layout), for example off when the page already titles it. */
  title?: boolean
  /** Annotation markers in the renderer, table, text and details views. Off, `annotations` aren't shown anywhere. */
  annotations?: boolean
  /**
   * The summary bar along the bottom of the view: a figure per kind, the changes of each, and the varied toggle. Off,
   * the varied toggle returns to the toolbar.
   */
  summary?: boolean
}

/** A feature that is on or off (every one but `modes`). */
export type FeatureName = Exclude<keyof ProjectionFeatures, 'modes'>

/** Whether a feature is on: every feature is, unless turned off. */
export const featureOn = (features: ProjectionFeatures | undefined, name: FeatureName) => features?.[name] !== false

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

/**
 * The views a host offers, in order: the renderer's when there is one, then the table and text views the features
 * keep. Never empty: with neither a renderer nor a built-in view, the table.
 */
export function offeredViews(projection: Pick<ProjectionController, 'renderer'>, features?: ProjectionFeatures): ViewKind[] {
  const views: ViewKind[] = [
    ...(projection.renderer ? ['renderer' as const] : []),
    ...(featureOn(features, 'table') ? ['table' as const] : []),
    ...(featureOn(features, 'text') ? ['text' as const] : []),
  ]
  return views.length ? views : ['table']
}

/** The view shown for a choice: the chosen one while it is offered, else the first offered. */
export const shownView = (views: readonly ViewKind[], chosen: ViewKind | undefined): ViewKind =>
  chosen !== undefined && views.includes(chosen) ? chosen : views[0]!

/** The built-in view to offer when the renderer fails: the table, else the text view, else none. */
export const recoveryView = (views: readonly ViewKind[]): 'table' | 'text' | undefined =>
  views.includes('table') ? 'table' : views.includes('text') ? 'text' : undefined

/** What a view is, for assistive technology and About: the renderer's label, or the built-in view's name. */
export const viewLabel = (projection: Pick<ProjectionController, 'renderer'>, view: ViewKind): string =>
  view === 'renderer' && projection.renderer ? rendererLabel(projection) : view === 'table' ? 'Built-in table view' : 'Built-in text view'

/** The options of `viewControls`: the host's features, the view shown, and the defaults a host may change. */
export interface ViewControlsOptions {
  features?: ProjectionFeatures | undefined
  /** The view shown (`shownView`). */
  view: ViewKind
  /**
   * When playback shows. `animated` (the default): in the Animated mode only, beside every view. `always`: also beside
   * the table and text views in every other mode, which present the transition's progress too.
   */
  playbackInViews?: 'animated' | 'always'
}

/** Which of a view's controls show, and with what. */
export interface ViewControls {
  /** The modes to offer: those the features offer that the renderer supports, in the renderer's order. */
  modes: readonly ComparisonMode[]
  /** The mode switch: comparing, in the renderer's view, with more than one mode to offer. */
  modeSwitch: boolean
  /** The scope switch (`scopeChoice`): comparing, with the `changesOnly` feature on. */
  scope: boolean
  /** Playback (see `ViewControlsOptions.playbackInViews`). */
  playback: boolean
  /** The renderer declares a `zoom` group and the host offers it, in the renderer's view. */
  zoom: boolean
  /** The `zoom` group's controls to draw: none while the renderer has failed. */
  zoomControls: readonly RendererControl[]
  /** The varied toggle in the toolbar: something varied, and there is no summary bar to hold the toggle. */
  varied: boolean
}

/** Which controls a host UI shows for a view, by the shared defaults (see `ViewControlsOptions` for what may change). */
export function viewControls(
  projection: Pick<
    ProjectionController,
    'comparing' | 'mode' | 'renderer' | 'availableModes' | 'controls' | 'rendererStatus' | 'variation'
  >,
  {features, view, playbackInViews = 'animated'}: ViewControlsOptions,
): ViewControls {
  const p = projection
  const on = (name: FeatureName) => featureOn(features, name)
  const offered = offeredModes(features)
  const modes = features?.modes === false ? [] : p.availableModes.filter(mode => offered.includes(mode))
  const inRenderer = view === 'renderer' && Boolean(p.renderer)
  const zoom = on('zoom') && on('rendererControls') && inRenderer && p.controls.some(control => control.group === zoomControlGroup)
  return {
    modes,
    modeSwitch: p.comparing && inRenderer && modes.length > 1,
    scope: p.comparing && on('changesOnly'),
    playback: on('playback') && p.comparing && (p.mode === 'animated' || (playbackInViews === 'always' && view !== 'renderer')),
    zoom,
    zoomControls: zoom && p.rendererStatus !== 'failed' ? p.controls.filter(control => control.group === zoomControlGroup) : [],
    varied: p.comparing && ((p.variation?.within ?? 0) > 0 || (p.variation?.regenerated ?? 0) > 0) && !on('summary'),
  }
}

/** The informational notices a view shows, without the renderer notice when the host shows that apart. */
export const viewNotices = (projection: Pick<ProjectionController, 'notices'>, rendererNoticeApart: boolean): string[] =>
  projection.notices.slice(rendererNoticeApart ? 1 : 0)

/** Each scope's name and what choosing it shows. */
export const scopeNames: Readonly<Record<ViewScope, {label: string; title: string}>> = {
  changes: {label: 'Changes', title: 'Show the changes and what they need to be read, folding the rest'},
  all: {label: 'All', title: 'Show every item'},
  noise: {label: 'Noise', title: 'Show only the items that varied within tolerance or were regenerated'},
}

/** One scope a scope switch offers. */
export interface ScopeOption {
  scope: ViewScope
  label: string
  /** What choosing it shows, with how many items it holds: `Show every item (412)`. */
  title: string
}

/** What a scope switch offers. */
export interface ScopeChoice {
  /**
   * Every item is a change or gives one context, so Changes and All show the same: a host shows a note
   * ("Changes · nothing hidden") in the switch's place. Never while the scope is Noise.
   */
  nothingHidden: boolean
  /** The note's tooltip, with the number of changes. */
  noteTitle: string
  /** Changes and All, and Noise while it is the scope (it is chosen from Settings or the summary bar). */
  options: readonly ScopeOption[]
}

/** What a scope switch offers for the controller's scope and counts. */
export function scopeChoice(projection: Pick<ProjectionController, 'scope' | 'scopeCounts'>): ScopeChoice {
  const {scope, scopeCounts} = projection
  const scopes: ViewScope[] = scope === 'noise' ? ['changes', 'all', 'noise'] : ['changes', 'all']
  return {
    nothingHidden: !scopeCounts.hidden && scope !== 'noise',
    noteTitle: `${nothingHiddenTitle} (${scopeCounts.changes.toLocaleString()})`,
    options: scopes.map(option => ({
      scope: option,
      label: scopeNames[option].label,
      title: `${scopeNames[option].title} (${scopeCounts[option].toLocaleString()})`,
    })),
  }
}

/** The one play button: what pressing it does (`togglePlayback`), the way it goes, and its name. */
export interface PlayButton {
  /** `pause` while playing; else `play`, or under reduced motion `show`, which shows the endpoint at once. */
  action: 'pause' | 'play' | 'show'
  /** `nextDirection`: forward from the before end, backward from the after end, else the way playback last went. */
  direction: 1 | -1
  /** "Pause", "Play forward", "Play backward", or under reduced motion "Show <after label>" or "Show <before label>". */
  label: string
}

/** The one play button for the controller's playback, naming the revisions with the host's labels. */
export function playButton(
  projection: Pick<ProjectionController, 'playing' | 'nextDirection' | 'reducedMotion'>,
  beforeLabel: string,
  afterLabel: string,
): PlayButton {
  const {playing, nextDirection: direction, reducedMotion} = projection
  if (playing) return {action: 'pause', direction, label: 'Pause'}
  if (reducedMotion) return {action: 'show', direction, label: `Show ${direction === 1 ? afterLabel : beforeLabel}`}
  return {action: 'play', direction, label: direction === 1 ? 'Play forward' : 'Play backward'}
}

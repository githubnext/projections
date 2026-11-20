import type {RefObject} from 'react'
import type {ComparisonMode, FullscreenState, ProjectionController} from '@githubnext/projections-host'
import {zoomGroup} from '../blocks.js'
import type {VscodeProjectionFeatures, ViewKind} from '../blocks.js'
import type {ToolbarAction, ToolbarLayout} from '../layout/steps.js'
import {featureOn} from './options.js'
import type {VscodeProjectionViewProps} from './props.js'

export interface ViewToolbarProps {
  projection: ProjectionController
  props: Pick<VscodeProjectionViewProps, 'toolbarStart' | 'centreModes' | 'actions' | 'comparator' | 'diagnostics' | 'utilityArea'>
  features: VscodeProjectionFeatures
  /** The modes the features offer that the renderer supports. */
  modes: readonly ComparisonMode[]
  view: ViewKind
  views: readonly ViewKind[]
  setView: (view: ViewKind) => void
  root: RefObject<HTMLDivElement | null>
  fullscreen: FullscreenState
  beforeLabel: string
  afterLabel: string
}

/** What the toolbar shows: the mode switch, playback, and the actions that collapse into More in order. */
export function toolbarContent({projection: p, props, features, modes, view}: ViewToolbarProps) {
  const on = featureOn(features)
  const {comparing, mode} = p
  const showZoom = on('zoom') && on('rendererControls') && view === 'renderer' && p.controls.some(control => control.group === zoomGroup)
  const zoomControls = showZoom && p.rendererStatus !== 'failed' ? p.controls.filter(control => control.group === zoomGroup) : []
  // The varied toggle is the summary bar's, unless the view has none.
  const showVaried = comparing && ((p.variation?.within ?? 0) > 0 || (p.variation?.regenerated ?? 0) > 0) && !on('summary')
  const collapsible: ToolbarAction[] = [
    ...(showVaried ? (['varied'] as const) : []),
    ...(zoomControls.length > 0 ? (['zoom'] as const) : []),
    ...(on('info') ? (['info'] as const) : []),
    ...(on('fullscreen') ? (['fullscreen'] as const) : []),
    ...(on('search') ? (['filter'] as const) : []),
  ]
  return {
    on,
    showModeSwitch: features.modes !== false && comparing && modes.length > 1 && view === 'renderer',
    // With a utility area the renderer view's playback floats on the stage.
    showPlayback: on('playback') && comparing && mode === 'animated' && !(props.utilityArea && view === 'renderer'),
    showZoom,
    zoomControls,
    showVaried,
    collapsible,
  }
}

/**
 * Which actions are in More, and Settings' features: a zoom group with a slider or a choice can't be menu items, so in
 * More's place it joins the controls in Settings.
 */
export function overflow(
  layout: Pick<ToolbarLayout, 'moreActions'>,
  zoomControls: readonly {type: string}[],
  features: VscodeProjectionFeatures,
) {
  const inMore = (action: ToolbarAction) => layout.moreActions.includes(action)
  const zoomInMenu = inMore('zoom') && zoomControls.length > 0 && zoomControls.every(control => control.type === 'action')
  const settingsFeatures = inMore('zoom') && zoomControls.length > 0 && !zoomInMenu ? {...features, zoom: false} : features
  const moreItems = layout.moreActions.filter(action => action !== 'zoom' || zoomInMenu)
  return {inMore, settingsFeatures, moreItems}
}

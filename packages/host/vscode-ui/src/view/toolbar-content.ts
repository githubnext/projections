import type {RefObject} from 'react'
import {viewControls, type ComparisonMode, type FullscreenState, type ProjectionController} from '@githubnext/projections-host'
import type {VscodeProjectionFeatures, ViewKind} from '../blocks.js'
import type {ToolbarAction, ToolbarLayout} from '../layout/steps.js'
import {featureOn} from './options.js'
import type {VscodeProjectionViewProps} from './props.js'

export interface ViewToolbarProps {
  projection: ProjectionController
  props: Pick<
    VscodeProjectionViewProps,
    'toolbarStart' | 'centreModes' | 'actions' | 'comparator' | 'diagnostics' | 'utilityArea' | 'playbackInViews'
  >
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
  const controls = viewControls(p, {features, view, ...(props.playbackInViews ? {playbackInViews: props.playbackInViews} : {})})
  const {zoom: showZoom, zoomControls, varied: showVaried} = controls
  const collapsible: ToolbarAction[] = [
    ...(showVaried ? (['varied'] as const) : []),
    ...(zoomControls.length > 0 ? (['zoom'] as const) : []),
    ...(on('info') ? (['info'] as const) : []),
    ...(on('fullscreen') ? (['fullscreen'] as const) : []),
    ...(on('search') ? (['filter'] as const) : []),
  ]
  return {
    on,
    showModeSwitch: controls.modeSwitch && modes.length > 1,
    // With a utility area the renderer view's playback floats on the stage.
    showPlayback: controls.playback && !(props.utilityArea && view === 'renderer'),
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

import type {ComparisonMode, ProjectionOptions, ProjectionSelection} from '@githubnext/projections-host'
import {offeredModes} from '../blocks.js'
import type {VscodeProjectionFeatures} from '../blocks.js'
import type {VscodeTheme} from '../theme/dom.js'
import type {VscodeProjectionViewProps} from './props.js'

/** Whether a feature is on: every feature is, unless turned off. */
export const featureOn = (features: VscodeProjectionFeatures) => (name: Exclude<keyof VscodeProjectionFeatures, 'modes'>) =>
  features[name] !== false

/** The initial mode: the requested one when offered, else the first offered. */
function allowedMode(mode: ComparisonMode | undefined, features: VscodeProjectionFeatures | undefined): ComparisonMode | undefined {
  const modes = offeredModes(features)
  return mode && modes.includes(mode) ? mode : features?.modes ? modes[0] : mode
}

/** The view's props that `useProjection` takes as they are, when given. */
const passedThrough = [
  'notices',
  'durationMs',
  'initialProgress',
  'onOpen',
  'onAnnotationActivate',
  'onProgressChange',
  'progress',
  'playing',
  'onPlayingChange',
  'mode',
  'onModeChange',
  'swipePosition',
  'onSwipePositionChange',
  'highlighting',
  'onHighlightingChange',
  'changesOnly',
  'onChangesOnlyChange',
  'search',
  'onSearchChange',
  'controlValues',
  'onControlChange',
  'onAction',
  'initialHolds',
  'loop',
  'initialLoop',
  'onLoopChange',
  'connector',
  'initialConnector',
  'onConnectorChange',
] as const satisfies readonly (keyof VscodeProjectionViewProps & keyof ProjectionOptions)[]

type PassedThrough = {[Name in (typeof passedThrough)[number]]?: Exclude<VscodeProjectionViewProps[Name], undefined>}

/** The given pass-through props, leaving out those not given. */
function given(props: VscodeProjectionViewProps): PassedThrough {
  const options: Record<string, unknown> = {}
  for (const name of passedThrough) if (props[name] !== undefined) options[name] = props[name]
  return options as PassedThrough
}

/**
 * The `useProjection` options for the view's props: its renderer first among the others, the VS Code theme's color
 * mode and tokens under the props' overrides, annotations unless turned off, and the initial mode the features allow.
 */
export function projectionOptions(
  props: VscodeProjectionViewProps,
  vscode: Pick<VscodeTheme, 'colorMode' | 'tokens'>,
  onSelectionChange: (selection: ProjectionSelection | null) => void,
): ProjectionOptions {
  const renderer = props.renderer
  const presentationMode = allowedMode(props.initialMode ?? props.presentation?.mode, props.features)
  return {
    subject: props.subject,
    projection: props.projection,
    renderers: renderer ? [renderer, ...(props.renderers ?? []).filter(entry => entry.url !== renderer.url)] : [],
    rendererNotice: props.rendererNotice,
    presentation: props.presentation,
    colorMode: props.colorMode && props.colorMode !== 'auto' ? props.colorMode : vscode.tokens ? vscode.colorMode : 'auto',
    themeTokens: {...vscode.tokens, ...props.themeTokens},
    ...given(props),
    onSelectionChange,
    ...(props.annotations && props.features?.annotations !== false ? {annotations: props.annotations} : {}),
    ...(presentationMode ? {initialMode: presentationMode} : {}),
  }
}

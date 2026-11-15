// The building blocks, one module per concern (features, toolbar, pickers, view controls, playback, settings, about,
// full screen, raw details), gathered under their public names.
export {offeredModes, rendererLabel} from './features.js'
export type {ViewKind, VscodeProjectionFeatures} from './features.js'
export type {PopoverControl} from './toolbar-popover.js'
export {MoreMenu, Toolbar} from './toolbar.js'
export type {MoreMenuItem} from './toolbar.js'
export {PairPicker, ProjectionPicker, shortRevisionLabel} from './pickers.js'
export type {PairForm, ProjectionChoice} from './pickers.js'
export {
  FilterButton,
  modeIconNames,
  ModeSwitch,
  ShowAsChip,
  RegeneratedToggle,
  VariedToggle,
  viewName,
  ViewSwitch,
  ZoomControls,
  zoomGroup,
} from './view-controls.js'
export type {ShowAsProps} from './view-controls.js'
export {handlePlaybackKey, Playback, playButtonState} from './playback.js'
export {hasSettings, SettingsMenu} from './settings-menu.js'
export {ComparatorLine, InfoButton, subjectLimitations} from './about.js'
export {FullscreenButton, fullscreenFallbackClass} from './fullscreen-button.js'
export {RawDetails} from './raw-details.js'

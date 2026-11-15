// VS Code UI for the Projections host core: VSCode Elements and codicons, themed by VS Code's --vscode-* variables.
// Import './styles.css' and link the codicon stylesheet (`./codicon.css`) with the id `vscode-codicon-stylesheet`.
export {VscodeProjectionView} from './view.js'
export {offeredModes} from './blocks.js'
export {Prose} from './prose.js'
export type {VscodeProjectionFeatures, ViewKind} from './blocks.js'
export type {VscodeProjectionViewProps} from './view/props.js'
export {VscodeComparisonExplorer} from './explorer.js'
export type {VscodeComparisonExplorerProps} from './explorer.js'
export {LoadingStatus} from './loading.js'
export {Notice} from './notice.js'
export {StageNotice} from './stage-notice.js'
export type {StageNoticeProps} from './stage-notice.js'
export {DetailCard} from './detail-card.js'
export {ValueChange} from './detail-card/value-change.js'
export {GeneratedList, GeneratedValue, VariedList} from './varied.js'
export {generatedForm, rowDetails} from '@githubnext/projections-host'
export {SummaryBar} from './summary-bar.js'
export {runningDelayMs, runningIndicator, runningMinimumMs, runningText} from './running.js'
export type {Running, RunningTimers} from './running.js'
export type {DetailCardProps} from './detail-card.js'
export type {EvidenceLink, EvidenceLocation, LoadingStatusProps} from '@githubnext/projections-host'
export {AnnotationMarker, ChangeLabel, annotationText, changeHue, changeLabel} from './views/row-parts.js'
export {VscodeDetails} from './views/details.js'
export {VscodeLegend} from './views/legend.js'
export {VscodeTableView} from './views/table.js'
export {VscodeTextView} from './views/text.js'
export type {ChangeHue} from './views/row-parts.js'
export type {VscodeBuiltInViewProps} from './views/props.js'
export type {VscodeDetailsProps} from './views/details.js'
export type {VscodeLegendProps} from './views/legend.js'
export {RangeInput, SelectMenu, VscodeRendererControl, VscodeRendererControls, speeds, vscodeControlIcons} from './controls.js'
// Layer-2 blocks, a stable public tier (README "Building blocks"): the same names and props as the default UI's
// (`@githubnext/projections-host/ui`) where it has one.
export {
  ComparatorLine,
  FilterButton,
  FullscreenButton,
  InfoButton,
  ModeSwitch,
  MoreMenu,
  PairPicker,
  Playback,
  ProjectionPicker,
  RawDetails,
  SettingsMenu,
  ShowAsChip,
  RegeneratedToggle,
  VariedToggle,
  Toolbar,
  ViewSwitch,
  ZoomControls,
  fullscreenFallbackClass,
  handlePlaybackKey,
  hasSettings,
  modeIconNames,
  playButtonState,
  rendererLabel,
  shortRevisionLabel,
  subjectLimitations,
  viewName,
  zoomGroup,
} from './blocks.js'
export type {MoreMenuItem, PairForm, PopoverControl, ProjectionChoice, ShowAsProps} from './blocks.js'
// VS Code's widgets VSCode Elements has no component for: an anchored widget, a context menu with menu roles, a quick pick.
export {Menu} from './overlay/menu.js'
export {Overlay, OverlayLayer} from './overlay/overlay.js'
export {QuickPick} from './overlay/quick-pick.js'
export type {MenuItem} from './overlay/menu-entry.js'
export type {MenuProps} from './overlay/menu.js'
export type {OverlayProps} from './overlay/overlay.js'
export type {QuickPickItem, QuickPickProps} from './overlay/quick-pick.js'
// The React wrappers for the VSCode Elements this UI uses.
export * from './elements.js'
export {useFullscreen} from '@githubnext/projections-host'
// The toolbar's priority-collapse layout, for toolbars composed from the blocks.
export {actionCollapseOrder, narrowToolbarWidth, playbackRowShare, toolbarHysteresis, toolbarSteps} from './layout/steps.js'
export {toolbarGrid} from './layout/grid.js'
export {useToolbarLayout} from './layout/use-toolbar-layout.js'
export type {ToolbarAction, ToolbarContent, ToolbarLayout} from './layout/steps.js'
export type {ToolbarRegions} from './layout/grid.js'
// The core pieces a custom layout composes the blocks around.
export {PaneLabel, ProjectionLegend, ProjectionStage, useComparisonPair, useProjection} from '@githubnext/projections-host'
export {codiconTokens} from './icons.generated.js'
export {isHighContrast, vscodeColorMode, vscodeThemeKindOf} from './theme/kinds.js'
export {readVscodeVariables, useVscodeTheme, vscodeTheme} from './theme/dom.js'
export {vscodeThemeTokens} from './theme/tokens.js'
export {vscodeTokenMap, vscodeVariableNames} from './theme/variables.js'
export type {ColorMode, VscodeThemeKind, VscodeVariables} from './theme/kinds.js'
export type {VscodeTheme} from './theme/dom.js'
export {codiconNames} from './icons.generated.js'
export {modeCodicons, uiCodicons} from './codicons.js'
export {applyVscodeTheme, ensureCodiconStylesheet, vscodeThemeClasses} from './frame.js'
export type {VscodeThemeFixture} from './frame.js'

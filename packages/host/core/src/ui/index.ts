export {ProjectionView} from './view.js'
export {RawDetails} from './view/raw-details.js'
export {DetailCard} from './detail-card.js'
export {GeneratedList, GeneratedValue} from './detail-card/generated.js'
export {ValueChange, VariedList} from './detail-card/values.js'
export type {DetailCardProps} from './detail-card/props.js'
export type {EvidenceLink, EvidenceLocation} from '../details/evidence.js'
export type {VariedField} from '../details/fields.js'
export type {ProjectionViewProps} from './view/props.js'
export type {ViewKind} from './blocks.js'
export {ComparisonExplorer} from './explorer.js'
export type {ComparisonExplorerProps, ExtractionChoice} from './explorer.js'
export {TableView, TextView} from './views.js'
export {SummaryBar} from './summary-bar.js'
export {Prose} from './prose.js'
export type {BuiltInViewProps} from './views.js'
export {ComparisonModeControl, RendererControl, RendererControls} from './controls.js'
// Layer-2 blocks: bound to a `ProjectionController` (or a `ComparisonPair`), the same names and props as the VS Code UI's.
export {
  ComparatorLine,
  FilterButton,
  FullscreenButton,
  InfoButton,
  ModeSwitch,
  MoreMenu,
  MoreSection,
  PairPicker,
  PlayButton,
  Playback,
  PlaybackExtras,
  SettingsMenu,
  ShowAs,
  ShowAsChip,
  StepButtons,
  Toolbar,
  ToolbarRow,
  RegeneratedToggle,
  VariedToggle,
  ViewSwitch,
  ZoomControls,
  featureOn,
  hasSettings,
  modeIcons,
  offeredModes,
  playbackIcons,
  playLabel,
  rendererLabel,
  spaceTogglesPlayback,
  subjectLimitations,
  useViewFullscreen,
  zoomGroup,
} from './blocks.js'
export {PaneLabel} from '../stage/labels.js'
export {LoadingStatus} from '../loading.js'
export {ProjectionsPane, paneHeaderHeight, paneMinWidth, paneWidth, usePaneRoom, usePinnedPane} from './projections-pane.js'
export type {ProjectionsPaneItem} from './projections-pane.js'
export type {LoadingStatusProps} from '../loading.js'
export {ScopedRoot} from './components/scoped-root.js'
export type {ScopedRootProps} from './components/scoped-root.js'
export type {ModeForm, PairForm, ProjectionFeatures, ShowAsOptions} from './blocks.js'
export {actionCollapseOrder, toolbarPlans, useToolbarLayout} from './toolbar-layout.js'
export {fitWidth} from './fit-plan.js'
export type {ToolbarAction, ToolbarContent, ToolbarPlan} from './toolbar-layout.js'
export {useColorMode} from './lib/color-mode.js'
export {projectorRendererTokens, shadcnRendererTokens} from './lib/tokens.js'

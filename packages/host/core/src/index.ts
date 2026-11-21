// Headless core: state, renderer frames and data. Default UI: `@githubnext/projections-host/ui`.
export {createProjection, useProjection, highlightingModes} from './projection.js'
export {defaultDuration, minimumDurationMs, playbackDuration, progressForKey, stepDurationMs} from './projection.js'
export {
  adjacentStop,
  stepStops,
  advancePlayback,
  advanceTimeline,
  atStop,
  endpointHoldMs,
  holdDuration,
  holdsSettings,
  minimumHoldMs,
  playbackTurn,
  presentationProgress,
  startPlayback,
  stepHoldMs,
  timelineDuration,
  timelinePosition,
  timelineStepPositions,
} from './playback.js'
export type {
  StepStop,
  Holds,
  PlaybackFrame,
  PlaybackPlan,
  PlaybackState,
  PlaybackStep,
  PlaybackTimeline,
  TimelineState,
} from './playback.js'
export type {
  AnnotationActivation,
  Highlighting,
  PaneKey,
  ProjectionAnchor,
  PresentationDefaults,
  ProjectionController,
  ProjectionOptions,
  ProjectionStore,
  RendererStatus,
  ScopeCounts,
  ScopeHidden,
  StageBinding,
} from './projection.js'
export {paintState} from './projection/paint.js'
export type {PaintState, Painted} from './projection/paint.js'
export {ProjectionStage} from './stage.js'
export {nothingHiddenTitle, scopeHiddenShort, scopeHiddenText} from './scope.js'
export {arrangementHysteresis, paneArrangement, paneGeometry} from './stage/arrangement.js'
export {PaneLabel} from './stage/labels.js'
export {ProjectionLegend} from './stage/legend.js'
export {LoadingStatus, loadingStageHeight, usePrefersReducedMotion} from './loading.js'
export type {LoadingStatusProps} from './loading.js'
export {useProjectionAnchor} from './anchor.js'
export {
  figuresSentence,
  fitSummary,
  rowInSummary,
  sameSummaryFilter,
  summaryFigures,
  summaryFilterable,
  summaryFactTitle,
  summaryFilterOf,
  summaryToggle,
  summaryToggleTitle,
  useSummaryFit,
} from './summary.js'
export type {SummaryFigure, SummaryFilter, SummaryKind} from './summary.js'
export {chooseFitPlan, fitWidth, toolbarHysteresis, useFitPlan} from './fit-plan.js'
export type {FitChoice, FitHysteresis, FitPlanOptions} from './fit-plan.js'
export {
  featureOn,
  offeredModes,
  offeredViews,
  playButton,
  recoveryView,
  rendererLabel,
  scopeChoice,
  scopeNames,
  shownView,
  viewControls,
  viewLabel,
  viewNotices,
} from './view-model.js'
export type {
  FeatureName,
  PlayButton,
  ProjectionFeatures,
  ScopeChoice,
  ScopeOption,
  ViewControls,
  ViewControlsOptions,
  ViewKind,
} from './view-model.js'
export {useViewChoice} from './view-choice.js'
export {formatRevisionLabel, parseRevisionLabel, revisionAge, revisionLabelName} from './revision-label.js'
export type {RevisionLabelParts} from './revision-label.js'
export {handlePlaybackShortcut, isPlaybackShortcut, rovingIndex, spaceKeeping} from './keyboard.js'
export type {KeyEventLike} from './keyboard.js'
export type {ViewChoice} from './view-choice.js'
export {rowDetails} from './details.js'
export {changeContextItems} from './context-items.js'
export type {ContextItems} from './context-items.js'
export {changeParts, changeTags} from './details/change.js'
export {generatedForm} from './details/generated.js'
export {variedText} from './details/fields.js'
export type {RowDetails, RowDetailsLimits} from './details.js'
export type {ChangeHue, ChangePart} from './details/change.js'
export type {DetailConnection} from './details/connections.js'
export type {DetailEvidence, EvidenceLink, EvidenceLocation} from './details/evidence.js'
export type {FieldChange, VariedField} from './details/fields.js'
export type {GeneratedField, GeneratedForm} from './details/generated.js'
export {useDetailCard} from './detail-card.js'
export {placeDetailCard} from './detail-card/placement.js'
export type {DetailCard, DetailCardOptions} from './detail-card.js'
export type {DetailCardPlacement, DetailCardPlacementOptions, DetailCardSide, PlacementRect} from './detail-card/placement.js'
export {decodeTarget, encodeTarget} from './targets/encoding.js'
export {isProjectionTarget, resolveTarget, rowTargets, sameTarget, targetExtraction, targetItem} from './targets/target.js'
export {placeAnnotations} from './targets/annotations.js'
export {propertyPath, readPointer} from './targets/pointer.js'
export {targetDigest, targetDigests} from './targets/digest.js'
export type {ProjectionSelection, ProjectionTarget, TargetAnnotation, TargetResolution} from './targets/target.js'
export type {ProjectionStageProps} from './stage.js'
export type {PaneArrangement} from './stage/arrangement.js'
export type {PaneEdge, PaneLabels} from './stage/layout.js'
export {useComparisonPair} from './pair.js'
export {runningDelayMs, runningIndicator, runningMinimumMs, runningText} from './running.js'
export type {Running, RunningTimers} from './running.js'
export {useRunningIndicator} from './use-running.js'
export {comparisonSessionDefaults, useComparisonSession} from './comparison-session.js'
export type {ComparisonSessionOptions, ComparisonSessionSettings} from './comparison-session.js'
export type {ComparisonPair, ComparisonPairOptions, ExtractionChoice, PairOutcome} from './pair.js'
export {
  clampMode,
  comparisonModes,
  connectorBetween,
  connectorPath,
  defaultComparisonMode,
  defaultComparisonModes,
  orderComparisonModes,
  twoPaneMode,
} from './modes.js'
export type {ComparisonMode, Connector, Side} from './modes.js'
export {RendererPane} from './pane.js'
export type {PaneState, RendererPaneProps} from './pane.js'
export {describeChange, rowItems, rowStatusCounts, statusLabel, subjectRows, subjectVariation} from './model.js'
export type {Row, Variation, ViewSubject} from './model.js'
export {RendererFrame} from './frame.js'
export {fetchedRendererDocuments, rendererBlobDocument, rendererDocumentHtml, setRendererDocuments} from './frame/documents.js'
export type {RendererDocumentOpener} from './frame/documents.js'
export type {RendererFrameEvent, RendererFrameOptions, RendererFrameStatus} from './frame/types.js'
export {ComparisonError, compareExtractions, computeComparison, explainDefinitionMismatch, sha256} from './compare.js'
export type {ComparatorSource, ComparisonErrorCode, ComputedComparison, RulesRuntime} from './compare.js'
export {
  builtinRendererDocuments,
  compatibleRenderers,
  customRenderer,
  loadRendererCatalog,
  rendererAccepts,
  resolveRenderer,
} from './registry.js'
export type {
  RendererCatalogDocument,
  RendererDocuments,
  RendererEntry,
  RendererResolution,
  RendererSubject,
  WithheldRenderer,
} from './registry.js'
export {hostTheme, themeStyle} from './theme.js'
export {composite, contrast, ensureContrast, formatColor, luminance, mix, parseColor, withAlpha} from './color.js'
export type {Rgba} from './color.js'
export {appThemeTokens, hostChromeVariables} from './app-theme.js'
export type {AppThemeColors, AppThemeRules} from './app-theme.js'
export {copilotCanvasThemeTokens, copilotCanvasVariableNames, readCopilotCanvasTheme} from './copilot-canvas-theme.js'
export type {CopilotCanvasTheme, CopilotCanvasVariables} from './copilot-canvas-theme.js'
export {formatThemeSeed, parseThemeSeed, parseThemeSeedText, themeSeedKeys, themeSeedMaxLength, themeSeedTokens} from './theme-seed.js'
export type {ThemeSeed, ThemeSeedColors, ThemeSeedResult} from './theme-seed.js'
export {
  rendererContentSecurityPolicy,
  rendererMetaContentSecurityPolicy,
  rendererSandbox,
  rendererLimits,
  rendererProtocolVersion,
  annotationTones,
  badgeIconNames,
  controlIcons,
  controlValues,
  defaultThemeTokens,
  iconMaskStyle,
  iconNames,
  iconToken,
  isControlValue,
  isIconValue,
  isPropertyPath,
  parseControls,
  resolveThemeTokens,
  themeTokenNames,
  themeTokenSetVersion,
} from '@githubnext/projections-renderer-sdk/protocol'
export type {
  AnchorRect,
  AnnotationMark,
  AnnotationTone,
  ControlIcon,
  LegendItem,
  LegendShape,
  RendererLegend,
  RendererSummary,
  SummaryCountItem,
  SummaryFactItem,
  SummaryFactTone,
  SummaryItem,
  SummaryNoun,
  ControlValue,
  FilterPayload,
  HostMessage,
  InitPayload,
  ProgressPayload,
  RendererCapabilities,
  RendererControl,
  RendererEnvironment,
  RendererManifest,
  RendererMessage,
  RendererOptions,
  RendererTheme,
  ScrollPosition,
  ThemeTokenName,
  IconName,
  IconTokenName,
} from '@githubnext/projections-renderer-sdk/protocol'
export {
  humanizeKind,
  summaryCounts,
  summaryDeltas,
  summaryDeltaText,
  summaryDeltaWords,
  summaryCountText,
  summarySentence,
  variedBeyond,
  variedBeyondLabel,
  variedName,
  variedValue,
  variedWithin,
  variedWords,
  viewScopes,
} from '@githubnext/projections-renderer-sdk/presentation'
export type {SummaryCount, SummaryDelta, ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
export {useFullscreen} from './fullscreen.js'
export type {FullscreenState} from './fullscreen.js'
export {paneMinWidth, usePaneRoom, usePinnedPane} from './projections-pane.js'
export {
  hasSettingsModel,
  highlightingChoices,
  playbackSpeeds,
  settingsControls,
  settingsLabels,
  settingsModel,
  zoomControlGroup,
} from './settings.js'
export {maxRendererSubmenus, rendererOptionGroups} from './settings/renderer-options.js'
export type {
  SettingsEntry,
  SettingsFeatures,
  SettingsGroup,
  SettingsModel,
  SettingsOption,
  SettingsShowAs,
  SettingsSubmenu,
  SettingsView,
} from './settings.js'

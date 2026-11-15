// The headless core: `useProjection` and its options, controller and timing, one module each.
export {highlightingModes} from './projection/types.js'
export type {
  AnnotationActivation,
  Highlighting,
  PaneKey,
  PresentationDefaults,
  ProjectionAnchor,
  ProjectionController,
  ProjectionOptions,
  RendererStatus,
  StageBinding,
} from './projection/types.js'
export {defaultDuration, minimumDurationMs, playbackDuration, progressForKey, stepDurationMs} from './projection/timing.js'
export {useProjection} from './projection/use-projection.js'

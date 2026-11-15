/*
 * The step timeline lives in the renderer SDK (`@githubnext/projections/renderer`)
 * so that renderers built without the kit follow comparison steps and the same
 * hold policy. The kit re-exports it unchanged.
 */
export {
  compileTimeline,
  DirectionLatch,
  emphasisRise,
  motionWindow,
  readingShare,
  scheduleSteps,
  stepEnds,
  stepHoldShare,
  stepHolds,
  stepProgress,
  timelineSlots,
} from '@githubnext/projections-renderer-sdk/presentation'
export type {ScheduledStep} from '@githubnext/projections-renderer-sdk/presentation'

import type {AnnotationMark, ControlValue, FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {Anchors} from './interaction.js'
import type {Memos} from './memo.js'
import type {RendererPayloads} from './payloads.js'
import type {PaneKey, StageBinding} from './types.js'

/** The stage's handlers: the same functions for a projection's lifetime, acting on what it shows now. */
export type StageHandlers = Pick<
  StageBinding,
  'frames' | 'onPaneState' | 'onAnchor' | 'onFrame' | 'onViewport' | 'onSelect' | 'onAnnotation'
>

/**
 * What `ProjectionStage` binds its renderer frames to: the payloads they are sent and the handlers for their messages,
 * a new binding only when something in it changed.
 */
export function createStageBinding({memo}: Memos, handlers: StageHandlers) {
  return memo(
    (
      payloads: RendererPayloads,
      options: Record<string, ControlValue>,
      action: StageBinding['action'],
      filter: FilterPayload,
      anchors: Anchors,
      selectedPath: Record<PaneKey, string | undefined>,
      annotations: AnnotationMark[],
    ): StageBinding => ({
      init: payloads.init,
      environment: payloads.environment,
      progressPayload: payloads.progressPayload,
      endpoints: payloads.endpoints,
      diffProgress: payloads.diffProgress,
      options,
      action,
      filter,
      anchors,
      ...handlers,
      selectedPath,
      annotations,
    }),
  )
}

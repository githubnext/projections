import type {ColorMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {ProjectionOptions} from '../../projection.js'
import type {ProjectionSelection} from '../../targets/target.js'
import {featureOn} from '../blocks.js'
import type {ProjectionViewProps} from './props.js'

/** The headless core's options for a `ProjectionView`: its props, with only what the embedder set passed through. */
export function viewOptions(props: ProjectionViewProps, colorMode: ColorMode, themeTokens: {[name: string]: string}): ProjectionOptions {
  return {
    subject: props.subject,
    projection: props.projection,
    renderers: props.renderer ? [props.renderer, ...(props.renderers ?? []).filter(entry => entry.url !== props.renderer!.url)] : [],
    rendererNotice: props.rendererNotice,
    ...(props.rendererDocuments ? {rendererDocuments: props.rendererDocuments} : {}),
    ...(props.notices ? {notices: props.notices} : {}),
    presentation: props.presentation,
    colorMode,
    themeTokens,
    ...(props.durationMs !== undefined ? {durationMs: props.durationMs} : {}),
    ...(props.initialProgress !== undefined ? {initialProgress: props.initialProgress} : {}),
    ...(props.onOpen ? {onOpen: props.onOpen} : {}),
    ...(props.onSelectionChange
      ? {onSelectionChange: (selection: ProjectionSelection | null) => props.onSelectionChange?.(selection?.rowId ?? null, selection)}
      : {}),
    ...(props.annotations && featureOn(props.features, 'annotations') ? {annotations: props.annotations} : {}),
    ...(props.onAnnotationActivate ? {onAnnotationActivate: props.onAnnotationActivate} : {}),
    ...(props.onProgressChange ? {onProgressChange: props.onProgressChange} : {}),
    ...(props.progress !== undefined ? {progress: props.progress} : {}),
    ...(props.playing !== undefined ? {playing: props.playing} : {}),
    ...(props.onPlayingChange ? {onPlayingChange: props.onPlayingChange} : {}),
    ...(props.mode ? {mode: props.mode} : {}),
    ...(props.initialMode ? {initialMode: props.initialMode} : {}),
    ...(props.onModeChange ? {onModeChange: props.onModeChange} : {}),
    ...(props.swipePosition !== undefined ? {swipePosition: props.swipePosition} : {}),
    ...(props.onSwipePositionChange ? {onSwipePositionChange: props.onSwipePositionChange} : {}),
    ...(props.initialHolds ? {initialHolds: props.initialHolds} : {}),
    ...(props.loop !== undefined ? {loop: props.loop} : {}),
    ...(props.initialLoop !== undefined ? {initialLoop: props.initialLoop} : {}),
    ...(props.onLoopChange ? {onLoopChange: props.onLoopChange} : {}),
    ...(props.connector !== undefined ? {connector: props.connector} : {}),
    ...(props.initialConnector !== undefined ? {initialConnector: props.initialConnector} : {}),
    ...(props.onConnectorChange ? {onConnectorChange: props.onConnectorChange} : {}),
    ...(props.highlighting ? {highlighting: props.highlighting} : {}),
    ...(props.onHighlightingChange ? {onHighlightingChange: props.onHighlightingChange} : {}),
    ...(props.changesOnly !== undefined ? {changesOnly: props.changesOnly} : {}),
    ...(props.onChangesOnlyChange ? {onChangesOnlyChange: props.onChangesOnlyChange} : {}),
    ...(props.search !== undefined ? {search: props.search} : {}),
    ...(props.onSearchChange ? {onSearchChange: props.onSearchChange} : {}),
    ...(props.controlValues ? {controlValues: props.controlValues} : {}),
    ...(props.onControlChange ? {onControlChange: props.onControlChange} : {}),
    ...(props.onAction ? {onAction: props.onAction} : {}),
  }
}

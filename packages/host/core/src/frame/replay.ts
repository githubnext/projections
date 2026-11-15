import type {
  AnnotationMark,
  FilterPayload,
  HostMessage,
  InitPayload,
  RendererCapabilities,
  RendererOptions,
} from '@githubnext/projections-renderer-sdk/protocol'

/** A `select` message: an item, and a property of it when `path` is set. */
export const selectMessage = (id: string | null, path: string | undefined): HostMessage => ({
  type: 'select',
  id,
  ...(path === undefined ? {} : {path}),
})

/** What the host set for a renderer, kept so a renderer that becomes ready later gets it too. */
export interface FrameState {
  init: InitPayload
  options: RendererOptions
  selection: string | null
  selectionPath: string | undefined
  marks: AnnotationMark[]
  hovered: string | null
  filtering: FilterPayload | undefined
}

/**
 * The messages that bring a renderer that just became ready up to date: the presented documents, then the state set
 * while it loaded that its capabilities accept.
 */
export function replay(state: FrameState, capabilities: RendererCapabilities): HostMessage[] {
  const messages: HostMessage[] = [{type: 'init', ...state.init}]
  if (Object.keys(state.options).length) messages.push({type: 'options', options: state.options})
  if (state.selection !== null) messages.push(selectMessage(state.selection, state.selectionPath))
  if (state.marks.length && capabilities.annotations) messages.push({type: 'annotations', items: state.marks})
  if (state.hovered !== null && capabilities.hover) messages.push({type: 'hover', id: state.hovered})
  if (state.filtering && capabilities.filter) messages.push({type: 'filter', ...state.filtering})
  return messages
}

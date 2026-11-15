// Where a kit renderer's opening view looks: the host's focus request, or a comparison's changes while the host shows
// changes only.
import type {FilterPayload, InitPayload, RendererFocus} from '@githubnext/projections-renderer-sdk/protocol'
import {isChanged} from './emphasis.js'
import type {ComparisonModel} from './model.js'

/** Marks a scroll container whose renderer places its own opening view (see `useScrollAnchor`): the shell leaves it. */
export const placedAttribute = 'data-projections-placed'

const changesFocus: RendererFocus = {on: 'changes'}

/** The host's focus request, else the comparison's changes while it shows changes only. */
export function focusRequest(init: InitPayload | undefined, filter: FilterPayload | undefined): RendererFocus | undefined {
  if (init?.focus) return init.focus
  return init?.mode === 'comparison' && filter?.changesOnly ? changesFocus : undefined
}

/**
 * The selection IDs a focus request names, in a model: its item, or every changed entity and relationship. Undefined
 * when it names none (`all`, or no request); in diff mode without a request, the changes.
 */
export function focusedIds(model: ComparisonModel | undefined, focus: RendererFocus | undefined, diff: boolean): Set<string> | undefined {
  if (focus?.id !== undefined) return new Set([focus.id])
  if (!model || model.mode !== 'comparison' || focus?.on === 'all' || (!focus && !diff)) return undefined
  return new Set([...model.entities, ...model.relationships].filter(isChanged).map(row => row.id))
}

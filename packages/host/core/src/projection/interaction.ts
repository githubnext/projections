// What the viewer points at besides the selected row, as a reducer: the target pinned to the selected row, the hovered
// row and where each side's renderer shows items (anchors).
import type {AnchorRect} from '@githubnext/projections-renderer-sdk/protocol'
import type {Side} from '../modes.js'
import type {ProjectionTarget} from '../targets/target.js'

export type Anchors = Record<Side, Record<string, AnchorRect | null>>

/** The specific target chosen for a row: a property, or one the host selected. */
export type Pinned = {rowId: string; target: ProjectionTarget} | null

/** What the viewer points at besides the selected row: its pinned target, the hovered row and the renderers' anchors. */
export interface Interaction {
  pinned: Pinned
  hoveredId: string | null
  anchors: Anchors
}

/** What happens to the interaction. */
export type InteractionEvent =
  /** A row is selected, with the target chosen for it, if any. */
  | {type: 'selected'; rowId: string | null; target?: ProjectionTarget | undefined}
  | {type: 'hovered'; rowId: string | null}
  /** A side's renderer reports where an item is, or that it doesn't show. */
  | {type: 'anchored'; side: Side; rowId: string; rect: AnchorRect | null}
  /**
   * A side has a new frame (or none): its anchors belong to the old one's renderer. A frame that persists across a mode
   * change keeps them, since its renderer only reports anchors that move.
   */
  | {type: 'frameReplaced'; side: Side}
  /** A new subject starts over. */
  | {type: 'restarted'}

export const initialInteraction: Interaction = {pinned: null, hoveredId: null, anchors: {before: {}, after: {}}}

/** How the interaction changes; the same state when an event changes nothing. */
export function interaction(state: Interaction, event: InteractionEvent): Interaction {
  switch (event.type) {
    case 'selected': {
      const pinned = event.rowId !== null && event.target ? {rowId: event.rowId, target: event.target} : null
      return pinned === null && state.pinned === null ? state : {...state, pinned}
    }
    case 'hovered':
      return state.hoveredId === event.rowId ? state : {...state, hoveredId: event.rowId}
    case 'anchored': {
      const side = state.anchors[event.side]
      if (Object.hasOwn(side, event.rowId) && sameRect(side[event.rowId]!, event.rect)) return state
      return {...state, anchors: {...state.anchors, [event.side]: {...side, [event.rowId]: event.rect}}}
    }
    case 'frameReplaced':
      return Object.keys(state.anchors[event.side]).length ? {...state, anchors: {...state.anchors, [event.side]: {}}} : state
    case 'restarted':
      return state === initialInteraction ? state : initialInteraction
  }
}

function sameRect(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

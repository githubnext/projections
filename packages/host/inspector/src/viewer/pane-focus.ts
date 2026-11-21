// Where keyboard focus is, and where it goes next, between the viewer's projections pane and the title's projection
// menu, which take each other's place: pinning or closing the pane, the page narrowing or widening past the pane's
// room, and the server going away each move it. The pane and the menu report focus coming and going, and take focus
// when the state asks it of them (`toPane`, `toMenu`) once they are shown, then say so (`taken`).
import {defineMachine, ignore} from '@githubnext/projections-machine'

/** One of the two places that take each other's place. */
export type FocusPlace = 'pane' | 'menu'

/**
 * Where focus is: in the pane or the menu, `elsewhere` (anywhere else, or nowhere), or waiting to move into the pane
 * or the menu once it is shown.
 */
export type PaneFocus =
  | {readonly kind: 'elsewhere'}
  | {readonly kind: 'pane'}
  | {readonly kind: 'menu'}
  | {readonly kind: 'toPane'}
  | {readonly kind: 'toMenu'}

/** What moves focus. */
export type PaneFocusEvent =
  /** The person pinned the pane: it takes focus once shown. */
  | {readonly type: 'pinned'}
  /** The person closed the pane: the menu takes focus once shown. */
  | {readonly type: 'closed'}
  /** Focus came into the pane or the menu. */
  | {readonly type: 'entered'; readonly place: FocusPlace}
  /** Focus left it for somewhere else. */
  | {readonly type: 'left'; readonly place: FocusPlace}
  /**
   * It went away (the page narrowed or widened past the pane's room). `lost`: focus was left on the page, not moved
   * on; `replaced`: the other is there to take it (not while the server is gone, nor with one projection).
   */
  | {readonly type: 'gone'; readonly place: FocusPlace; readonly lost: boolean; readonly replaced: boolean}
  /** The place asked to take focus has taken it, or tried. */
  | {readonly type: 'taken'}
  /** The server stopped answering: nothing is shown to take focus, so nothing waits to. */
  | {readonly type: 'stopped'}

const elsewhere: PaneFocus = {kind: 'elsewhere'}
const toward = (place: FocusPlace): PaneFocus => (place === 'pane' ? {kind: 'toPane'} : {kind: 'toMenu'})
const other = (place: FocusPlace): FocusPlace => (place === 'pane' ? 'menu' : 'pane')

/** What every state does alike: the person pins or closes, and focus comes into either place. */
const always = {
  pinned: (): PaneFocus => toward('pane'),
  closed: (): PaneFocus => toward('menu'),
  entered: (_state: PaneFocus, {place}: {place: FocusPlace}): PaneFocus => ({kind: place}),
} as const

/** While focus is in `place`: it leaves, or `place` goes away with it, which hands it to the other where it is there. */
const holding = (place: FocusPlace) =>
  ({
    ...always,
    left: (state: PaneFocus, event: {place: FocusPlace}): PaneFocus => (event.place === place ? elsewhere : state),
    gone: (state: PaneFocus, event: {place: FocusPlace; lost: boolean; replaced: boolean}): PaneFocus =>
      event.place !== place ? state : event.lost && event.replaced ? toward(other(place)) : elsewhere,
    taken: ignore,
    stopped: ignore,
  }) as const

/** While focus waits to move: the place takes it, or the server goes and nothing is left to take it. */
const waiting = {
  ...always,
  left: ignore,
  gone: ignore,
  taken: (): PaneFocus => elsewhere,
  stopped: (): PaneFocus => elsewhere,
} as const

export const paneFocusMachine = defineMachine<PaneFocus, PaneFocusEvent>()({
  states: {
    elsewhere: {on: {...always, left: ignore, gone: ignore, taken: ignore, stopped: ignore} as const},
    pane: {on: holding('pane')},
    menu: {on: holding('menu')},
    toPane: {on: waiting},
    toMenu: {on: waiting},
  },
})

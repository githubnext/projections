// A webview page's lifecycle as the extension sees it, and the commands (controls) sent to the Inspector on it. A page
// loads (the extension set its HTML, or VS Code reloaded a page it dropped while the tab was hidden), says it is ready,
// and closes with its panel. A control asked for while the page loads waits for it; one posted to a page that then
// reloads, or that never answers, fails rather than waiting for a page that will never reply.
import {after, defineMachine, emit, ignore} from '@githubnext/projections-machine'
import type {ControlRequest} from '../protocol.js'

/** A command for the page's Inspector: its id, the request and how long it may take, from when it was asked for. */
export interface Control {
  readonly id: number
  readonly message: ControlRequest
  readonly timeoutMs: number
}

/** The page's lifecycle. `page` counts the loads the extension started; the page echoes it in its `ready`. */
export type PageState =
  | {readonly kind: 'loading'; readonly page: number; readonly waiting: readonly Control[]}
  | {readonly kind: 'ready'; readonly page: number; readonly sent: readonly Control[]}
  | {readonly kind: 'closed'}

/** What happens to the page and its controls. */
export type PageEvent =
  /** The extension loaded the page (set its HTML): the `page`th load. */
  | {readonly type: 'loaded'; readonly page: number}
  /** VS Code reloaded the page it had dropped (the page asked to restore): the same HTML, so the same `page`. */
  | {readonly type: 'dropped'}
  /** The page said it is ready; `page` is the load it belongs to (absent from a page that doesn't say). */
  | {readonly type: 'ready'; readonly page?: number | undefined}
  /** A caller asked for a control. */
  | {readonly type: 'asked'; readonly control: Control}
  /** The page answered a control. */
  | {readonly type: 'answered'; readonly id: number; readonly result?: unknown; readonly error?: string | undefined}
  /** A control's time ran out. */
  | {readonly type: 'expired'; readonly id: number}
  /** The panel closed. */
  | {readonly type: 'closed'}

/** What the page's lifecycle asks the webview to do. */
export type PageEffect =
  | {readonly type: 'post'; readonly control: Control}
  | {readonly type: 'resolve'; readonly id: number; readonly result: unknown}
  | {readonly type: 'reject'; readonly id: number; readonly reason: string}

const reject = (controls: readonly Control[], reason: string): PageEffect[] =>
  controls.map(control => ({type: 'reject', id: control.id, reason}))
const without = (controls: readonly Control[], id: number) => controls.filter(control => control.id !== id)
const has = (controls: readonly Control[], id: number) => controls.some(control => control.id === id)
const expiry = (controls: readonly Control[]) =>
  controls.map(control => after(`control:${control.id}`, control.timeoutMs, {type: 'expired', id: control.id} as PageEvent))

/** Reasons a control fails. */
export const failures = {
  timeout: 'The Inspector did not answer',
  reloaded: 'The Inspector reloaded before it answered',
  closed: 'The Inspector was closed',
} as const

/** The lifecycle of a webview page and its controls. */
export const pageLifecycle = defineMachine<PageState, PageEvent, PageEffect>()({
  states: {
    loading: {
      on: {
        loaded: (state, {page}) => ({...state, page}),
        dropped: ignore,
        // A ready from an earlier load (its HTML already replaced) isn't this page's.
        ready: (state, {page}) =>
          page !== undefined && page !== state.page
            ? state
            : emit(
                {kind: 'ready', page: state.page, sent: state.waiting},
                ...state.waiting.map(control => ({type: 'post', control}) as const),
              ),
        asked: (state, {control}) => ({...state, waiting: [...state.waiting, control]}),
        answered: ignore,
        expired: (state, {id}) =>
          has(state.waiting, id)
            ? emit({...state, waiting: without(state.waiting, id)}, {type: 'reject', id, reason: failures.timeout})
            : state,
        closed: state => emit({kind: 'closed'}, ...reject(state.waiting, failures.closed)),
      },
      activities: state => expiry(state.waiting),
    },
    ready: {
      on: {
        loaded: (state, {page}) => emit({kind: 'loading', page, waiting: []}, ...reject(state.sent, failures.reloaded)),
        dropped: state => emit({kind: 'loading', page: state.page, waiting: []}, ...reject(state.sent, failures.reloaded)),
        ready: ignore,
        asked: (state, {control}) => emit({...state, sent: [...state.sent, control]}, {type: 'post', control}),
        answered: (state, {id, result, error}) =>
          has(state.sent, id)
            ? emit(
                {...state, sent: without(state.sent, id)},
                error === undefined ? {type: 'resolve', id, result} : {type: 'reject', id, reason: error},
              )
            : state,
        expired: (state, {id}) =>
          has(state.sent, id) ? emit({...state, sent: without(state.sent, id)}, {type: 'reject', id, reason: failures.timeout}) : state,
        closed: state => emit({kind: 'closed'}, ...reject(state.sent, failures.closed)),
      },
      activities: state => expiry(state.sent),
    },
    closed: {
      on: {
        loaded: ignore,
        dropped: ignore,
        ready: ignore,
        asked: (state, {control}) => emit(state, {type: 'reject', id: control.id, reason: failures.closed}),
        answered: ignore,
        expired: ignore,
        closed: ignore,
      },
    },
  },
})

// A planned bar's lifecycle: the plan it renders, planning it again when it resizes (on the next frame) or when focus
// leaves a control a lock kept mounted (once the event's other handlers have run), and never between a pointer's press
// and its click. The plans are the UI's, so a plan is opaque here; `useFitPlan` measures them in a layout effect and
// sends what it finds (`resized`, `tried`, `fitted`).
import {after, defineMachine, ignore} from '@githubnext/projections-machine'

/** Whether a pointer is pressed: the plan isn't replanned away between a press and its click. */
export type FitPlanHand = 'free' | 'pressing'

type Planned = {
  /** The plan the bar renders. */
  readonly plan: unknown
  /** The plan the bar last settled on: a move to a more spacious plan is measured from it (the hysteresis). */
  readonly settled: unknown
  /** The bar's width the plan is measured at, in whole pixels. */
  readonly width: number
  /**
   * Counts the replans asked for from outside (a frame after a resize, content that settled, focus leaving a locked
   * bar): each measures again.
   */
  readonly run: number
  readonly hand: FitPlanHand
  /** Whether a resize was observed: the bar is planned again on the next frame. */
  readonly frame: boolean
}

/**
 * `planning` while the bar is measured as rendered and other plans are tried, `settled` once it keeps one (`locked`
 * while a person's use of the bar holds it), `held` when focus moved during a press while a lock held it (the replan
 * waits for the release) and `releasing` until focus that moved has finished moving.
 */
export type FitPlanState =
  | (Planned & {readonly kind: 'planning'})
  | (Planned & {readonly kind: 'settled'; readonly locked: boolean})
  | (Planned & {readonly kind: 'held'})
  | (Planned & {readonly kind: 'releasing'})

/** What happens to a planned bar. */
export type FitPlanEvent =
  /** The bar isn't as wide as the plan was measured at: it renders at the new width before measuring. */
  | {readonly type: 'resized'; readonly width: number}
  /** Another plan is tried. */
  | {readonly type: 'tried'; readonly plan: unknown}
  /** The plan shown is kept; `locked` while a person's use of the bar holds it. */
  | {readonly type: 'fitted'; readonly plan: unknown; readonly locked: boolean}
  /** The bar or one of its regions resized. */
  | {readonly type: 'observed'}
  /** The frame after a resize: the bar is `width` wide. */
  | {readonly type: 'frame'; readonly width: number}
  /** Content that was still rendering (`pending`) has settled: measure again. */
  | {readonly type: 'rendered'}
  /** Focus moved in the document. */
  | {readonly type: 'moved'}
  | {readonly type: 'pressed'}
  | {readonly type: 'released'}
  /** Focus that left a locked bar has finished moving: plan again. */
  | {readonly type: 'replan'}

/** The frame after a resize, while one waits for it. */
export type FitPlanActivity = {readonly type: 'frame'; readonly key: 'frame'}

const planned = ({plan, settled, width, run, hand, frame}: FitPlanState): Planned => ({plan, settled, width, run, hand, frame})

/** What every state does alike: a new width, a plan tried, a resize and its frame, and the pointer. */
const always = {
  resized: (state: FitPlanState, {width}: {width: number}): FitPlanState => ({...planned(state), kind: 'planning', width}),
  tried: (state: FitPlanState, {plan}: {plan: unknown}): FitPlanState => ({...planned(state), kind: 'planning', plan}),
  observed: (state: FitPlanState): FitPlanState => (state.frame ? state : {...state, frame: true}),
  frame: (state: FitPlanState, {width}: {width: number}): FitPlanState => ({
    ...planned(state),
    kind: 'planning',
    width,
    run: state.run + 1,
    frame: false,
  }),
  pressed: (state: FitPlanState): FitPlanState => (state.hand === 'pressing' ? state : {...state, hand: 'pressing'}),
  released: (state: FitPlanState): FitPlanState => (state.hand === 'free' ? state : {...state, hand: 'free'}),
} as const

/** While a replan waits (`held`, `releasing`), the plan shown is kept as it is measured again. */
const keeping = (state: FitPlanState, {plan}: {plan: unknown}): FitPlanState =>
  state.plan === plan && state.settled === plan ? state : {...state, plan, settled: plan}

const frames = (state: FitPlanState): FitPlanActivity[] => (state.frame ? [{type: 'frame', key: 'frame'}] : [])

export const fitPlanLifecycle = defineMachine<FitPlanState, FitPlanEvent, never, FitPlanActivity>()({
  states: {
    planning: {
      on: {
        ...always,
        fitted: (state, {plan, locked}) => ({...planned(state), kind: 'settled', plan, settled: plan, locked}),
        rendered: state => ({...state, run: state.run + 1}),
        // The planning under way reads the lock afresh.
        moved: ignore,
        replan: ignore,
      },
      activities: frames,
    },
    settled: {
      on: {
        ...always,
        fitted: (state, {plan, locked}) =>
          state.plan === plan && state.settled === plan && state.locked === locked ? state : {...state, plan, settled: plan, locked},
        // Focus that moves while a lock holds the plan may have left the control in use: plan again, but not between a
        // press and its click, since another plan would remount the control being clicked (WebKit moves focus on press).
        moved: state =>
          !state.locked ? state : state.hand === 'pressing' ? {...planned(state), kind: 'held'} : {...planned(state), kind: 'releasing'},
        rendered: state => ({...planned(state), kind: 'planning', run: state.run + 1}),
        replan: ignore,
      },
      activities: frames,
    },
    held: {
      on: {
        ...always,
        fitted: keeping,
        // The release replans, and measures again then.
        rendered: ignore,
        moved: ignore,
        pressed: ignore,
        released: state => ({...planned(state), kind: 'releasing', hand: 'free'}),
        replan: ignore,
      },
      activities: frames,
    },
    releasing: {
      on: {
        ...always,
        fitted: keeping,
        rendered: ignore,
        moved: ignore,
        released: ignore,
        pressed: state => ({...planned(state), kind: 'held', hand: 'pressing'}),
        replan: state => ({...planned(state), kind: 'planning', run: state.run + 1}),
      },
      activities: state => [...frames(state), after('replan', 0, {type: 'replan'})],
    },
  },
})

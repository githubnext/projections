// A renderer pane's lifecycle as an explicit machine: loading until its frame is revealed, then ready; failed for good
// when the host stops its renderer, until a new bundle loads. Each state keeps what the renderer has reported so far.
import {defineMachine, ignore} from '@githubnext/projections-machine'
import type {
  InitPayload,
  RendererCapabilities,
  RendererControl,
  RendererLegend,
  SummaryItem,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {PaneState} from './pane.js'

/** What a pane knows of its renderer, in every state. */
export type PaneReports = Omit<PaneState, 'status' | 'message'>

/** The pane's state: its frame's stage, and what its renderer reported. */
export type PaneLifecycleState =
  | {readonly kind: 'loading'; readonly reports: PaneReports}
  | {readonly kind: 'ready'; readonly reports: PaneReports}
  /** The host stopped the renderer (it timed out, navigated or flooded the host): final until a new bundle loads. */
  | {readonly kind: 'failed'; readonly reports: PaneReports; readonly message: string}

/** What a pane hears: its frame's reports, and the host giving it a new document or a new bundle. */
export type PaneLifecycleEvent =
  | {readonly type: 'ready'; readonly capabilities: RendererCapabilities}
  | {readonly type: 'revealed'}
  | {readonly type: 'failed'; readonly message: string}
  /** The renderer acknowledged painting `progress` of the document `init`. */
  | {readonly type: 'rendered'; readonly progress: number; readonly init: InitPayload}
  | {readonly type: 'controls'; readonly controls: RendererControl[]}
  | {readonly type: 'steps'; readonly ends: number[]; readonly slots?: number | undefined}
  | {readonly type: 'aspect'; readonly ratio: number}
  | {readonly type: 'height'; readonly px: number}
  | ({readonly type: 'legend'} & RendererLegend)
  | {readonly type: 'summary'; readonly items: SummaryItem[]}
  | {readonly type: 'error'; readonly message: string}
  | {readonly type: 'rejected'}
  /** The host sent the frame a new document: what was painted and stepped belongs to the old one. */
  | {readonly type: 'reinit'}
  /** The pane loads another bundle, starting over. */
  | {readonly type: 'reloaded'}

export const noReports: PaneReports = {steps: [], rendererErrors: [], rejected: 0, controls: []}

/** The state a pane starts in, and returns to when it loads another bundle. */
export const loadingLifecycle: PaneLifecycleState = {kind: 'loading', reports: noReports}

type Reporting = Exclude<PaneLifecycleState, {kind: 'failed'}>

/** The same state with its reports changed, or the state itself when they don't. */
const reporting = <S extends PaneLifecycleState>(state: S, reports: PaneReports): S =>
  reports === state.reports ? state : {...state, reports}

/** How a running renderer's reports change what the pane knows, in loading and ready alike. */
const reports = {
  ready: (state: Reporting, event: {capabilities: RendererCapabilities}) =>
    reporting(state, {...state.reports, capabilities: event.capabilities, controls: event.capabilities.controls ?? []}),
  rendered: (state: Reporting, event: {progress: number; init: InitPayload}) =>
    reporting(state, {...state.reports, rendered: event.progress, renderedInit: event.init}),
  controls: (state: Reporting, event: {controls: RendererControl[]}) => reporting(state, {...state.reports, controls: event.controls}),
  steps: (state: Reporting, event: {ends: number[]; slots?: number | undefined}) => {
    const {stepSlots: _slots, ...rest} = state.reports
    return reporting(state, {...rest, steps: event.ends, ...(event.slots === undefined ? {} : {stepSlots: event.slots})})
  },
  aspect: (state: Reporting, event: {ratio: number}) =>
    state.reports.aspect === event.ratio ? state : reporting(state, {...state.reports, aspect: event.ratio}),
  height: (state: Reporting, event: {px: number}) =>
    state.reports.height === event.px ? state : reporting(state, {...state.reports, height: event.px}),
  legend: (state: Reporting, event: {type: 'legend'} & RendererLegend) => {
    const {type: _type, ...legend} = event
    if (legend.items.length) return reporting(state, {...state.reports, legend})
    const {legend: _legend, ...rest} = state.reports
    return reporting(state, rest)
  },
  summary: (state: Reporting, event: {items: SummaryItem[]}) => {
    if (!event.items.length) {
      const {summary: _summary, ...rest} = state.reports
      return reporting(state, rest)
    }
    return JSON.stringify(state.reports.summary) === JSON.stringify(event.items)
      ? state
      : reporting(state, {...state.reports, summary: event.items})
  },
  error: (state: Reporting, event: {message: string}) =>
    reporting(state, {...state.reports, rendererErrors: [...state.reports.rendererErrors, event.message].slice(-5)}),
  rejected: (state: Reporting) => reporting(state, {...state.reports, rejected: state.reports.rejected + 1}),
}

/** A new document: the painted progress and the steps belong to the old one. */
const reinit = <S extends PaneLifecycleState>(state: S): S => {
  const {rendered: _rendered, renderedInit: _init, stepSlots: _slots, ...rest} = state.reports
  return {...state, reports: {...rest, steps: []}}
}

const failed = (state: Reporting, event: {message: string}): PaneLifecycleState => ({
  kind: 'failed',
  reports: state.reports,
  message: event.message,
})

export const paneLifecycle = defineMachine<PaneLifecycleState, PaneLifecycleEvent>()({
  states: {
    loading: {
      on: {
        ...reports,
        revealed: state => ({kind: 'ready', reports: state.reports}),
        failed,
        reinit,
        reloaded: () => loadingLifecycle,
      },
    },
    ready: {
      on: {
        ...reports,
        revealed: ignore,
        failed,
        reinit,
        reloaded: () => loadingLifecycle,
      },
    },
    // A stopped frame reports nothing more; only a new bundle starts the pane over.
    failed: {
      on: {
        ready: ignore,
        revealed: ignore,
        failed: ignore,
        rendered: ignore,
        controls: ignore,
        steps: ignore,
        aspect: ignore,
        height: ignore,
        legend: ignore,
        summary: ignore,
        error: ignore,
        rejected: ignore,
        reinit,
        reloaded: () => loadingLifecycle,
      },
    },
  },
})

/** The pane's state as `RendererPane` reports it (`PaneState`): its status, its failure's message and its reports. */
export const paneStateOf = (state: PaneLifecycleState): PaneState =>
  state.kind === 'failed' ? {status: 'failed', message: state.message, ...state.reports} : {status: state.kind, ...state.reports}

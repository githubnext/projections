// The viewer's state (search, filters, presentation, playback and selection) and its reducer.
import type {ChangeStatus} from '@githubnext/projections-schemas'
import {defaultCodeStatisticsOptions, type CodeStatisticsOptions} from '../quantities.js'
import {unit} from './progress.js'

/** Which view a renderer that offers several shows: its own domain view, a generic graph or a table. */
export type Presentation = 'domain' | 'graph' | 'table'

/**
 * A renderer's local viewing state, as `viewerReducer` keeps it: the search and filters `filterFrame` applies, the
 * chosen view, local playback, selection, collapsed groups and code-statistics options. Nothing here reaches the host.
 */
export interface ViewerState {
  /** Free-text search, matched case-insensitively (`matchesFilter`); empty matches everything. */
  search: string
  /** The extraction kind to show, or an empty string for every kind. */
  kind: string
  /** The change status to show, or `all`. */
  status: ChangeStatus | 'all'
  /** The view shown. */
  presentation: Presentation
  /** Local presentation progress, from 0 (before) to 1 (after). */
  progress: number
  /** Whether local playback is running; `advance` stops it at the end it plays toward. */
  playing: boolean
  /** The direction local playback runs: `1` toward after, `-1` toward before. */
  direction: 1 | -1
  /** The selected item's ID, or `null`. */
  selectedId: string | null
  /** IDs of collapsed items, whose descendants `visibleHierarchy` hides. */
  collapsed: ReadonlySet<string>
  /** How code statistics are measured and charted. */
  statistics: CodeStatisticsOptions
}

/**
 * The state a viewer starts in: no search or filters, the domain view, paused at `progress` (default 1, the after
 * side) moving forward, nothing selected or collapsed, and `defaultCodeStatisticsOptions`.
 *
 * @throws `RangeError` when `progress` isn't finite; finite values are clamped to 0 to 1.
 */
export function initialViewerState(progress = 1): ViewerState {
  return {
    search: '',
    kind: '',
    status: 'all',
    presentation: 'domain',
    progress: unit(progress),
    playing: false,
    direction: 1,
    selectedId: null,
    collapsed: new Set(),
    statistics: {...defaultCodeStatisticsOptions},
  }
}

/**
 * A change to `ViewerState`. `search`, `kind`, `status`, `presentation` and `select` set their field; `statistics`
 * merges options; `collapse` toggles an ID; `seek` jumps to a progress and pauses; `play` starts in a direction
 * (from the far end when already at the end it plays toward); `pause` stops; `advance` moves playback by `elapsedMs`
 * of a `durationMs`-long transition; `reset` returns to `initialViewerState(progress)`.
 */
export type ViewerAction =
  | {type: 'search'; value: string}
  | {type: 'kind'; value: string}
  | {type: 'status'; value: ViewerState['status']}
  | {type: 'presentation'; value: Presentation}
  | {type: 'seek'; value: number}
  | {type: 'select'; id: string | null}
  | {type: 'collapse'; id: string}
  | {type: 'statistics'; value: Partial<CodeStatisticsOptions>}
  | {type: 'play'; direction: 1 | -1}
  | {type: 'pause'}
  | {type: 'advance'; elapsedMs: number; durationMs: number}
  | {type: 'reset'; progress?: number}

/**
 * Applies `action` to `state` without mutating it, for `useReducer`. Progress is clamped to 0 to 1; `advance` is a
 * no-op while paused and pauses on reaching the end it plays toward.
 *
 * @throws `RangeError` for a non-finite `seek` or `reset` progress, or an `advance` whose `durationMs` isn't positive
 * and finite or whose `elapsedMs` is negative or not finite.
 *
 * @example
 * ```ts
 * const [state, dispatch] = useReducer(viewerReducer, initialViewerState())
 * dispatch({type: 'play', direction: 1})
 * // Each animation frame:
 * dispatch({type: 'advance', elapsedMs: 16, durationMs: 4000})
 * ```
 */
export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'search':
      return {...state, search: action.value}
    case 'kind':
      return {...state, kind: action.value}
    case 'status':
      return {...state, status: action.value}
    case 'presentation':
      return {...state, presentation: action.value}
    case 'select':
      return {...state, selectedId: action.id}
    case 'statistics':
      return {...state, statistics: {...state.statistics, ...action.value}}
    case 'seek':
      return {...state, progress: unit(action.value), playing: false}
    case 'pause':
      return {...state, playing: false}
    case 'reset':
      return initialViewerState(action.progress)
    case 'collapse': {
      const collapsed = new Set(state.collapsed)
      if (collapsed.has(action.id)) collapsed.delete(action.id)
      else collapsed.add(action.id)
      return {...state, collapsed}
    }
    case 'play':
      return {
        ...state,
        playing: true,
        direction: action.direction,
        progress: action.direction === 1 && state.progress === 1 ? 0 : action.direction === -1 && state.progress === 0 ? 1 : state.progress,
      }
    case 'advance': {
      if (!Number.isFinite(action.durationMs) || action.durationMs <= 0 || !Number.isFinite(action.elapsedMs) || action.elapsedMs < 0) {
        throw new RangeError('Playback requires a positive duration and nonnegative finite elapsed time')
      }
      if (!state.playing) return state
      const progress = unit(state.progress + (state.direction * action.elapsedMs) / action.durationMs)
      return {...state, progress, playing: state.direction === 1 ? progress < 1 : progress > 0}
    }
  }
  throw new TypeError('Unknown viewer action')
}

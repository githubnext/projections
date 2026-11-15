// What a stage presents for a load, before any frame: the fresh state, the environment the frame is told, the
// container's size and the documents' `init`.
import {hostTheme} from '@githubnext/projections-host'
import {diffEmphasis} from '@githubnext/projections-renderer-sdk/presentation'
import type {InitPayload, RendererEntry} from '@githubnext/projections-host'
import type {StageHighlighting, StageLoad, StageState} from '@githubnext/projections-renderer-testing'

export function blank(): StageState {
  return {
    status: 'waiting',
    progress: 1,
    highlighting: 0,
    direction: 1,
    selection: null,
    selections: [],
    steps: [],
    controls: [],
    opened: [],
    errors: [],
    rejected: [],
  }
}

/** The environment a stage presents in: the theme's mode, motion, locale and the held pane, if any. */
export interface PresentedEnvironment {
  colorMode: 'light' | 'dark'
  reducedMotion: boolean
  locale: string
  pane: 'before' | 'after' | null
}

/** The environment the frame is told: the theme, motion and locale, and the pane it holds, if any. */
export function frameEnvironment({colorMode, reducedMotion, locale, pane}: PresentedEnvironment) {
  return {theme: hostTheme(colorMode), reducedMotion, locale, ...(pane ? {pane} : {})}
}

/** The highlighting at `progress`: none for one extraction or `off`, the diff emphasis for `auto`, else the fixed value. */
export function stageHighlighting(comparing: boolean, progress: number, mode: StageHighlighting): number {
  if (!comparing || mode === 'off') return 0
  if (mode === 'auto') return diffEmphasis(progress)
  return Math.max(0, Math.min(1, mode))
}

/** Sizes the stage's container for a load and marks its color mode. */
export function sizeContainer(container: HTMLElement, request: StageLoad, colorMode: PresentedEnvironment['colorMode']): void {
  container.dataset.colorMode = colorMode
  container.style.width = request.width ? `${request.width}px` : ''
  // A fixed height: the frame fills it, as a host that sizes its frames does; otherwise it follows the renderer.
  Object.assign(
    container.style,
    request.height
      ? {height: `${request.height}px`, display: 'flex', flexDirection: 'column'}
      : {height: '', display: '', flexDirection: ''},
  )
}

/** A load's presentation: its fresh state, how it compares, its environment, and its `init` without the environment. */
export interface Presentation {
  state: StageState
  comparing: boolean
  /** Diff mode: one static comparison, no progress. */
  diff: boolean
  highlightingMode: StageHighlighting
  environment: PresentedEnvironment
  init: Omit<InitPayload, 'theme' | 'reducedMotion' | 'locale' | 'pane'>
  /** Whether the first progress is sent; diff mode with its default highlighting sends none. */
  sendProgress: boolean
}

export function presentation(request: StageLoad, bundle: RendererEntry): Presentation {
  const state = blank()
  state.status = 'loading'
  state.bundle = bundle.name
  const comparing = request.subject.mode === 'comparison'
  const diff = comparing && request.comparisonMode === 'diff'
  const highlightingMode = request.highlighting ?? 'auto'
  const environment: PresentedEnvironment = {
    colorMode: request.colorMode ?? 'light',
    reducedMotion: request.reducedMotion ?? false,
    locale: request.locale ?? 'en-US',
    pane: request.pane ?? null,
  }
  state.progress = comparing && !diff ? Math.max(0, Math.min(1, request.progress ?? 1)) : 1
  state.direction = request.direction ?? 1
  // Diff mode has no progress; the renderer emphasizes every change (see the SDK's `isDiff`), unless the
  // load asks for other highlighting, which a host sends as one `progress` at 1.
  const diffHighlighting = diff && request.highlighting !== undefined && request.highlighting !== 'auto'
  state.highlighting = diff && !diffHighlighting ? 1 : stageHighlighting(comparing, diff ? 1 : state.progress, highlightingMode)
  if (comparing && request.comparisonMode) state.comparisonMode = request.comparisonMode
  state.selection = request.selection ?? null
  const projection = request.projection ?? {id: 'fixture', title: 'Fixture'}
  const init = {
    projection: {...projection, renderer: request.renderer},
    ...request.subject,
    ...(request.subject.mode === 'comparison' && request.comparisonMode ? {comparisonMode: request.comparisonMode} : {}),
  }
  return {state, comparing, diff, highlightingMode, environment, init, sendProgress: !(diff && !diffHighlighting)}
}

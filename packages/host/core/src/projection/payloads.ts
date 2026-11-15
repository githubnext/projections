import {useMemo, useRef} from 'react'
import {diffEmphasis} from '@githubnext/projections-renderer-sdk/presentation'
import type {
  InitPayload,
  ProgressPayload,
  RendererEnvironment,
  RendererFocus,
  RendererTheme,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonMode, Side} from '../modes.js'
import type {RendererEntry} from '../registry.js'
import {locale} from './environment.js'
import type {Highlighting, ProjectionOptions} from './types.js'

export type RendererPayloadsInput = {
  options: ProjectionOptions
  renderer: RendererEntry | undefined
  mode: ComparisonMode
  progress: number
  direction: 1 | -1
  highlighting: Highlighting
  theme: RendererTheme
  reducedMotion: boolean
}

/**
 * What the stage sends its renderers: the init payload, the environment, the progress (with its change emphasis), the
 * endpoints side by side and swipe show, and a static diff's progress.
 */
export function useRendererPayloads({
  options,
  renderer,
  mode,
  progress,
  direction,
  highlighting,
  theme,
  reducedMotion,
}: RendererPayloadsInput) {
  const {subject, projection} = options
  // The definition's kind presentation reaches renderers in `init` (see `RendererProjection.kinds`).
  const kindsKey = JSON.stringify(options.presentation?.kinds ?? null)
  const kinds = options.presentation?.kinds
  // A focus is part of the document a renderer is sent, so a new one is a new init; compared by value.
  const focusKey = JSON.stringify(options.focus ?? null)
  const focus = useMemo(() => (JSON.parse(focusKey) as RendererFocus | null) ?? undefined, [focusKey])
  const comparing = subject.mode === 'comparison'
  const emphasis = (at: number) => (!comparing || highlighting === 'off' ? 0 : highlighting === 'on' ? 1 : diffEmphasis(at))
  const progressPayload = useMemo<ProgressPayload>(
    () => ({progress, highlighting: emphasis(progress), direction}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress, comparing, highlighting, direction],
  )
  const endpointHighlighting = comparing && highlighting !== 'off' ? 1 : 0
  // A static diff gets no scrubbing progress. Turning highlighting off reaches it as one progress at 1 with no
  // emphasis; once that was sent, turning it back on sends full emphasis again.
  const diffHighlightingChanged = useRef(false)
  if (mode !== 'diff') diffHighlightingChanged.current = false
  else if (!endpointHighlighting) diffHighlightingChanged.current = true
  const diffTouched = diffHighlightingChanged.current
  const diffProgress = useMemo<ProgressPayload | undefined>(
    () => (diffTouched ? {progress: 1, highlighting: endpointHighlighting, direction: 1} : undefined),
    [diffTouched, endpointHighlighting],
  )
  const endpoints = useMemo<Record<Side, ProgressPayload>>(
    () => ({
      before: {progress: 0, highlighting: endpointHighlighting, direction: 1},
      after: {progress: 1, highlighting: endpointHighlighting, direction: 1},
    }),
    [endpointHighlighting],
  )
  const environment = useMemo<RendererEnvironment>(() => ({theme, reducedMotion, locale: locale()}), [theme, reducedMotion])
  const init = useMemo<InitPayload>(() => {
    const base = {
      projection: {
        id: projection.id,
        title: projection.title,
        renderer: projection.renderer ?? renderer?.name ?? '',
        ...(kinds ? {kinds} : {}),
      },
      ...(focus ? {focus} : {}),
      theme,
      reducedMotion,
      locale: locale(),
    }
    return subject.mode === 'extraction'
      ? {...base, mode: 'extraction', extraction: subject.extraction}
      : {
          ...base,
          mode: 'comparison',
          before: subject.before,
          after: subject.after,
          comparison: subject.comparison,
          ...(mode === 'diff' ? {comparisonMode: 'diff' as const} : {}),
        }
    // Theme and motion changes reach renderers as environment messages, not a new init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, projection.id, projection.title, projection.renderer, renderer?.name, mode === 'diff', kindsKey, focus])
  return {progressPayload, diffProgress, endpoints, environment, init}
}

export type RendererPayloads = ReturnType<typeof useRendererPayloads>

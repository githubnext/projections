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
import {selector} from './memo.js'
import type {Selector} from './memo.js'
import type {Highlighting, ProjectionOptions} from './types.js'

type Kinds = NonNullable<ProjectionOptions['presentation']>['kinds']

export interface RendererPayloadsInput {
  options: ProjectionOptions
  renderer: RendererEntry | undefined
  mode: ComparisonMode
  progress: number
  direction: 1 | -1
  highlighting: Highlighting
  theme: RendererTheme
  reducedMotion: boolean
}

/** What the stage sends its renderers (see `createRendererPayloads`). */
export interface RendererPayloads {
  progressPayload: ProgressPayload
  diffProgress: ProgressPayload | undefined
  endpoints: Record<Side, ProgressPayload>
  environment: RendererEnvironment
  init: InitPayload
}

/**
 * What the stage sends its renderers: the init payload, the environment, the progress (with its change emphasis), the
 * endpoints side by side and swipe show, and a static diff's progress. A selector: each payload keeps its identity while
 * what it is made of does, so a frame is sent a message only when something in it changed.
 */
export function createRendererPayloads(): Selector<[RendererPayloadsInput], RendererPayloads> {
  return selector(({memo, byValue, cell}) => {
    // A focus is part of the document a renderer is sent, so a new one is a new init; compared by value, as kinds are.
    const focusOf = byValue<RendererFocus | undefined>()
    const kindsOf = byValue<Kinds>()
    const progressOf = memo((progress: number, comparing: boolean, highlighting: Highlighting, direction: 1 | -1): ProgressPayload => ({
      progress,
      highlighting: !comparing || highlighting === 'off' ? 0 : highlighting === 'on' ? 1 : diffEmphasis(progress),
      direction,
    }))
    const diffProgressOf = memo((touched: boolean, endpointHighlighting: number): ProgressPayload | undefined =>
      touched ? {progress: 1, highlighting: endpointHighlighting, direction: 1} : undefined,
    )
    const endpointsOf = memo((endpointHighlighting: number): Record<Side, ProgressPayload> => ({
      before: {progress: 0, highlighting: endpointHighlighting, direction: 1},
      after: {progress: 1, highlighting: endpointHighlighting, direction: 1},
    }))
    const environmentOf = memo((theme: RendererTheme, reducedMotion: boolean): RendererEnvironment => ({
      theme,
      reducedMotion,
      locale: locale(),
    }))
    // Theme and motion changes reach renderers as environment messages, not a new init: the init takes the environment
    // of the call that makes it, and isn't remade when only the environment changes.
    let environment: {theme: RendererTheme; reducedMotion: boolean}
    const initOf = memo(
      (
        subject: ProjectionOptions['subject'],
        id: string,
        title: string,
        declared: string | undefined,
        name: string | undefined,
        diff: boolean,
        kinds: Kinds,
        focus: RendererFocus | undefined,
      ): InitPayload => {
        const base = {
          projection: {id, title, renderer: declared ?? name ?? '', ...(kinds ? {kinds} : {})},
          ...(focus ? {focus} : {}),
          ...environment,
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
              ...(diff ? {comparisonMode: 'diff' as const} : {}),
            }
      },
    )
    const resultOf = memo(
      (
        progressPayload: ProgressPayload,
        diffProgress: ProgressPayload | undefined,
        endpoints: Record<Side, ProgressPayload>,
        environment: RendererEnvironment,
        init: InitPayload,
      ): RendererPayloads => ({progressPayload, diffProgress, endpoints, environment, init}),
    )
    // A static diff gets no scrubbing progress. Turning highlighting off reaches it as one progress at 1 with no emphasis;
    // once that was sent, turning it back on sends full emphasis again.
    const diffHighlightingChanged = cell(false)
    return ({options, renderer, mode, progress, direction, highlighting, theme, reducedMotion}) => {
      const {subject, projection} = options
      const comparing = subject.mode === 'comparison'
      const endpointHighlighting = comparing && highlighting !== 'off' ? 1 : 0
      const touched = mode === 'diff' && (!endpointHighlighting || diffHighlightingChanged.read())
      diffHighlightingChanged.write(touched)
      environment = {theme, reducedMotion}
      return resultOf(
        progressOf(progress, comparing, highlighting, direction),
        diffProgressOf(touched, endpointHighlighting),
        endpointsOf(endpointHighlighting),
        environmentOf(theme, reducedMotion),
        initOf(
          subject,
          projection.id,
          projection.title,
          projection.renderer,
          renderer?.name,
          mode === 'diff',
          kindsOf(options.presentation?.kinds),
          focusOf(options.focus),
        ),
      )
    }
  })
}

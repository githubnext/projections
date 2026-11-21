import type {ComparisonMode} from '@githubnext/projections-host'
import type {RendererFocus} from '@githubnext/projections-renderer-sdk/protocol'
import {snapshotFrameSettings} from './frame-settings.js'
import type {SnapshotFrameSettings} from './frame-settings.js'
import {snapshotPlaybackSettings} from './playback-settings.js'
import type {SnapshotPlaybackSettings} from './playback-settings.js'

/**
 * `?view=snapshot`: the chrome-free page `projections snapshot` captures. It
 * presents the document the CLI serves (`GET /api/document`) through the host's
 * stage at a fixed mode, progress and theme, and sets
 * `<html data-projections-snapshot>` to `ready` once every pane has
 * acknowledged painting what was asked and fonts are loaded, or to `failed`
 * with `data-projections-snapshot-error`.
 */
export interface SnapshotSettings extends SnapshotFrameSettings, SnapshotPlaybackSettings {
  theme: 'light' | 'dark'
  /** Explicitly requested; omitted, animated when the renderer has it, else its default. */
  mode?: SnapshotMode
  /** Explicitly requested animated transition progress, 0 (before) to 1 (after); omitted, 1. */
  progress?: number
  /** The revision (a commit or `working-tree`) whose custom renderer bundle the server supplies. */
  definition?: string
  /** The custom renderer needs trust that wasn't granted. */
  withheld: boolean
  /** Where the renderers open their view (`--focus`, `--entity`, `--fit`); omitted, their own choice. */
  focus?: RendererFocus
}
export type SnapshotMode = Extract<ComparisonMode, 'animated' | 'side-by-side' | 'diff'>

const modes: ReadonlySet<SnapshotMode> = new Set(['animated', 'side-by-side', 'diff'])

/** Reads the snapshot settings from the page's query string, rejecting anything unexpected. */
export function snapshotSettings(search: string): SnapshotSettings {
  const query = new URLSearchParams(search)
  const theme = query.get('theme') ?? 'light'
  if (theme !== 'light' && theme !== 'dark') throw new Error(`Unknown snapshot theme ${theme}`)
  const framing = snapshotFrameSettings(query)
  const mode = query.get('mode') ?? undefined
  if (mode !== undefined && !modes.has(mode as SnapshotMode)) throw new Error(`Unknown snapshot mode ${mode}`)
  const progressText = query.get('progress')
  const progress = progressText === null ? undefined : Number(progressText)
  if (progress !== undefined && (progressText === '' || !Number.isFinite(progress) || progress < 0 || progress > 1)) {
    throw new Error('Snapshot progress must be between 0 and 1')
  }
  const definition = query.get('definition') ?? undefined
  if (definition !== undefined && definition !== 'working-tree' && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(definition)) {
    throw new Error('The snapshot definition revision must be a full commit or working-tree')
  }
  const on = query.get('focus') ?? undefined
  if (on !== undefined && on !== 'changes' && on !== 'all') throw new Error(`Unknown snapshot focus ${on}`)
  const entity = query.get('entity') ?? undefined
  if (entity !== undefined && !entity) throw new Error('The snapshot entity must be a selection ID')
  const fit = query.get('fit') === '1'
  const focus: RendererFocus = {...(on ? {on} : {}), ...(entity !== undefined ? {id: entity} : {}), ...(fit ? {fit} : {})}
  return {
    theme,
    ...framing,
    withheld: query.get('withheld') === '1',
    ...(Object.keys(focus).length ? {focus} : {}),
    ...(progress === undefined ? {} : {progress}),
    ...snapshotPlaybackSettings(query),
    ...(mode ? {mode: mode as SnapshotMode} : {}),
    ...(definition ? {definition} : {}),
  }
}

/**
 * The same-origin custom renderer prefix from a `GET /api/renderers` response,
 * `/custom-renderers/<capability>/`, or undefined when the server serves none.
 */
export function customRendererPrefix(value: unknown, origin: string): string | undefined {
  const base = (value as {customRendererBase?: unknown} | null)?.customRendererBase
  if (base === undefined || base === null) return undefined
  if (typeof base !== 'string' || base.length > 1024) throw new Error('The runner returned an invalid custom renderer base')
  const url = new URL(base, origin)
  if (url.origin !== new URL(origin).origin || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('The custom renderer base must be a same-origin directory')
  }
  return url.href
}

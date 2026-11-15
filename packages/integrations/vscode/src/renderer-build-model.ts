/*
 * A custom renderer's build, as the extension asks the backend for it so a saved source reaches the projection's tabs
 * without a separate `npm run watch`: which package builds it, which saved files are its sources, and how the
 * Definition view's Renderer row says the build's state. The backend runs the build and reads its output
 * (packages/cli/src/renderer_builds/). Nothing here imports VS Code (or anything at run time).
 */
import type {ProjectionDefinition} from './projections/definitions.js'

const relative = (path: unknown): string | undefined =>
  typeof path === 'string' && path && !path.startsWith('/') && !path.split(/[\\/]/).includes('..')
    ? path.replace(/^\.\//, '').replace(/\/+$/, '')
    : undefined

/**
 * The renderer package a custom renderer's bundle is built from: the bundle's directory's parent when the bundle is a
 * `dist` directory (as `projections init --renderer custom` scaffolds it, and as the CLI finds a renderer's development
 * server), repository-relative. The caller checks it has a `package.json`.
 */
export function rendererPackage(definition: ProjectionDefinition): string | undefined {
  const renderer = definition.renderer as unknown
  if (!renderer || typeof renderer !== 'object') return undefined
  const bundle = relative((renderer as {bundle?: unknown}).bundle)
  if (!bundle) return undefined
  const parts = bundle.split('/')
  if (parts.at(-1) !== 'dist') return undefined
  return parts.slice(0, -1).join('/') || '.'
}

/** The renderer's sources, repository-relative: its declared `sources`, else its package's `src`. */
export function rendererSources(definition: ProjectionDefinition): string[] {
  const renderer = definition.renderer as unknown
  if (!renderer || typeof renderer !== 'object') return []
  const declared = (renderer as {sources?: unknown}).sources
  const sources = Array.isArray(declared) ? declared.map(relative).filter((path): path is string => Boolean(path)) : []
  if (sources.length) return sources
  const pkg = rendererPackage(definition)
  return pkg ? [pkg === '.' ? 'src' : `${pkg}/src`] : []
}

/**
 * Whether a saved file (repository-relative) is one of the renderer's sources: a declared source or under one, never
 * its bundle, dependencies or build output.
 */
export function isRendererSource(definition: ProjectionDefinition, path: string): boolean {
  const file = relative(path)
  if (!file) return false
  const pkg = rendererPackage(definition)
  if (pkg) {
    const inside = pkg === '.' ? file : file.startsWith(`${pkg}/`) ? file.slice(pkg.length + 1) : undefined
    if (inside !== undefined && /^(dist|node_modules)(\/|$)/.test(inside)) return false
  }
  return rendererSources(definition).some(source => file === source || file.startsWith(`${source}/`))
}

/** A renderer build's state: `untrusted` (the workspace isn't, so nothing runs), then building, built or failed. */
export type BuildPhase = 'untrusted' | 'building' | 'built' | 'failed'

export interface BuildState {
  phase: BuildPhase
  /** Why it failed: the build's first error line, or why it couldn't start. */
  error?: string
  /** The script it runs (`npm run watch`). */
  script?: string
  /** The renderer package, repository-relative. */
  package?: string
  /** The error names its file and position (esbuild's `file:line:column: ERROR:`). */
  located?: boolean
}

/** The Definition view's Renderer row: its description's suffix, its icon while it builds, and its tooltip's lines. */
export function buildRow(state: BuildState): {description: string; icon?: string; detail: string} {
  const script = state.script ? `\`npm run ${state.script}\`` : 'its build'
  const where = state.package ? ` in \`${state.package}\`` : ''
  switch (state.phase) {
    case 'untrusted':
      return {
        description: 'needs trust',
        detail: `Saving its sources would rebuild it (${script}${where}), which runs repository code: trust the workspace to allow it.`,
      }
    case 'building':
      return {description: 'building', icon: 'loading~spin', detail: `Building (${script}${where}, a task in the terminal).`}
    case 'built':
      return {description: 'built', detail: `Built (${script}${where}). Tabs reload the renderer when its bundle changes.`}
    case 'failed':
      return {
        description: 'build failed',
        icon: 'error',
        detail: [
          `The build failed (${script}${where}):`,
          '',
          `    ${state.error ?? 'see its task terminal'}`,
          '',
          'Problems lists its errors.',
        ].join('\n'),
      }
  }
}

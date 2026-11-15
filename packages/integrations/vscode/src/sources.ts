// What `serve --stdio` presents besides a repository: a saved document, or a renderer package's scenarios.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

/** A renderer bundle or package `--renderer` takes: `renderer.json` beside `index.html`, or `projections.renderer` in `package.json`. */
export function rendererPackage(directory: string): boolean {
  if (existsSync(join(directory, 'renderer.json')) && existsSync(join(directory, 'index.html'))) return true
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {projections?: {renderer?: unknown}}
    return typeof manifest.projections?.renderer === 'string'
  } catch {
    return false
  }
}

/** `serve --stdio`'s arguments for a source, besides `--trust`. */
export function sourceArguments(source: {kind: 'repository' | 'document' | 'fixtures'; path?: string; renderer?: boolean}): string[] {
  if (source.kind === 'document') return ['--document', source.path!]
  if (source.kind === 'fixtures') return ['--fixtures', source.path!, ...(source.renderer ? ['--renderer', source.path!] : [])]
  return []
}

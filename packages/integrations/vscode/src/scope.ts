/*
 * A scope's identity, as local execution computes `scopedTree` (`GET /api/identity`, M5): each scope path's Git object
 * in a tree (or `absent`), hashed in the scope's order. The extension computes it for a result from its
 * `provenance.execution.tree` and `scope`, to compare with the working tree's when the scope is verified.
 */
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const run = promisify(execFile)

/** `sha256:<hex>` of `path=object\0` for each scope path, in order; a path the tree lacks is `absent`. */
export function scopeDigest(entries: readonly (readonly [path: string, object: string | undefined])[]): string {
  const hash = createHash('sha256')
  for (const [path, object] of entries) hash.update(`${path}=${object ?? 'absent'}\0`)
  return `sha256:${hash.digest('hex')}`
}

/** A tree's scope identity, or nothing when git can't say. */
export async function scopedTreeOf(cwd: string, tree: string, scope: readonly string[]): Promise<string | undefined> {
  if (!/^[0-9a-f]{40,64}$/.test(tree)) return undefined
  try {
    const entries = await Promise.all(
      scope.map(async path => {
        const object = await run('git', ['rev-parse', '--verify', '--quiet', `${tree}:${path}`], {cwd}).then(
          ({stdout}) => stdout.trim() || undefined,
          () => undefined,
        )
        return [path, object] as const
      }),
    )
    return scopeDigest(entries)
  } catch {
    return undefined
  }
}

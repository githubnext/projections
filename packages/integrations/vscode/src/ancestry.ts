import {execFileOutput as run} from './exec.ts'

/** Whether `ancestor` is in `descendant`'s history (and not the same commit), in the repository at `cwd`. */
export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  if (ancestor === descendant) return false
  try {
    await run('git', ['merge-base', '--is-ancestor', '--end-of-options', ancestor, descendant], {cwd})
    return true
  } catch {
    return false
  }
}

/**
 * Which way two commits run by history: `backwards` when After is an ancestor of Before, `forward` when Before is
 * an ancestor of After, and `undefined` for commits on diverged branches (or the same commit).
 */
export async function historyOrder(cwd: string, before: string, after: string): Promise<'forward' | 'backwards' | undefined> {
  if (before === after) return undefined
  if (await isAncestor(cwd, after, before)) return 'backwards'
  if (await isAncestor(cwd, before, after)) return 'forward'
  return undefined
}

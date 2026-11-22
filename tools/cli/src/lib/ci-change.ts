// The change a CI plan (ci-plan.ts) is made for: the files changed since the merge base with a ref, as `tools affected`
// lists them (committed, staged, unstaged and untracked), and their contents before and after, which lockfiles compare.
// CI's `changes` job and `tools ci explain` both read the change through this.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Contents} from './ci-files.ts'
import {changedFiles} from './git.ts'
import {git} from './repo.ts'

export type ChangeSince = {base: string; commit: string; paths: string[]; contents: Contents}

/** A file's contents at `commit` (before) and in the working tree (after). */
export function contentsSince(root: string, commit: string): Contents {
  return {
    before: path => git(root, ['show', `${commit}:${path}`]),
    after: path => {
      try {
        return readFileSync(join(root, path), 'utf8')
      } catch {
        return undefined
      }
    },
  }
}

export function changeSince(root: string, base: string): ChangeSince {
  const commit = git(root, ['merge-base', 'HEAD', base])
  if (commit === undefined) throw new Error(`No merge base with ${base}; fetch it, or pass --base`)
  const paths = changedFiles(root, {ref: base, commit, reason: '--base'}).map(change => change.path)
  return {base, commit, paths, contents: contentsSince(root, commit)}
}

// What the commands share: usage errors, comma-separated option lists and the change set since a base.
import {affected, type Affected} from '../../lib/affected.ts'
import {changedFiles, resolveBase, type Base, type Change} from '../../lib/git.ts'
import {loadUnits, type Unit} from '../../lib/packages.ts'

/** A command that can't run as asked: exit code 2, with a hint. */
export class UsageError extends Error {
  hint: string | undefined
  constructor(message: string, hint?: string) {
    super(message)
    this.hint = hint
  }
}

export function split(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
}

export function changeSet(root: string, since?: string): {base: Base | undefined; changes: Change[]; units: Unit[]; affected: Affected} {
  const base = resolveBase(root, since)
  if (since && !base) throw new UsageError(`Unknown ref ${since}`, 'Pass a branch, tag or commit: --since origin/main')
  const units = loadUnits(root)
  const changes = changedFiles(root, base)
  return {base, changes, units, affected: affected(units, changes)}
}

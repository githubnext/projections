import type {ResultStamp, Staleness, WorkingIdentity} from '../staleness.ts'
import {readsEdits, workingTree} from './edits.ts'

/**
 * The identity rule: each working-tree side's tree and every side's definition digest against the working tree's now
 * (when the edits bear on it: `applies` is the revision whose definition the tab applies now).
 */
export function staleByIdentity(stamp: ResultStamp, identity: WorkingIdentity, applies?: string): Staleness | undefined {
  for (const side of stamp.sides) {
    if (
      readsEdits(stamp, applies) &&
      identity.definitionDigest &&
      side.definitionDigest &&
      side.definitionDigest !== identity.definitionDigest
    ) {
      return {tier: 'extraction', why: 'definition'}
    }
    if (side.ref !== workingTree) continue
    // A verified scope compares only the scope's objects, so an edit outside it leaves the result current; only when
    // the result was taken over the same scope and its own scope identity is known. Otherwise the whole tree.
    const scoped =
      identity.scopeVerified === true && identity.scopedTree && side.scopedTree && sameScope(side.execution?.scope, identity.scope)
    if (scoped ? side.scopedTree !== identity.scopedTree : !side.execution?.tree || side.execution.tree !== identity.tree) {
      return {tier: 'extraction', why: 'working tree'}
    }
  }
  return undefined
}

function sameScope(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((path, index) => path === b[index])
}

import {followContext, type ComparisonModel} from '@githubnext/projections-renderer-kit'

/** Relationships to what a policy or rule applies to, matches or excludes: drawn as chips inside it, not as rows. */
const subjects = new Set(['applies-to', 'matches', 'excludes'])

/**
 * What the Changes scope keeps beside the changes so each can be read, each laid out whole: a changed selector or
 * probe keeps the probe and policy that declare it and the hook it attaches to, where it is drawn. Chips name what
 * they point at, changed or not: every policy and rule shown keeps the subjects it applies to, matches or excludes, so
 * an unchanged scope reads as itself rather than as no workloads, and a workload keeps the policies covering it, so it
 * doesn't read as covered by no policy.
 */
export function runtimePolicyContext(all: ComparisonModel, changes: ReadonlySet<string>): Set<string> {
  return followContext(all, changes, {
    incoming: kind => kind === 'declares' || kind === 'filters' || kind === 'covers',
    outgoing: kind => kind === 'attaches' || subjects.has(kind),
  })
}

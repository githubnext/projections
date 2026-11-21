import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {StatusPart} from '@githubnext/projections-renderer-kit'

/** A package's version: `data.version` (`1.2.3`, `^18.3.0`), if it has one. */
export function versionOf(entity: Entity | undefined): string | undefined {
  const version = entity?.data?.version
  return typeof version === 'string' && version.length > 0 ? version : undefined
}

interface ParsedVersion {
  core: number[]
  pre: string[]
}

/** A plain or range-prefixed semantic version (`1.2.3`, `^18.3.0`, `v2`, `4.0.0.0-rc.1+build`); anything else isn't ordered. */
function parseVersion(text: string): ParsedVersion | undefined {
  const match = /^(?:[\^~=v]|[<>]=?)?\s*(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!match) return undefined
  return {core: match[1]!.split('.').map(Number), pre: match[2] ? match[2].split('.') : []}
}

function comparePre(left: string[], right: string[]): number {
  // A release outranks its prereleases.
  if (!left.length || !right.length) return right.length - left.length
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index],
      b = right[index]
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1
    const numeric = /^\d+$/.test(a),
      otherNumeric = /^\d+$/.test(b)
    if (numeric && otherNumeric) {
      if (Number(a) !== Number(b)) return Number(a) - Number(b)
      continue
    }
    if (numeric !== otherNumeric) return numeric ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/**
 * The direction of a version change, in semantic-version order. Versions that
 * can't be ordered (commit hashes, tags, compound ranges) or that differ only
 * in their range operator are `changed`.
 */
export function compareVersions(before: string, after: string): 'upgraded' | 'downgraded' | 'changed' {
  const left = parseVersion(before),
    right = parseVersion(after)
  if (!left || !right) return 'changed'
  let order = 0
  for (let index = 0; index < Math.max(left.core.length, right.core.length) && !order; index += 1) {
    order = (left.core[index] ?? 0) - (right.core[index] ?? 0)
  }
  if (!order) order = comparePre(left.pre, right.pre)
  return order < 0 ? 'upgraded' : order > 0 ? 'downgraded' : 'changed'
}

/**
 * A modified package's status as a version change: Upgraded or
 * Downgraded, with the matching icon, when both versions are ordered,
 * otherwise the generic status. Icon and word, so the change never depends on
 * color.
 */
export function versionStatus(change: EntityChange<Entity>, options: {bump?: boolean} = {}): StatusPart[] | undefined {
  if (change.status !== 'modified' || change.renamed) return undefined
  const before = versionOf(change.before),
    after = versionOf(change.after)
  if (!before || !after || before === after) return undefined
  const direction = compareVersions(before, after)
  if (direction === 'changed') return undefined
  // With `bump`, the part of the version that moved: `Major upgrade`, `Patch downgrade`.
  const bump = options.bump ? versionBump(before, after) : undefined
  const word = (verb: string, noun: string) => (bump ? `${bump[0]!.toUpperCase()}${bump.slice(1)} ${noun}` : verb)
  return [
    direction === 'upgraded'
      ? {status: 'modified', glyph: '↑', icon: 'upgraded', label: word('Upgraded', 'upgrade')}
      : {status: 'modified', glyph: '↓', icon: 'downgraded', label: word('Downgraded', 'downgrade')},
  ]
}

export type VersionBump = 'major' | 'minor' | 'patch' | 'prerelease'

/**
 * Which part of an ordered version moved: the first core number that differs
 * (`major`, `minor`, then `patch` for any later one), or `prerelease` when
 * only the prerelease differs. Undefined for versions that can't be ordered.
 */
export function versionBump(before: string, after: string): VersionBump | undefined {
  const left = parseVersion(before),
    right = parseVersion(after)
  if (!left || !right) return undefined
  for (let index = 0; index < Math.max(left.core.length, right.core.length); index += 1) {
    if ((left.core[index] ?? 0) !== (right.core[index] ?? 0)) return index === 0 ? 'major' : index === 1 ? 'minor' : 'patch'
  }
  return comparePre(left.pre, right.pre) ? 'prerelease' : undefined
}

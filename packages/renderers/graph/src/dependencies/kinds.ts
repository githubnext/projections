import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'

/** Row ID prefix of a summary card standing for the transitive packages a visible package pulls in. */
export const transitivePrefix = 'transitive:'
export const transitiveEdgePrefix = 'transitive-edge:'

/** Entity kinds that start a dependency graph besides workspace members: NuGet projects and their target frameworks. */
const rootKinds = new Set(['project', 'target-framework'])
/** NuGet's `resolved` relationships record target membership of every package, not a dependency. */
export const membershipKinds = new Set(['resolved'])

export const sideOf = <T>(row: EntityChange<T>): T => (row.after ?? row.before)!

export function isRootEntity(entity: Entity): boolean {
  return entity.data?.['workspaceMember'] === true || rootKinds.has(entity.kind)
}

/**
 * The kind a card names: `workspace` for workspace members (npm, pnpm, Yarn
 * and Cargo), `package` for installed packages; other kinds as extracted.
 */
export function displayKind(entity: Entity): string {
  if (entity.data?.['workspaceMember'] === true) return 'workspace'
  return entity.kind === 'external-package' ? 'package' : entity.kind
}

export const displayed = (row: EntityChange<Entity>): EntityChange<Entity> => {
  const show = (entity: Entity | undefined) =>
    entity && (displayKind(entity) === entity.kind ? entity : {...entity, kind: displayKind(entity)})
  const before = show(row.before),
    after = show(row.after)
  return {...row, ...(before ? {before} : {}), ...(after ? {after} : {})}
}

export function isTransitiveSummary(id: string): boolean {
  return id.startsWith(transitivePrefix)
}

/** The row whose transitive packages a summary card stands for. */
export function summaryOwner(id: string): string {
  return id.slice(transitivePrefix.length)
}

/** Whether a summary card collapses its expanded owner's packages rather than showing them. */
export function isCollapseCard(entity: Entity): boolean {
  return entity.data?.['expanded'] === true
}

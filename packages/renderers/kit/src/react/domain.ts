import {useMemo} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {domainIndex, type DomainIndex} from '../domain.js'
import {entityPresence} from '../emphasis.js'
import type {ComparisonModel} from '../model.js'

/**
 * Domain renderers group entities by their relationships rather than by
 * position; they all need rows keyed by identity and relationships resolved to
 * those rows. `presence` defaults to linear fades; staged renderers pass their
 * timeline's presence instead.
 */
export function useDomainIndex(
  model: ComparisonModel,
  progress: number,
  options: {
    include?: ReadonlySet<string> | undefined
    presence?: ((row: EntityChange<Entity>, progress: number) => number) | undefined
  } = {},
): DomainIndex {
  const base = useMemo(() => domainIndex(model), [model])
  const presence = options.presence ?? entityPresence
  const visible = base.changes.filter(row => (!options.include || options.include.has(row.id)) && presence(row, progress) > 0)
  return {...base, visible}
}

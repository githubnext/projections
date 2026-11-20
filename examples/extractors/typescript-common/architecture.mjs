// Collecting an `architecture/v0` extraction.
import {compareIds, id, MAX_EVIDENCE} from './basics.mjs'
import {evidence, owner} from './symbols.mjs'

/**
 * Collects an `architecture/v0` extraction. Entity IDs are `<name>:<kind>:<key...>`;
 * repeated occurrences add evidence up to MAX_EVIDENCE.
 */
export function architecture(project, name) {
  const entities = new Map()
  const relationships = new Map()
  const warnings = new Set()
  const put = (kind, key, label, at, data = {}, confidence = 'derived') => {
    const identity = id(name, kind, ...key)
    const previous = entities.get(identity)
    if (!previous) entities.set(identity, {id: identity, kind, label, data, confidence, evidence: evidence(project, at)})
    else if (previous.evidence.length < MAX_EVIDENCE) previous.evidence.push(...evidence(project, at))
    return identity
  }
  const edge = (kind, from, to, at) => {
    const identity = id(name, kind, from, to)
    if (!relationships.has(identity))
      relationships.set(identity, {id: identity, kind, from, to, confidence: 'derived', evidence: evidence(project, at)})
  }
  const packageNode = at => {
    const pkg = owner(project, at.getSourceFile().fileName)
    return put('package', [pkg.name], pkg.name, at)
  }
  const sort = items => items.sort((a, b) => compareIds(a.id, b.id))
  return {
    put,
    edge,
    packageNode,
    warnings,
    extraction: () => ({
      schema: 'architecture/v0',
      entities: sort([...entities.values()]),
      relationships: sort([...relationships.values()]),
      metadata: {
        analysis: 'Static TypeScript symbol resolution with explicit domain conventions',
        limitations: ['Dynamic registrations and runtime control flow are not evaluated.', ...[...warnings].sort()],
      },
    }),
  }
}

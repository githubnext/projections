import type {ReactNode} from 'react'
import {type Definition, customComparator} from '@githubnext/projections-schemas'
import type {PartOverrides} from '../parts/model.js'
import type {InspectorDefinitionList, InspectorPolicy} from '../types.js'

/**
 * What using a projection defined at a revision requires. A runner that
 * doesn't report policies is treated as requiring trust to extract.
 */
export function definitionPolicy(list: Pick<InspectorDefinitionList, 'policies'> | undefined, id: string): InspectorPolicy {
  return list?.policies?.find(policy => policy.id === id) ?? {id, requiresTrust: true, rendererRequiresTrust: false}
}

/** The repository file a definition's part comes from, when it names one: the extractor's script, the renderer bundle, the comparator file. */
export function partPath(definition: Definition | undefined, part: 'extractor' | 'renderer' | 'comparator'): string | undefined {
  if (!definition) return undefined
  if (part === 'extractor') {
    const extractor = definition.extractor
    if (typeof extractor === 'string') return undefined
    return extractor.sources?.[0] ?? extractor.command.slice(1).find(arg => /\.[a-z0-9]+$/iu.test(arg) && !arg.startsWith('-'))
  }
  if (part === 'renderer') return typeof definition.renderer === 'string' ? undefined : definition.renderer.bundle
  return customComparator(definition.comparator)?.file
}

/**
 * Why the pair was replayed, from the runner's change kinds (`GET /api/changes`) for one projection, with the
 * file it names in mono where the definition says which file that is. `undefined` when nothing of this projection changed.
 */
export function changeReason(
  change: {kinds: readonly string[]; complete: boolean},
  id: string,
  definition: Definition | undefined,
  scenarios: string | undefined,
): {node: ReactNode; plain: string} | undefined {
  if (!change.complete) return {node: 'after files changed', plain: 'after files changed'}
  const parts: {node: ReactNode; plain: string}[] = []
  const named = (path: string | undefined, fallback: string) =>
    path ? {node: <code className="pj:font-mono">{path}</code>, plain: path} : {node: fallback, plain: fallback}
  for (const kind of change.kinds) {
    if (kind === 'definitions') parts.push(named(undefined, 'the definition'))
    else if (kind === 'working-tree') parts.push(named(undefined, 'the working tree'))
    else if (kind === `extractor:${id}`) parts.push(named(partPath(definition, 'extractor'), 'the extractor'))
    else if (kind === `renderer:${id}`) parts.push(named(partPath(definition, 'renderer'), 'the renderer'))
    else if (kind === `comparator:${id}`) parts.push(named(partPath(definition, 'comparator'), 'the comparator'))
    else if (kind === `scenarios:${id}`) parts.push(named(scenarios, 'the scenarios'))
  }
  if (!parts.length) return undefined
  return {
    node: (
      <>
        after{' '}
        {parts.map((part, index) => (
          <span key={index}>
            {index ? ', ' : ''}
            {part.node}
          </span>
        ))}{' '}
        changed
      </>
    ),
    plain: `after ${parts.map(part => part.plain).join(', ')} changed`,
  }
}

/**
 * A repository's identity for remembering things per repository in this browser. The Inspector API names no
 * repository, so it is the set of projections the working tree defines.
 */
export function repositoryKey(list: Pick<InspectorDefinitionList, 'definitions'>): string {
  return list.definitions
    .map(definition => definition.id)
    .sort()
    .join(',')
}

/**
 * What running and presenting a projection needs, with the session's part overrides: whose extractor runs and whose
 * custom renderer is shown, their policies, whether that needs trust and whether it is granted, and the command.
 */
export function projectionTrust(definitions: InspectorDefinitionList | undefined, projection: string, override: PartOverrides | undefined) {
  const policy = definitionPolicy(definitions, projection)
  // The projection whose extractor runs, and whose custom renderer is shown: the definition's own, or an override's.
  const extractorFrom = override?.extractor?.startsWith('projection:') ? override.extractor.slice('projection:'.length) : projection
  const rendererFrom = override?.renderer?.startsWith('custom:') ? override.renderer.slice('custom:'.length) : projection
  const runPolicy = definitionPolicy(definitions, extractorFrom)
  const rendererPolicy = definitionPolicy(definitions, rendererFrom)
  const usesOwnRenderer = !override?.renderer || override.renderer.startsWith('custom:')
  // The server's --trust (reported as `executionAuthorized`) is the trust grant: the person who started the
  // Inspector chose to run this repository's code, so the page asks nothing more. Browser payloads can't grant it.
  const authorized = Boolean(definitions?.executionAuthorized)
  const trusted = authorized
  // Trust applies to the repository code the session runs, including an override's.
  const needsTrust = runPolicy.requiresTrust || (usesOwnRenderer && rendererPolicy.rendererRequiresTrust)
  const runDefinition = definitions?.definitions.find(item => item.id === extractorFrom)
  // What runs to extract a revision, as a person would type it.
  const runCommand =
    runDefinition && typeof runDefinition.extractor !== 'string'
      ? runDefinition.extractor.command.map(arg => (/\s/u.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
      : undefined
  return {policy, extractorFrom, runPolicy, rendererPolicy, usesOwnRenderer, authorized, trusted, needsTrust, runCommand}
}

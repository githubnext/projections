// Compare All: the folder's choice's pair compared for every projection that can run here, one job at a time, so every
// row and the badge say how much changed.
import type * as vscode from 'vscode'
import type {Lease} from '../backends.js'
import type {DefinitionList, ProjectionDefinition} from '../projections/definitions.js'
import type {Pair} from '../projections/pairs.js'
import type {Counted} from './changes.js'
import {countChanges} from './requests.js'

type Runner = Awaited<ReturnType<Lease['current']>>

/** The projections that can run here (built-in extractors, and repository code in a trusted workspace), or just `only`. */
export function runnable(
  definitions: DefinitionList | undefined,
  projections: ProjectionDefinition[],
  only?: string,
): ProjectionDefinition[] {
  return projections.filter(definition => {
    if (only && definition.id !== only) return false
    const policy = definitions?.policies.find(item => item.id === definition.id)
    return !policy?.requiresTrust || definitions?.executionAuthorized
  })
}

/** Counts `pair`'s changes for each projection in turn, until one is cancelled or `signal` aborts. */
export async function countAll({
  runner,
  pair,
  projections,
  signal,
  progress,
  at,
  counted,
}: {
  runner: Runner
  pair: Pair
  projections: ProjectionDefinition[]
  signal: AbortSignal
  progress: vscode.Progress<{message?: string; increment?: number}> | undefined
  /** The `changes` generation and `HEAD` a count starts at. */
  at: () => Pick<Counted, 'generation' | 'head'>
  counted: (id: string, count: Counted) => void
}) {
  for (const definition of projections) {
    if (signal.aborted) return
    const started = at()
    progress?.report({message: definition.title ?? definition.id, increment: 100 / Math.max(1, projections.length)})
    const outcome = await countChanges(runner, definition.id, pair, signal)
    if (!outcome) return
    counted(definition.id, {pair, ...started, ...outcome})
  }
}

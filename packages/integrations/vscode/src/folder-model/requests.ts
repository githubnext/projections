import type {Lease} from '../backends.js'
import {jobChangeCount} from '../projections/pairs.js'
import {parseDefinitions} from '../projections/definitions.js'
import type {DefinitionList} from '../projections/definitions.js'
import type {Pair} from '../projections/pairs.js'
import {noop} from '../noop.ts'

type Runner = Awaited<ReturnType<Lease['current']>>

/** A refusal's diagnostics as sentences, never its raw body. */
export function readable(status: number, body: unknown): string {
  const diagnostics = (body as {diagnostics?: {message?: unknown}[]} | null)?.diagnostics
  const messages = Array.isArray(diagnostics) ? diagnostics.flatMap(item => (typeof item?.message === 'string' ? [item.message] : [])) : []
  return messages.length ? messages.join('; ') : `The Projections backend refused the request (${status})`
}

/** The folder's backend's answers: its definitions (the working tree's and `HEAD`'s), candidates, pairs and generation. */
export async function fetchFolder(runner: Runner, known: number) {
  const [definitions, committed, explore, pairs, changes] = await Promise.all([
    runner.request({method: 'GET', path: '/api/definitions?ref=working-tree'}),
    // The committed definitions, which tabs apply (D4): their titles name the rows and tabs.
    runner.request({method: 'GET', path: '/api/definitions?ref=HEAD'}).catch(() => undefined),
    runner.request({method: 'GET', path: '/api/explore'}),
    runner.request({method: 'GET', path: '/api/pairs'}),
    // The current generation, which `since=0` answers at once.
    known ? undefined : runner.request({method: 'GET', path: '/api/changes?since=0'}).catch(() => undefined),
  ])
  const generation = (changes?.body as {generation?: unknown} | undefined)?.generation
  return {
    definitions,
    committed,
    explore,
    pairs,
    generation: typeof generation === 'number' && Number.isSafeInteger(generation) ? generation : undefined,
  }
}

/** `HEAD`'s definitions, when the repository has commits and they read. */
export function committedDefinitions(response: {status: number; body: unknown} | undefined): DefinitionList | undefined {
  try {
    return response?.status === 200 ? parseDefinitions(response.body) : undefined
  } catch {
    return undefined
  }
}

/**
 * Compares a pair for one projection, as one job: its change count, or why it failed; nothing when it was cancelled
 * (the job is cancelled too).
 */
export async function countChanges(
  runner: Runner,
  projection: string,
  pair: Pair,
  signal: AbortSignal,
): Promise<{count: number} | {failed: string} | undefined> {
  try {
    const created = await runner.request(
      {method: 'POST', path: '/api/jobs', body: {projectionId: projection, before: pair.before, after: pair.after}},
      signal,
    )
    if (created.status !== 202) throw new Error(readable(created.status, created.body))
    const id = (created.body as {id?: string}).id
    let job = created.body as {status?: string; diagnostics?: {message?: string}[]}
    while (job.status === 'running') {
      if (signal.aborted) {
        await runner.request({method: 'POST', path: `/api/jobs/${id}/cancel`, body: {}}).catch(noop)
        return undefined
      }
      await new Promise(resolve => {
        setTimeout(resolve, 300)
      })
      job = (await runner.request({method: 'GET', path: `/api/jobs/${id}`}, signal)).body as typeof job
    }
    const count = jobChangeCount(job)
    return count === undefined ? {failed: job.diagnostics?.map(item => item.message).join('; ') || 'The comparison failed'} : {count}
  } catch (error) {
    if (signal.aborted) return undefined
    return {failed: error instanceof Error ? error.message : String(error)}
  }
}

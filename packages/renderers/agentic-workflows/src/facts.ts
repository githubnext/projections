// A workflow card's facts, read from its entity's data: what its meta line shows.
import {codeSpan} from '@githubnext/projections-schemas'
import {dataOf} from './sections.js'
import type {WorkflowItem} from './model.js'

const lockWords: Record<string, string> = {
  current: 'Lock current',
  stale: 'Lock stale',
  missing: 'Lock missing',
  unverified: 'Lock unverified',
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
/** A JSON value as text: a string as it is, anything else as JSON. */
export const asText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

/** A workflow's engine and model (text with inline code), whether strict mode is off, and its lock file's state. */
export function facts(entity: WorkflowItem['entity'] | undefined) {
  const data = dataOf(entity)
  const engine = record(data.engine)
  const lock = record(data.lock).status
  return {
    engine: codeSpan(asText(engine.id ?? 'copilot')) + (engine.model !== undefined ? ` ${codeSpan(asText(engine.model))}` : ''),
    strict: data.strict !== false,
    lock: typeof lock === 'string' ? lock : undefined,
  }
}

export const lockText = (lock: string) => lockWords[lock] ?? `Lock ${lock}`

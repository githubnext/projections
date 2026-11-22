import type {ReactNode} from 'react'
import type {Definition} from '@githubnext/projections-schemas'
import type {InspectorApi} from '../client/api.js'
import type {InspectorDefinitionList, InspectorPolicy, InspectorScenario} from '../types.js'
import type {Artifact} from './artifacts.js'
import {changeReason} from './definitions.js'
import type {Marks} from './pairs.js'
import {refName} from './revisions.js'
import type {RowState} from './revisions.js'

/** The title bar's status line: what it says (`message`, as text in `plain`), and when and why it last happened. */
export interface Activity {
  kind: string
  message: ReactNode
  plain: string
  at?: number
  verb?: string
  reason?: {node: ReactNode; plain: string} | undefined
}

/** What the Inspector is showing and what just happened, for the title bar. */
export function inspectorActivity({
  api,
  artifact,
  loading,
  definitions,
  connected,
  showing,
  shownScenario,
  scenarios,
  active,
  projection,
  sides,
  failedSides,
  runnable,
  needsTrust,
  paired,
  marked,
  live,
  definitionRevision,
  projectionRows,
  replay,
  definition,
  policy,
}: {
  api: InspectorApi | undefined
  artifact: Artifact | null
  loading: boolean
  definitions: InspectorDefinitionList | null
  connected: boolean | undefined
  showing: 'live' | 'artifact'
  shownScenario: string | undefined
  scenarios: readonly InspectorScenario[]
  active: {projection: string; ref: string; id?: string} | undefined
  projection: string
  /** The shown pair's sides, and those that failed. */
  sides: readonly {side: string; ref: string}[]
  failedSides: readonly {side: string; ref: string}[]
  runnable: boolean
  needsTrust: boolean
  paired: boolean
  marked: Marks
  live: boolean
  definitionRevision: string
  projectionRows: Record<string, RowState>
  replay: {kinds: string[]; complete: boolean; at: number} | undefined
  definition: Definition | undefined
  policy: InspectorPolicy
}): Activity {
  const finishedAt = (ref: string | undefined) => {
    const row = ref ? projectionRows[ref] : undefined
    return row?.status === 'done' && row.started !== undefined ? row.started + (row.ms ?? 0) : undefined
  }
  const code = (value: string) => <code className="pj:font-mono">{value}</code>
  if (!api) {
    return artifact
      ? {kind: 'artifact', message: `Showing a saved artifact: ${artifact.name}`, plain: `Showing a saved artifact: ${artifact.name}`}
      : {kind: 'offline', message: 'Offline inspection · open a saved artifact', plain: 'Offline inspection · open a saved artifact'}
  }
  if (loading && !definitions) return {kind: 'reading', message: 'Reading repository…', plain: 'Reading repository…'}
  if (connected === false) return {kind: 'unavailable', message: 'Runner unavailable', plain: 'Runner unavailable'}
  if (showing === 'artifact' && artifact) {
    const scenario = shownScenario ? scenarios.find(item => item.id === shownScenario) : undefined
    const text = scenario ? `Showing renderer scenario ${scenario.title}` : `Showing a saved artifact: ${artifact.name}`
    return {kind: scenario ? 'scenario' : 'artifact', message: text, plain: text}
  }
  if (active && active.projection === projection) {
    const side = sides.find(item => item.ref === active.ref)
    const name = refName(active.ref)
    return {
      kind: 'extracting',
      message: (
        <>
          Extracting {code(name)}
          {side ? ` (${side.side.toLowerCase()})` : ''}…
        </>
      ),
      plain: `Extracting ${name}${side ? ` (${side.side.toLowerCase()})` : ''}…`,
    }
  }
  if (failedSides.length) {
    const names = failedSides.map(item => `${item.side} (${refName(item.ref)})`).join(' and ')
    const text = `${names} failed to extract · see Diagnostics`
    return {kind: 'failed', message: text, plain: text}
  }
  if (projection && !runnable && needsTrust) {
    const text = "Execution off · trust the workspace (the runner's --trust) to run this projection"
    return {kind: 'blocked', message: text, plain: text}
  }
  if (!paired || !marked.b) return {kind: 'reading', message: 'Choosing revisions…', plain: 'Choosing revisions…'}
  const message = marked.a ? (
    <>
      {code(refName(marked.a))} → {code(refName(marked.b))}
    </>
  ) : (
    code(refName(marked.b))
  )
  const base = marked.a ? `${refName(marked.a)} → ${refName(marked.b)}` : refName(marked.b)
  const definitionNote = live ? '' : ` · definition from ${definitionRevision}`
  const done = Math.max(...sides.map(item => finishedAt(item.ref) ?? 0)) || undefined
  const started = Math.max(...sides.map(item => projectionRows[item.ref]?.started ?? 0))
  const reason = replay && replay.at <= started + 50 ? changeReason(replay, projection, definition, policy.scenarios) : undefined
  const later = replay && replay.at > (done ?? 0) ? changeReason(replay, projection, definition, policy.scenarios) : undefined
  const why = reason ?? later
  const at = reason ? done : later ? replay!.at : done
  const verb = why ? 'replayed' : 'extracted'
  return {
    kind: 'pair',
    message: (
      <>
        {message}
        {definitionNote}
      </>
    ),
    plain: `${base}${definitionNote}${at !== undefined ? ` · ${verb} at ${new Date(at).toLocaleTimeString()}` : ''}${why ? ` ${why.plain}` : ''}`,
    ...(at !== undefined ? {at, verb} : {}),
    ...(why ? {reason: why} : {}),
  }
}

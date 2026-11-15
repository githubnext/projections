import type {ReactNode} from 'react'
import type {ComparisonPair} from '@githubnext/projections-host'
import type {ExtractionDocument} from '@githubnext/projections-schemas'
import {CircleAlert, CircleCheck, LoaderCircle} from 'lucide-react'
import type {InspectorRunning} from '../control.js'
import {missingInputNotice, missingInputNotices} from '../notices.js'
import type {ProjectionStatus, SwitcherItem} from '../shell/switcher.js'
import type {InspectorDefinitionList} from '../types.js'
import type {Artifact} from './artifacts.js'
import {definitionPolicy} from './definitions.js'
import {mentionsPath} from './page.js'
import type {Marks} from './pairs.js'
import type {Rows} from './use-extractions.js'

export interface RunStatus {
  kind: string
  text: string
  icon: ReactNode
}

/** A projection's marked pair's extraction: extracting, failed, or OK once both sides are done. */
export function projectionStatus(marks: {[projection: string]: Marks}, rows: Rows, id: string): RunStatus | undefined {
  const pairOf = marks[id] ?? {}
  const states = [pairOf.a, pairOf.b].filter((ref): ref is string => Boolean(ref)).map(ref => rows[id]?.[ref]?.status)
  if (states.some(state => state === 'running' || state === 'queued'))
    return {kind: 'extracting', text: 'Extracting', icon: <LoaderCircle className="pj:animate-spin pj:motion-reduce:animate-none" />}
  if (states.includes('failed')) return {kind: 'failed', text: 'Failed', icon: <CircleAlert className="pj:text-destructive" />}
  if (states.length && states.every(state => state === 'done'))
    return {kind: 'ok', text: 'OK', icon: <CircleCheck className="pj:text-added" />}
  return undefined
}

/** A projection's status for the switcher: extracting, failed or OK as above, or waiting for trust to run. */
export function switcherStatusOf(
  status: RunStatus | undefined,
  definitions: InspectorDefinitionList | null | undefined,
  id: string,
): ProjectionStatus | undefined {
  const kind = status?.kind
  if (kind === 'extracting') return 'running'
  if (kind === 'failed' || kind === 'ok') return kind
  return definitions && !definitions.executionAuthorized && definitionPolicy(definitions, id).requiresTrust ? 'trust' : undefined
}

/**
 * What the shown pair's job is doing, for the view's summary bar and the handle's summary: extracting while a side
 * extracts (the view still presents the pair before), then comparing while the page compares the two.
 */
export function pairRunning(extracting: boolean, pair: ComparisonPair): InspectorRunning | undefined {
  if (extracting) return 'extracting'
  return pair.outcome.status === 'computing' && pair.comparing ? 'comparing' : undefined
}

/** The shown pair's sides. */
export function pairSides(marked: Marks): {side: string; ref: string}[] {
  if (marked.a) return [{side: 'Before', ref: marked.a}, ...(marked.b ? [{side: 'After', ref: marked.b}] : [])]
  return marked.b ? [{side: 'The revision', ref: marked.b}] : []
}

/**
 * The view's notices: the artifact's or the last job's, and the declared inputs a shown revision lacks (what shows as
 * added or removed because of it), each said once even when a saved comparison already says so. An agent's page
 * (`viewer`) names no files.
 */
export function viewNotices({
  reported,
  shownBefore,
  shownAfter,
  viewer,
}: {
  reported: readonly string[]
  shownBefore: ExtractionDocument | undefined
  shownAfter: ExtractionDocument | undefined
  viewer: boolean
}): string[] {
  const lacking = (document: ExtractionDocument) => [missingInputNotice(document)].filter((notice): notice is string => Boolean(notice))
  const missing = shownBefore && shownAfter ? missingInputNotices(shownBefore, shownAfter) : shownAfter ? lacking(shownAfter) : []
  return [...new Set([...reported, ...missing])].filter(notice => !viewer || !mentionsPath(notice))
}

export type TrustState = 'offline' | 'unknown' | 'not-needed' | 'granted' | 'unauthorized'

/** Whether the shown projection runs, for the status bar: offline, unknown yet, not needing trust, granted or not. */
export function trustStateOf({
  connected,
  known,
  needsTrust,
  authorized,
}: {
  connected: boolean
  known: boolean
  needsTrust: boolean
  authorized: boolean
}): TrustState {
  if (!connected) return 'offline'
  if (!known) return 'unknown'
  if (!needsTrust) return 'not-needed'
  return authorized ? 'granted' : 'unauthorized'
}

/**
 * The switcher's projections: the repository's, with their status, or (without a runner) the artifact's, which its
 * documents name. `presented` is the one shown, and `failing` counts the others that failed.
 */
export function switcherModel({
  connected,
  definitions,
  artifact,
  projection,
  document,
  status,
}: {
  connected: boolean
  definitions: InspectorDefinitionList | null | undefined
  artifact: Artifact | null
  projection: string
  document: ExtractionDocument | undefined
  status: (id: string) => ProjectionStatus | undefined
}): {items: SwitcherItem[]; presented: string; failing: number} {
  const artifactProjections = artifact
    ? [...new Map(artifact.choices.map(choice => [choice.document.projection.id, choice.document.projection])).values()]
    : []
  const items: SwitcherItem[] = connected
    ? (definitions?.definitions ?? []).map(item => ({id: item.id, title: item.title ?? item.id, status: status(item.id)}))
    : artifactProjections.map(item => ({id: item.id, title: item.title}))
  const presented = connected ? projection : (document?.projection.id ?? artifactProjections[0]?.id ?? '')
  const failing = items.filter(item => item.id !== presented && item.status === 'failed').length
  return {items, presented, failing}
}

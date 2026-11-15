import {useCallback, useEffect, useRef, useState} from 'react'
import type {Dispatch, SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorJob, InspectorDefinitionList} from '../types.js'
import {errorText} from './errors.js'
import {jobOutcome, rememberExtracted, restoredRows} from './extraction-state.js'
import type {Marks} from './pairs.js'
import type {InspectorAppProps, InspectorOpenedOn} from './props.js'
import type {RowState} from './revisions.js'

/** Jobs whose raw output stays available. */
const maxJobs = 20

/**
 * An extraction waiting its turn. `runAs`: the projection whose extractor runs (a session override of the extractor);
 * its extraction is relabelled.
 */
export interface QueuedExtraction {
  projection: string
  ref: string
  definition: string
  runAs?: string | undefined
}
export type Rows = {[projection: string]: {[ref: string]: RowState}}

/**
 * Extractions per projection and revision: queued, run one at a time on the runner and polled to completion, with the
 * jobs' raw output and a cache of recent ones (`extracted`) to present again under another definition revision.
 */
export function useExtractions({
  api,
  projection,
  definitionRevision,
  extractorFrom,
  runnable,
  definitions,
  marks,
  setError,
  setPanelRequest,
  openedInitially,
  initialResults,
}: {
  api: InspectorApi | undefined
  projection: string
  definitionRevision: string
  extractorFrom: string
  runnable: boolean
  definitions: InspectorDefinitionList | null
  marks: {[projection: string]: Marks}
  setError: Dispatch<SetStateAction<string | null>>
  setPanelRequest: Dispatch<SetStateAction<{tab: string; at: number} | undefined>>
  openedInitially: InspectorOpenedOn | undefined
  initialResults: InspectorAppProps['initialResults']
}) {
  const [jobs, setJobs] = useState<InspectorJob[]>([])
  const [rows, setRows] = useState<Rows>(() => restoredRows(openedInitially, initialResults))
  const [queue, setQueue] = useState<QueuedExtraction[]>([])
  const [active, setActive] = useState<{projection: string; ref: string; id?: string} | undefined>()
  const definitionsRef = useRef(definitions)
  definitionsRef.current = definitions
  const marksRef = useRef(marks)
  marksRef.current = marks
  const updateRow = useCallback((id: string, ref: string, update: (current: RowState | undefined) => RowState) => {
    setRows(current => ({...current, [id]: {...current[id], [ref]: update(current[id]?.[ref])}}))
  }, [])
  // Each projection's recent extractions under each definition revision they applied, so a pair shown again with
  // another definition (a tab's Now applies the working tree's, its other choices the committed one) presents them
  // again instead of extracting again. They go when they would be extracted again: on a change to what they read, or
  // when someone asks.
  const extracted = useRef(new Map<string, RowState>())
  const forgetExtracted = useCallback((drop: (id: string, ref: string, definition: string) => boolean) => {
    for (const key of [...extracted.current.keys()]) {
      const [id, definition, ref] = JSON.parse(key) as [string, string, string]
      if (drop(id, ref, definition)) extracted.current.delete(key)
    }
  }, [])
  useEffect(() => rememberExtracted(extracted.current, rows), [rows])

  const finished = useCallback(
    (update: InspectorJob, target: {projection: string; ref: string; definition: string; runAs?: string | undefined}) => {
      const finish = (state: Partial<RowState>) =>
        updateRow(
          target.projection,
          target.ref,
          current =>
            ({
              ...current,
              status: 'failed',
              ms: Date.now() - (current?.started ?? Date.now()),
              definition: target.definition,
              ...state,
            }) as RowState,
        )
      const own = definitionsRef.current?.definitions.find(item => item.id === target.projection)
      const state = jobOutcome(update, target, own)
      finish(state)
      if (state.status !== 'failed') return
      // A failed side of the shown pair is reported in the main view, beside the other side; others here.
      const shown = marksRef.current[target.projection]
      if (target.ref !== shown?.a && target.ref !== shown?.b) {
        setError(`Extraction of ${target.ref} failed. Inspect diagnostics and raw output; no partial result is displayed.`)
        setPanelRequest({tab: 'diagnostics', at: Date.now()})
      }
    },
    [updateRow, setError, setPanelRequest],
  )

  // The extraction being started, until the runner names its job: a cancellation asked for meanwhile waits for the job.
  const starting = useRef<{cancel: boolean} | undefined>(undefined)
  // The running job, once named. A cancellation reads these refs, not `active`: Cancel can be pressed between one job
  // finishing and the next starting, and React starts the next one (below) after that click's handler has run.
  const running = useRef<string | undefined>(undefined)
  // How many cancellations there have been, and how many there had been when each extraction was queued: one queued
  // before the latest cancellation never starts, even from a queue read before that cancellation.
  const cancellations = useRef(0)
  const queuedAt = useRef(new WeakMap<QueuedExtraction, number>())
  // Runs queued extractions one at a time: the runner allows one active job.
  useEffect(() => {
    if (!api || active || !queue.length) return
    const next = queue[0]!
    // By updater, so a cancellation or extractions queued meanwhile aren't overwritten by this render's queue.
    setQueue(current => current.filter(item => item !== next))
    if (queuedAt.current.get(next) !== cancellations.current) return
    setActive({projection: next.projection, ref: next.ref})
    updateRow(next.projection, next.ref, current => ({...current, status: 'running', started: Date.now()}))
    const start = {cancel: false}
    starting.current = start
    void (async () => {
      try {
        let job = await api.run({projectionId: next.runAs ?? next.projection, before: next.ref, definitionRevision: next.definition})
        if (starting.current === start) starting.current = undefined
        running.current = job.id
        setActive({projection: next.projection, ref: next.ref, id: job.id})
        if (start.cancel) await api.cancel(job.id).catch((failure: unknown) => setError(`Cancellation failed: ${errorText(failure)}`))
        const started = job.id
        updateRow(next.projection, next.ref, current => ({...current, status: 'running', jobId: started}))
        setJobs(list => [...list.filter(item => item.id !== job.id), job].slice(-maxJobs))
        while (job.status === 'running') {
          await new Promise(resolve => setTimeout(resolve, 200))
          job = await api.job(job.id)
          const latest = job
          setJobs(list => list.map(item => (item.id === latest.id ? latest : item)))
        }
        finished(job, next)
      } catch (failure) {
        updateRow(next.projection, next.ref, current => ({...current, status: 'failed', error: errorText(failure)}))
        setError(errorText(failure))
        setPanelRequest({tab: 'diagnostics', at: Date.now()})
      } finally {
        if (starting.current === start) starting.current = undefined
        running.current = undefined
        setActive(undefined)
      }
    })()
  }, [api, active, queue, finished, updateRow, setError, setPanelRequest])

  const extract = useCallback(
    // `keep`: the extractions already made under other definitions stay (extracting under this one, not again).
    (refs: readonly string[], keep = false) => {
      if (!runnable) return
      setError(null)
      const fresh = [...new Set(refs.map(ref => ref.trim()).filter(Boolean))]
      if (!keep) forgetExtracted((id, ref) => id === projection && fresh.includes(ref))
      for (const ref of fresh) updateRow(projection, ref, current => ({...current, status: 'queued'}))
      setQueue(current => [
        ...current,
        ...fresh
          .filter(ref => !current.some(item => item.projection === projection && item.ref === ref))
          .map(ref => {
            const item = {projection, ref, definition: definitionRevision, runAs: extractorFrom}
            queuedAt.current.set(item, cancellations.current)
            return item
          }),
      ])
    },
    [runnable, projection, definitionRevision, updateRow, extractorFrom, forgetExtracted, setError],
  )

  const cancel = useCallback(async () => {
    cancellations.current++
    setQueue(current => {
      for (const item of current) updateRow(item.projection, item.ref, state => ({...state, status: 'cancelled'}))
      return []
    })
    if (!api) return
    if (starting.current) {
      starting.current.cancel = true
      return
    }
    const id = running.current
    if (!id) return
    try {
      await api.cancel(id)
    } catch (failure) {
      setError(`Cancellation failed: ${errorText(failure)}`)
    }
  }, [api, updateRow, setError])
  const busy = Boolean(active) || queue.length > 0
  return {jobs, rows, setRows, setQueue, active, extracted, forgetExtracted, extract, cancel, busy}
}

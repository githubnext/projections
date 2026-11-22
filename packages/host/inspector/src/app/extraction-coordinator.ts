import type {InspectorApi} from '../client/api.js'
import type {InspectorDefinitionList, InspectorJob} from '../types.js'
import {errorText} from './errors.js'
import {extractedKey, jobOutcome, rememberExtracted} from './extraction-state.js'
import type {RowState} from './revisions.js'

/** Jobs whose raw output stays available. */
const maxJobs = 20
/** How often a running job is polled. */
const pollInterval = 200

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
export type Rows = Record<string, Record<string, RowState>>
export interface ActiveExtraction {
  projection: string
  ref: string
  id?: string
}

/** What the coordinator publishes: each row's state, the jobs' raw output, the queue and the extraction running. */
export interface ExtractionSnapshot {
  rows: Rows
  jobs: InspectorJob[]
  queue: readonly QueuedExtraction[]
  active: ActiveExtraction | undefined
}

/** What the coordinator asks of the Inspector, read when needed. */
export interface ExtractionEvents {
  /** The projection's own definition: another projection's extractor (`runAs`) made its extraction. */
  definition(projection: string): InspectorDefinitionList['definitions'][number] | undefined
  /** Whether the ref is a side of the projection's shown pair, whose failure the main view reports. */
  shown(projection: string, ref: string): boolean
  /** A problem to report, and whether to open the diagnostics. */
  report(message: string, diagnostics: boolean): void
}

/** A client generation: everything it started stops, and publishes nothing, once it is replaced. */
interface Connection {
  api: InspectorApi
  abort: AbortController
}

/** The extraction running: the row it last wrote (`row`), its job once the runner names it, and whether it was cancelled. */
interface Run {
  item: QueuedExtraction
  connection: Connection
  row: RowState
  job?: string
  cancel: boolean
}

/** Resolves after `ms`, or as soon as `signal` aborts, leaving no timer behind. */
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, {once: true})
  })
}

/**
 * Extractions per projection and revision, without React: queued, run one at a time on the runner (it allows one
 * active job) and polled to completion, with the jobs' raw output and a cache of recent ones to present again under
 * another definition revision. Every transition happens here, so what one reads is always up to date.
 *
 * `connect` starts a client generation and `disconnect` ends it: its polling stops and anything it was still waiting
 * for is dropped. Ending a generation stops only this page's polling; it doesn't cancel the runner's job. Only
 * `cancel` (someone pressing Cancel, or a host's `InspectorHandle.cancel`) does: a viewer page can go away and be
 * opened again (an agent reloading it, a webview that was hidden) while its job is legitimately still running, the
 * runner queues and bounds its own jobs and stops them when it closes, and a replaced client may no longer reach the
 * runner to cancel anything. The extraction that generation was running goes back to the front of the queue, to be
 * extracted again by the next one.
 *
 * A finished job publishes only into the row it started from: once something else replaced that row (an extraction
 * asked for again, its row dropped as stale or for a new extractor), its outcome is obsolete and dropped.
 */
export class ExtractionCoordinator {
  #snapshot: ExtractionSnapshot
  readonly #listeners = new Set<() => void>()
  // Each projection's recent extractions under each definition revision they applied, so a pair shown again with
  // another definition (a tab's Now applies the working tree's, its other choices the committed one) presents them
  // again instead of extracting again. They go when they would be extracted again: on a change to what they read, or
  // when someone asks.
  readonly #extracted = new Map<string, RowState>()
  readonly #events: ExtractionEvents
  #connection: Connection | undefined
  #run: Run | undefined

  constructor(events: ExtractionEvents, rows: Rows = {}) {
    this.#events = events
    this.#snapshot = {rows, jobs: [], queue: [], active: undefined}
    rememberExtracted(this.#extracted, rows)
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  readonly getSnapshot = () => this.#snapshot

  /** Starts a client generation on `api` (ending the one before) and runs what is queued. */
  connect(api: InspectorApi | undefined) {
    this.disconnect()
    if (api) this.#connection = {api, abort: new AbortController()}
    this.#next()
  }

  /** Ends the client generation: its polling stops and its outcomes are dropped. The runner's job isn't cancelled. */
  disconnect() {
    const connection = this.#connection
    if (!connection) return
    this.#connection = undefined
    connection.abort.abort()
    const run = this.#run
    if (!run) return
    this.#run = undefined
    const {projection, ref} = run.item
    if (!this.#owns(run)) return this.#publish({active: undefined})
    // Cancelled meanwhile: it isn't extracted again.
    if (run.cancel) {
      return this.#publish({active: undefined, rows: withRow(this.#snapshot.rows, projection, ref, {...run.row, status: 'cancelled'})})
    }
    this.#publish({
      active: undefined,
      queue: [run.item, ...this.#snapshot.queue],
      rows: withRow(this.#snapshot.rows, projection, ref, {...run.row, status: 'queued'}),
    })
  }

  /**
   * Queues `refs` of `projection` under `definition`, those not queued already. Unless `keep`, the extractions made
   * before of those refs under other definitions are forgotten (they are extracted under this one, again).
   */
  extract(
    projection: string,
    refs: readonly string[],
    {definition, runAs, keep = false}: {definition: string; runAs?: string | undefined; keep?: boolean},
  ) {
    const fresh = [...new Set(refs.map(ref => ref.trim()).filter(Boolean))]
    if (!keep) this.forget((id, ref) => id === projection && fresh.includes(ref))
    let rows = this.#snapshot.rows
    for (const ref of fresh) rows = withRow(rows, projection, ref, {...rows[projection]?.[ref], status: 'queued'})
    const queue = this.#snapshot.queue
    const added = fresh
      .filter(ref => !queue.some(item => item.projection === projection && item.ref === ref))
      .map(ref => ({projection, ref, definition, runAs}))
    this.#publish({rows, queue: [...queue, ...added]})
    this.#next()
  }

  /** Drops the queued extractions `drop` picks; the running one finishes. */
  readonly dropQueued = (drop: (item: QueuedExtraction) => boolean) => {
    this.#publish({queue: this.#snapshot.queue.filter(item => !drop(item))})
  }

  /** Replaces the rows; a row replaced while its extraction runs no longer receives that extraction's outcome. */
  readonly setRows = (update: Rows | ((current: Rows) => Rows)) => {
    this.#publish({rows: typeof update === 'function' ? update(this.#snapshot.rows) : update})
  }

  /** A done extraction of `ref` under `definition`, to present again. */
  readonly extracted = (projection: string, definition: string, ref: string) =>
    this.#extracted.get(extractedKey(projection, definition, ref))

  /** Forgets the done extractions `drop` picks, so they are extracted again when next shown. */
  readonly forget = (drop: (id: string, ref: string, definition: string) => boolean) => {
    for (const key of [...this.#extracted.keys()]) {
      const [id, definition, ref] = JSON.parse(key) as [string, string, string]
      if (drop(id, ref, definition)) this.#extracted.delete(key)
    }
  }

  /**
   * Cancels everything queued and the extraction running: its job once the runner names it, or (when it is still
   * being started) as soon as it does.
   */
  readonly cancel = async () => {
    let rows = this.#snapshot.rows
    for (const item of this.#snapshot.queue) {
      rows = withRow(rows, item.projection, item.ref, {...rows[item.projection]?.[item.ref], status: 'cancelled'})
    }
    this.#publish({rows, queue: []})
    const run = this.#run
    if (!run) return
    run.cancel = true
    if (run.job) await this.#cancelJob(run, run.job)
  }

  async #cancelJob(run: Run, job: string) {
    try {
      await run.connection.api.cancel(job)
    } catch (failure) {
      if (this.#run === run) this.#events.report(`Cancellation failed: ${errorText(failure)}`, false)
    }
  }

  /** Starts the next queued extraction, when the generation has nothing running. */
  #next() {
    const connection = this.#connection
    const [item, ...queue] = this.#snapshot.queue
    if (!connection || this.#run || !item) return
    const row: RowState = {...this.#snapshot.rows[item.projection]?.[item.ref], status: 'running', started: Date.now()}
    const run: Run = {item, connection, row, cancel: false}
    this.#run = run
    this.#publish({
      queue,
      active: {projection: item.projection, ref: item.ref},
      rows: withRow(this.#snapshot.rows, item.projection, item.ref, row),
    })
    void this.#execute(run)
  }

  async #execute(run: Run) {
    const {item, connection} = run
    const {api, abort} = connection
    // Whether the run is still this generation's: a replaced generation's run publishes nothing more.
    const current = () => this.#run === run
    try {
      // Not aborted with the generation: a cancellation asked for while the job starts needs its ID, even once the
      // generation has ended.
      let job = await api.run({projectionId: item.runAs ?? item.projection, before: item.ref, definitionRevision: item.definition})
      if (!current()) {
        if (run.cancel) await api.cancel(job.id).catch(() => undefined)
        return
      }
      run.job = job.id
      const started = job
      this.#publish({
        active: {projection: item.projection, ref: item.ref, id: job.id},
        jobs: [...this.#snapshot.jobs.filter(entry => entry.id !== started.id), started].slice(-maxJobs),
      })
      this.#writeRow(run, row => ({...row, status: 'running', jobId: started.id}))
      // Cancelled while it was being started: its job is cancelled now that the runner named it.
      if (run.cancel) await this.#cancelJob(run, job.id)
      while (job.status === 'running') {
        await sleep(pollInterval, abort.signal)
        if (!current()) return
        job = await api.job(job.id, abort.signal)
        if (!current()) return
        const latest = job
        this.#publish({jobs: this.#snapshot.jobs.map(entry => (entry.id === latest.id ? latest : entry))})
      }
      this.#finish(run, job)
    } catch (failure) {
      if (!current() || !this.#owns(run)) return
      this.#writeRow(run, row => ({...row, status: 'failed', error: errorText(failure)}))
      this.#events.report(errorText(failure), true)
    } finally {
      if (current()) {
        this.#run = undefined
        this.#publish({active: undefined})
        this.#next()
      }
    }
  }

  #finish(run: Run, job: InspectorJob) {
    const {item} = run
    if (!this.#owns(run)) return
    const state = jobOutcome(job, item, this.#events.definition(item.projection))
    this.#writeRow(
      run,
      row => ({...row, status: 'failed', ms: Date.now() - (row.started ?? Date.now()), definition: item.definition, ...state}) as RowState,
    )
    if (state.status !== 'failed' || this.#events.shown(item.projection, item.ref)) return
    // A failed side of the shown pair is reported in the main view, beside the other side; others here.
    this.#events.report(`Extraction of ${item.ref} failed. Inspect diagnostics and raw output; no partial result is displayed.`, true)
  }

  /** Whether the run's row is still the one it wrote, not replaced since. */
  #owns(run: Run) {
    return this.#snapshot.rows[run.item.projection]?.[run.item.ref] === run.row
  }

  /** Updates the run's row, unless something else replaced it. */
  #writeRow(run: Run, update: (row: RowState) => RowState) {
    if (!this.#owns(run)) return
    run.row = update(run.row)
    this.#publish({rows: withRow(this.#snapshot.rows, run.item.projection, run.item.ref, run.row)})
  }

  #publish(change: Partial<ExtractionSnapshot>) {
    this.#snapshot = {...this.#snapshot, ...change}
    if (change.rows) rememberExtracted(this.#extracted, change.rows)
    for (const listener of this.#listeners) listener()
  }
}

function withRow(rows: Rows, projection: string, ref: string, row: RowState): Rows {
  return {...rows, [projection]: {...rows[projection], [ref]: row}}
}

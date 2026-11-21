import * as vscode from 'vscode'
import type {Lease} from './backends.js'
import {changeRecord, markStaleCounts} from './folder-model/changes.js'
import type {Counted} from './folder-model/changes.js'
import {countAll, runnable} from './folder-model/compare-all.js'
import {WorkingIdentities} from './folder-model/identity.js'
import {committedDefinitions, fetchFolder, readable} from './folder-model/requests.js'
import {rowStatus} from './folder-model/status.js'
import {byTitle, parseCandidates, parseDefinitions} from './projections/definitions.js'
import {parsePairs} from './projections/pair-list.js'
import {samePair} from './projections/pairs.js'
import {choiceDetail, choiceIcon, choiceName, choiceText} from './choices/names.js'
import {isChoice, sameChoice} from './choices/model.js'
import {effectiveChoice, identifyPair} from './choices/resolve.js'
import type {Choice, RepositoryFacts} from './choices/model.js'
import {definitionEdits, describePair, workingFacts} from './refs.js'
import type {EditState} from './edits.js'
import {PairSummaries} from './updates.js'
import type {ChangeRecord, Staleness, WorkingIdentity} from './staleness.js'
import type {PairLabels} from './refs.js'
import type {Candidate, DefinitionList, InvalidDefinition, ProjectionDefinition} from './projections/definitions.js'
import type {Pair, PairList} from './projections/pairs.js'
import type {TabSummary} from './projections/rows.js'
import {noop} from './noop.ts'

const refreshDelayMs = 300

const pairKey = (pair: Pair) => `${pair.before ?? ''}..${pair.after}`

/** One workspace folder's projections, read from its shared backend and refreshed on its `changes` notifications. */
export class FolderModel implements vscode.Disposable {
  definitions: DefinitionList | undefined
  candidates: Candidate[] = []
  pairs: PairList | undefined
  /** The choice the person picked for this repository (kept per folder in the workspace's state); none until they pick. */
  remembered: Choice | undefined
  /** What the repository's tabs look at: the remembered choice, resolved again as refs move, else the automatic one. */
  choice: Choice = {id: 'now'}
  /** Whether `choice` is the automatic one (nothing picked, or the pick doesn't apply here now). */
  automatic = true
  /** The choice's Before → After pair, which every unpinned projection tab follows. */
  pair: Pair | undefined
  /** Uncommitted files and commits ahead of the merge base, from git, for the choices' labels. */
  private working: {changes?: number; ahead?: number} = {}
  /**
   * Change counts Compare All found, by projection, for the pair they were counted on, with the generation and `HEAD`
   * they were counted at and whether a change since made them out of date.
   */
  readonly counted = new Map<string, Counted>()
  /** The backend's `changes` notifications (the latest 500), for telling which results are out of date. */
  records: ChangeRecord[] = []
  /** The latest `changes` generation. */
  generation = 0
  private readonly recorded = new vscode.EventEmitter<void>()
  /** A `changes` notification arrived (before the definitions and pairs are read again). */
  readonly onDidRecordChanges = this.recorded.event
  /** Projections whose shown result is out of date, as their unpinned tabs found them. */
  readonly stale = new Map<string, Staleness & {files?: number | undefined}>()
  /** `HEAD`'s definitions (D4: what tabs apply), when the repository has commits. */
  committed: DefinitionList | undefined
  /** Each projection's uncommitted edits (its definition, or a file it declares), or `new` when uncommitted. */
  edits = new Map<string, EditState>()
  /** An edited projection's `editKey`, which changes whenever its edits do (ending a tab's Show committed). */
  editKeys = new Map<string, string>()
  /** Why the pair last changed: the person picked, or the choice resolved again as refs moved. */
  pairCause: 'pick' | 'refs' = 'pick'
  private readonly identities: WorkingIdentities
  private counting: AbortController | undefined
  error: string | undefined
  /**
   * What open tabs reported, by projection ID and pair: a pair shown again has its counts at once, and a pair a tab was
   * just switched to says it is extracting until the tab reports it.
   */
  readonly summaries = new PairSummaries()
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribe: (() => void) | undefined
  private loading: Promise<void> | undefined
  private readonly stopListening: () => void
  private readonly described = new Map<string, PairLabels | Promise<void>>()

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    private readonly lease: Lease,
    private readonly output: vscode.LogOutputChannel,
    private readonly memento: vscode.Memento,
  ) {
    this.identities = new WorkingIdentities(lease)
    // The old Pairs view's recent pairs aren't kept any more.
    if (memento.get(this.stateKey) !== undefined) void memento.update(this.stateKey, undefined)
    const choice = memento.get<unknown>(this.choiceKey)
    this.remembered = isChoice(choice) ? choice : undefined
    const subscribe = (runner: {onNotification(listener: (method: string, params: unknown) => void): () => void}) => {
      this.unsubscribe?.()
      this.unsubscribe = runner.onNotification((method, params) => {
        if (method !== 'changes') return
        this.record(params)
        this.schedule()
      })
    }
    // A replaced backend (trust granted, or it exited) is subscribed to and read again; its generations start over.
    this.stopListening = lease.onDidChange(runner => {
      this.records = []
      this.generation = 0
      this.identities.reset()
      subscribe(runner)
      this.schedule()
    })
    void lease.current().then(subscribe, noop)
  }

  /** Reads the definitions and candidates once, or again after a change. */
  load(): Promise<void> {
    this.loading ??= this.refresh()
    return this.loading
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void (this.loading = this.refresh()), refreshDelayMs)
  }

  async refresh(): Promise<void> {
    try {
      const runner = await this.lease.current()
      const {definitions, committed, explore, pairs, generation} = await fetchFolder(runner, this.generation)
      if (generation !== undefined && !this.records.length) this.generation = Math.max(this.generation, generation)
      if (definitions.status !== 200) throw new Error(readable(definitions.status, definitions.body))
      this.definitions = parseDefinitions(definitions.body)
      this.committed = committedDefinitions(committed)
      this.candidates = explore.status === 200 ? parseCandidates(explore.body) : []
      this.pairs = pairs.status === 200 ? parsePairs(pairs.body) : undefined
      const [working, edits] = await Promise.all([
        workingFacts(this.folder.uri.fsPath, this.pairs?.refs?.mergeBase),
        definitionEdits(this.folder.uri.fsPath, this.projections),
      ])
      this.working = working
      this.edits = edits.states
      this.editKeys = edits.keys
      this.described.clear()
      // Refs move (a commit, a new merge base): the choice resolves again.
      this.resolve('refs')
      this.error = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.output.warn(`Projections in ${this.folder.name}: ${this.error}`)
    }
    this.changed.fire()
  }

  /** A pair's sides named for people (a branch, tag or the working tree, with the subject and age), once git answers. */
  labels(pair: Pair | undefined = this.pair): PairLabels | undefined {
    if (!pair) return undefined
    const key = pairKey(pair)
    const cached = this.described.get(key)
    if (cached && !(cached instanceof Promise)) return cached
    if (!cached) {
      this.described.set(
        key,
        describePair(this.folder.uri.fsPath, pair, this.pairs?.refs ?? {}).then(
          labels => {
            this.described.set(key, labels)
            this.changed.fire()
          },
          () => void this.described.delete(key),
        ),
      )
    }
    return undefined
  }

  /** What the repository says, for resolving and naming choices. */
  facts(): RepositoryFacts {
    const pairs = this.pairs
    const refs = pairs?.refs
    return {
      ...(pairs?.head?.commit ? {head: pairs.head.commit} : {}),
      ...(pairs?.head?.branch ? {branch: pairs.head.branch} : {}),
      ...(pairs?.defaultBranch ? {defaultBranch: pairs.defaultBranch} : {}),
      ...(refs?.mergeBase ? {mergeBase: refs.mergeBase} : {}),
      dirty: pairs?.head?.dirty ?? Boolean(this.working.changes),
      ...this.working,
      suggestions: pairs?.suggestions ?? [],
      bookmarks: pairs?.bookmarks ?? [],
    }
  }

  /** Resolves the remembered (or automatic) choice again; tabs that follow the repository move with its pair. */
  private resolve(cause: 'pick' | 'refs') {
    const effective = effectiveChoice(this.remembered, this.facts())
    if (!samePair(effective.pair, this.pair)) {
      this.counting?.abort()
      // Tabs follow a pick at once; a pair that moved with the refs makes their results out of date instead.
      if (this.pair) this.pairCause = cause
    }
    this.choice = effective.choice
    this.automatic = effective.automatic
    this.pair = effective.pair
  }

  /** A choice named as the header line, a tab's control and the status bar show it: `My branch · 3 commits + uncommitted`. */
  describe(choice: Choice = this.choice, pair: Pair | undefined = choice === this.choice ? this.pair : undefined) {
    const facts = this.facts()
    const labels = pair ? this.labels(pair) : undefined
    return {
      name: choiceName(choice, facts),
      detail: choiceDetail(choice, facts, labels, pair),
      text: choiceText(choice, facts, labels, pair),
      icon: choiceIcon(choice),
      backwards: Boolean(labels?.backwards),
    }
  }

  /** The repository's own projections, as the backend lists them (by ID). */
  private get defined(): ProjectionDefinition[] {
    return this.definitions && !this.definitions.setup ? this.definitions.definitions : []
  }

  /**
   * The repository's own projections, by the title each row and tab shows (`title`, so a row with uncommitted edits
   * sorts by the committed title it shows), then ID: none while it defines none (the built-in defaults then stand in).
   */
  get projections(): ProjectionDefinition[] {
    return byTitle(
      this.defined,
      definition => this.title(definition.id),
      definition => definition.id,
    )
  }

  /** Definition files that don't load, by the label their rows show (the ID, else the path). */
  get invalid(): InvalidDefinition[] {
    return byTitle(
      this.definitions?.invalid ?? [],
      item => item.id ?? item.path,
      item => item.path,
    )
  }

  /** Whether the repository defines projections, valid or not. */
  get defines(): boolean {
    return this.projections.length > 0 || this.invalid.length > 0
  }

  invalidFor(id: string): InvalidDefinition | undefined {
    return this.invalid.find(item => item.id === id)
  }

  definition(id: string): ProjectionDefinition | undefined {
    return this.defined.find(item => item.id === id)
  }

  /**
   * A projection's title as tabs show it: the committed definition's, which tabs apply (D4), unless the definition was
   * never committed; then the working tree's.
   */
  title(id: string): string {
    const committed = this.edits.get(id) === 'new' ? undefined : this.committed?.definitions.find(item => item.id === id)
    return committed?.title ?? this.definition(id)?.title ?? id
  }

  private get stateKey() {
    return `projections.pair:${this.folder.uri.toString()}`
  }

  private get choiceKey() {
    return `projections.choice:${this.folder.uri.toString()}`
  }

  /**
   * The person picked a choice: it's remembered for the repository, new tabs open on it, open tabs that aren't pinned
   * follow it, and counts are for its pair from now on.
   */
  choose(choice: Choice) {
    const same = sameChoice(choice, this.remembered) && !this.automatic
    this.remembered = choice
    void this.memento.update(this.choiceKey, choice)
    this.resolve('pick')
    if (!same) this.changed.fire()
  }

  /** Sets the repository's choice to the one a pair is (from Swap or an agent tool), else two revisions. */
  setPair(pair: Pair) {
    this.choose(identifyPair(pair, this.facts()))
  }

  /** The choice a pair is here. */
  identify(pair: Pair): Choice {
    return identifyPair(pair, this.facts())
  }

  /**
   * What a row says for the folder's choice's pair: "Out of date" when its tab's result (or its count) is, else a tab's
   * report or Compare All's count on that pair, else its policy.
   */
  status(id: string): string {
    return rowStatus({
      pair: this.pair,
      summary: this.summaries.get(id, this.pair),
      counted: this.counted.get(id),
      policy: this.definitions?.policies.find(item => item.id === id),
      executionAuthorized: this.definitions?.executionAuthorized ?? false,
      invalid: Boolean(this.invalidFor(id)),
      stale: this.stale.has(id),
    })
  }

  /** How many projections' rows are out of date, for the status bar. */
  outOfDateCount(): number {
    return this.projections.filter(definition => this.status(definition.id) === 'Out of date').length
  }

  /** `HEAD`'s commit, as `GET /api/pairs` last said. */
  get head(): string | undefined {
    return this.pairs?.head?.commit
  }

  /** Keeps a `changes` notification, and marks Compare All's counts it makes out of date. */
  private record(params: unknown) {
    const record = changeRecord(params)
    if (!record) return
    this.records = [...this.records, record].slice(-500)
    this.generation = Math.max(this.generation, record.generation)
    // Kept counts for pairs not shown may no longer hold; the shown pair's tab says whether its result is out of date.
    this.summaries.keepOnly(this.pair)
    markStaleCounts(this.counted, this.records, this.head)
    this.recorded.fire()
    this.changed.fire()
  }

  /**
   * The working tree's identity for a projection (`GET /api/identity?projection=`, local execution M2), else the
   * latest `tree` a `changes` notification carried; nothing until the backend reports either (the changes rule).
   */
  identity(projection: string): Promise<WorkingIdentity | undefined> {
    return this.identities.of(projection, this.records)
  }

  /** An unpinned tab's finding that its result is out of date, or current again (`undefined`). */
  reportStale(id: string, staleness: (Staleness & {files?: number | undefined}) | undefined) {
    const before = this.stale.get(id)
    if (staleness) this.stale.set(id, staleness)
    else this.stale.delete(id)
    if (JSON.stringify(before) !== JSON.stringify(staleness)) this.changed.fire()
  }

  /** The projections that changed in the folder's choice's pair, as far as tabs and Compare All have counted. */
  changedCount(): number {
    return this.projections.filter(definition => /^\d+ changes?$/.test(this.status(definition.id))).length
  }

  /**
   * Compare All: compares the folder's choice's pair for every projection that can run here (built-in extractors, and
   * repository code in a trusted workspace), one job at a time, so every row and the badge say how much changed.
   */
  async compareAll(progress?: vscode.Progress<{message?: string; increment?: number}>, token?: vscode.CancellationToken, only?: string) {
    const pair = this.pair
    if (!pair?.before) throw new Error(`${this.describe().name} shows one revision: there's nothing to compare`)
    // Counting one projection (its row's Refresh) doesn't stop a Compare All.
    if (!only) this.counting?.abort()
    const counting = new AbortController()
    if (!only) this.counting = counting
    token?.onCancellationRequested(() => counting.abort())
    await countAll({
      runner: await this.lease.current(),
      pair,
      projections: runnable(this.definitions, this.projections, only),
      signal: counting.signal,
      progress,
      at: () => ({generation: this.generation, head: this.head}),
      counted: (id, count) => {
        this.counted.set(id, count)
        this.changed.fire()
      },
    })
  }

  /** A tab's report of its projection's pair and changes. */
  report(id: string, summary: TabSummary) {
    this.summaries.set(id, summary)
    this.changed.fire()
  }

  /** A tab following the choice was switched to its pair: its row says it is comparing until the tab reports it. */
  switching(id: string, pair: Pair) {
    if (this.summaries.switching(id, pair)) this.changed.fire()
  }

  dispose() {
    clearTimeout(this.timer)
    this.counting?.abort()
    this.unsubscribe?.()
    this.stopListening()
    this.lease.dispose()
    this.changed.dispose()
    this.recorded.dispose()
  }
}

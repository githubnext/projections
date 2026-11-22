// Whether a projection tab's shown result is out of date. Each new result is stamped when it arrives (its jobs, the
// `changes` generation and `HEAD` its extraction started at, and its trees), then judged against the changes since:
// by the working tree's identity when the backend reports one, else by the changes recorded. Nothing extracts again on
// its own; the tab says so, and Refresh extracts it again.
import {presentationFiles} from '../../edits.js'
import type {FolderModel} from '../../folder-model.js'
import type {TabSummary} from '../../projections/rows.js'
import {changedFiles, checkoutLocation, workingTreeTree} from '../../refs.js'
import {scopedTreeOf} from '../../scope.js'
import {observation, relevantFiles, staleness, type ResultStamp, type Staleness} from '../../staleness.js'
import {stampTree} from '../../staleness/notices.js'

/** Whether the shown result is out of date, and how many working-tree files changed since it. */
export type TabStale = Staleness & {files?: number | undefined}

interface Start {
  generation: number
  head?: string | undefined
}
type Results = NonNullable<TabSummary['results']>

/** What the tab tells its freshness, and is told by it. */
export interface FreshnessHost {
  readonly folder: {readonly uri: {readonly fsPath: string}}
  readonly projection: string
  model(): FolderModel
  /** The revision whose definition the tab applies to the pair it shows now. */
  applies(): 'working-tree' | 'HEAD'
  /** Whether the choice moved with the refs: a pair the tab shows once refreshed. */
  pending(): boolean
  /** Whether the result is out of date changed. */
  staleChanged(stale: TabStale | undefined): void
  /** An observation's age grew. */
  aged(): void
}

/** The refs of a summary's complete, successful result: both sides extracted. */
function resultRefs(summary: TabSummary): {refs: string[]; results: Results} | undefined {
  const {results, pair} = summary
  if (!results || summary.status !== 'ok' || !pair?.after) return undefined
  const refs = [pair.before, pair.after].filter((ref): ref is string => Boolean(ref))
  return refs.every(ref => results[ref]) ? {refs, results} : undefined
}

/**
 * Whether only files that don't make the result out of date changed (with `HEAD` where it was): a result applying the
 * committed definition in a tab that keeps showing it (Show committed) when only definition files changed; and any
 * result when only presentation files changed, though they change the definition's digest (the renderer reloads, and
 * the comparator compares again).
 */
function unaffected(
  found: Staleness,
  stamp: ResultStamp,
  head: string | undefined,
  changed: string[] | undefined,
  files: unknown[] | undefined,
) {
  if (files?.length !== 0 || stamp.head !== head) return false
  const committed = found.why === 'working tree' && stamp.definition && stamp.definition !== 'working-tree'
  return Boolean(committed) || ((found.why === 'working tree' || found.why === 'definition') && Boolean(changed?.length))
}

/** A projection tab's shown result: its stamp, and whether it is out of date. */
export class Freshness {
  /** The result shown, as it was stamped when it arrived: its jobs, generation and identity. */
  stamp: ResultStamp | undefined
  /** Whether the shown result is out of date, and how many working-tree files changed since it. */
  stale: TabStale | undefined
  /** Refresh was asked for: out of date isn't shown again until its result arrives. */
  refreshing = false
  /** The latest `changes` generation whose evaluation finished, for tests waiting on it. */
  checked = 0
  private evaluated = ''
  private ageTimer: ReturnType<typeof setInterval> | undefined
  /** The generation and `HEAD` when the next result's first job started. */
  private jobStart: Start | undefined
  /**
   * The generation and `HEAD` each extraction job started at, by job: a result presented again (switching back to a
   * pair) is out of date by the changes since its jobs ran, not since it was presented again.
   */
  private readonly jobStarts = new Map<string, Start>()

  constructor(private readonly host: FreshnessHost) {}

  /** The page started a new extraction job: the next result counts from now, unless an earlier job of it started. */
  jobStarted() {
    const model = this.host.model()
    this.jobStart ??= {generation: model.generation, head: model.head}
  }

  /** Refresh was asked for: nothing is out of date until its result arrives. */
  refresh() {
    this.refreshing = true
    this.set(undefined)
  }

  /** Forgets the shown result, as a window reload would. */
  forget() {
    this.stamp = undefined
  }

  dispose() {
    clearInterval(this.ageTimer)
  }

  /** A new result (its jobs differ from the shown one's): stamped, current, and checked against changes since it started. */
  async stampResult(summary: TabSummary) {
    if (summary.status === 'failed') this.refreshing = false
    const result = resultRefs(summary)
    if (!result) return
    const {refs, results} = result
    const jobs = refs.map(ref => `${ref}:${results[ref]!.job ?? ''}`).join()
    if (this.stamp && this.stamp.sides.map(side => `${side.ref}:${side.job ?? ''}`).join() === jobs) return
    const start = this.started(refs.map(ref => results[ref]!.job))
    const pair = summary.pair!
    const stamp: ResultStamp = {
      projection: this.host.projection,
      pair: {...(pair.before ? {before: pair.before} : {}), after: pair.after!},
      ...(summary.definitionRevision ? {definition: summary.definitionRevision} : {}),
      generation: start.generation,
      ...(start.head ? {head: start.head} : {}),
      sides: refs.map(ref => ({ref, ...results[ref]})),
    }
    this.stamp = stamp
    this.refreshing = false
    // An observation's age is shown as it grows.
    clearInterval(this.ageTimer)
    if (observation(stamp)) this.ageTimer = setInterval(() => this.host.aged(), 60_000)
    this.evaluated = ''
    this.set(undefined)
    await this.identify(stamp)
    await this.evaluate()
  }

  /**
   * When a new result's extraction started: sides extracted earlier (presented again) count from when their jobs ran,
   * new ones from when this result started; the earliest of them.
   */
  private started(jobs: (string | undefined)[]): Start {
    const model = this.host.model()
    const fresh = this.jobStart ?? {generation: model.generation, head: model.head}
    this.jobStart = undefined
    const starts = jobs.map(job => {
      const known = job ? this.jobStarts.get(job) : undefined
      if (job && !known) this.jobStarts.set(job, fresh)
      return known ?? fresh
    })
    for (const job of [...this.jobStarts.keys()].slice(0, Math.max(0, this.jobStarts.size - 64))) this.jobStarts.delete(job)
    return starts.reduce((earliest, item) => (item.generation < earliest.generation ? item : earliest))
  }

  /** The trees a result's changes count from: a scoped side's own scope identity, and the result's tree. */
  private async identify(stamp: ResultStamp) {
    const cwd = this.host.folder.uri.fsPath
    // A scoped result's own scope identity, to compare with the working tree's once the scope is verified (M5).
    await Promise.all(
      stamp.sides.map(async side => {
        const {tree, scope} = side.execution ?? {}
        if (side.ref !== 'working-tree' || !tree || !Array.isArray(scope)) return
        const scoped = await scopedTreeOf(cwd, tree, scope)
        if (scoped) side.scopedTree = scoped
      }),
    )
    // "N files changed" counts from the result's own tree (local execution's `provenance.execution.tree`), else this.
    if (!stampTree(stamp)) {
      const tree = await workingTreeTree(cwd)
      if (tree) stamp.tree = tree
    }
  }

  /** Whether the shown result is out of date: the identity when the backend reports one, else the changes since it. */
  async evaluate() {
    const generation = this.host.model().generation
    const evaluated = await this.evaluateNow()
    if (evaluated) this.checked = Math.max(this.checked, generation)
  }

  /** Whether `stamp` is no longer the result to judge: another arrived, or Refresh was asked for. */
  private superseded(stamp: ResultStamp) {
    return stamp !== this.stamp || this.refreshing
  }

  /** Decides, and says, whether the shown result is out of date; false when it didn't (nothing shown, or done already). */
  private async evaluateNow(): Promise<boolean> {
    const stamp = this.stamp
    if (!stamp || this.refreshing) return false
    const model = this.host.model()
    const applies = this.host.applies()
    const pending = this.host.pending()
    const key = `${model.generation}:${model.head ?? ''}:${pending}:${applies}`
    if (key === this.evaluated) return false
    this.evaluated = key
    const policy = model.definitions?.policies.find(item => item.id === this.host.projection)
    const identity = await model.identity(this.host.projection)
    const found: Staleness | undefined =
      staleness(stamp, {
        records: model.records,
        ...(model.head ? {head: model.head} : {}),
        ...(identity ? {identity} : {}),
        toolchain: Boolean(policy?.requiresTrust),
        // A comparator edit compares again on its own (edit tiers: a renderer edit reloads, a comparator edit compares).
        recompares: true,
        // The definition it applies now: while the projection has edits, a definition change makes the result out of
        // date unless the tab shows the committed version.
        definition: applies,
      }) ?? (this.host.pending() ? {tier: 'extraction', why: 'refs moved'} : undefined)
    if (this.superseded(stamp)) return false
    if (!found) {
      this.set(undefined)
      return true
    }
    const cwd = this.host.folder.uri.fsPath
    const from = stampTree(stamp)
    const to = identity?.tree ?? (await workingTreeTree(cwd))
    const changed = from && to ? await changedFiles(cwd, from, to) : undefined
    // Its renderer's and comparator's files present the result: editing them reloads the view or compares again.
    const definition = model.definition(this.host.projection)
    // Its paths are relative to the project (this folder); git's are repository-relative.
    const prefix = definition && changed ? ((await checkoutLocation(cwd))?.prefix ?? '') : ''
    const files = changed ? relevantFiles(stamp, changed, applies, definition ? presentationFiles(definition, prefix) : []) : undefined
    if (this.superseded(stamp)) return false
    this.set(unaffected(found, stamp, model.head, changed, files) ? undefined : {...found, files: files?.length})
    return true
  }

  /** Says whether the shown result is out of date, when that changed. */
  set(stale: TabStale | undefined) {
    if (JSON.stringify(stale) === JSON.stringify(this.stale)) return
    this.stale = stale
    this.host.staleChanged(stale)
  }
}

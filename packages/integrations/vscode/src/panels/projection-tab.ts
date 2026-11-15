import * as vscode from 'vscode'
import type {Running} from '@githubnext/projections-host-vscode/running'
import {extractionMessages, keptSides} from '../configuration-model.js'
import type {TabFacts} from '../current-view/types.js'
import type {DefinitionTarget} from '../definition.js'
import type {FolderModel} from '../folder-model.js'
import {count} from '../probe.js'
import {definitionFile} from '../projection-sources.js'
import {failureFor} from '../projections/rows.js'
import {swapped} from '../projections/pairs.js'
import type {Pair} from '../projections/pairs.js'
import type {TabSummary} from '../projections/rows.js'
import {hostTag, restoreTag} from '../protocol.js'
import type {HostMessage, ProjectionFailure, TabPair, TabPairLabels, TabRestore, WebviewConfig} from '../protocol.js'
import type {Services} from '../services.js'
import {setProjectionIcon} from '../sidebar/items.js'
import type {Sidebar} from '../sidebar.js'
import {Switches} from '../updates.js'
import {InspectorWebview} from './inspector-webview.js'
import {pairFields, pinnedChoice, setTabContext, tabPair} from './projection-tab/context.js'
import {tabFacts} from './projection-tab/facts.js'
import {Following} from './projection-tab/following.js'
import type {Pin} from './projection-tab/following.js'
import {Freshness} from './projection-tab/freshness.js'
import type {TabStale} from './projection-tab/freshness.js'
import {jobHold, startsJob} from './projection-tab/jobs.js'
import {KeptResults} from './projection-tab/kept.js'
import {refreshAction, tabPairLabels} from './projection-tab/labels.js'
import {DefinitionRevision} from './projection-tab/revision.js'

/** A tab's shown extractions' diagnostics, as native diagnostics on its definition file (Problems and squiggles). */
function reportExtraction(sidebar: Sidebar, folder: vscode.WorkspaceFolder, projection: string, sides: ReturnType<typeof keptSides>) {
  const messages = extractionMessages(sides)
  void definitionFile(folder, projection).then(uri => sidebar.reportExtraction(folder, projection, uri, messages))
}

/**
 * A projection tab: a `projection:` resource in the projection editor, presenting one projection of a folder alone (no
 * Inspector shell) on the folder's shared backend. It reports its status and change count to the side bar, and shows
 * an invalid definition's diagnostics instead of the projection. Nothing extracts again on its own: a tab says when
 * its result is out of date (`staleness.ts`), and Refresh extracts it again. A hidden tab's webview is dropped (no
 * `retainContextWhenHidden`); the extension keeps its results and the reloaded page presents them again. VS Code
 * restores tabs with the window.
 */
export class ProjectionTab extends InspectorWebview {
  static readonly tabs = new Set<ProjectionTab>()
  /** The projection tab in front, if any. */
  static current: ProjectionTab | undefined
  /** The projection tab that was in front last, still open: what the agent's current view falls back to. */
  static lastActive: ProjectionTab | undefined
  private failure: string | undefined
  /** Whether it follows the folder's choice or is pinned to its own, and the pair it shows. */
  private readonly following: Following
  last: TabSummary | undefined
  /** The shown result's stamp, and whether it is out of date. */
  private readonly freshness: Freshness
  /** Extraction jobs this tab's page started (for tests: refreshing is the only way it starts more). */
  jobs = 0
  /** The extractions shown last, for the page to present again when VS Code drops the hidden tab's webview. */
  private readonly kept = new KeptResults()
  /** How many times the page loaded (for tests: a hidden tab's page is dropped and comes back). */
  loads = 0
  /** The tab's switches of pair, numbered: a summary about an earlier one is stale. */
  private readonly switches = new Switches()
  /** The pair message last posted to the page, which isn't posted again unchanged. */
  private posted = ''
  /** Which definition the tab applies: your edits, or the committed version by Show committed. */
  private readonly revision: DefinitionRevision

  /**
   * What its job is doing, as its page last reported: nothing while the tab is hidden, since VS Code drops a hidden
   * tab's page (no `retainContextWhenHidden`) and nothing reports for it then.
   */
  get running(): Running | undefined {
    return this.panel.visible ? this.last?.running : undefined
  }

  /** The choice this tab is pinned to and its pair, or none: it follows the folder's. */
  get pinned(): Pin | undefined {
    return this.following.pinned
  }

  /** Whether the shown result is out of date, and how many working-tree files changed since it. */
  get stale(): TabStale | undefined {
    return this.freshness.stale
  }

  /** The latest `changes` generation whose evaluation finished, for tests waiting on it. */
  get checked(): number {
    return this.freshness.checked
  }

  private get sidebar(): Sidebar {
    return this.services.sidebar
  }

  /** The folder's model: its choice, pair, definitions, edits and changes. */
  get model(): FolderModel {
    return this.sidebar.model(this.folder)
  }

  constructor(
    services: Services,
    readonly folder: vscode.WorkspaceFolder,
    readonly projection: string,
    panel: vscode.WebviewPanel,
    firstPage?: {html: string; at: number},
  ) {
    super(services, {kind: 'repository', folder}, panel, 'inspect', firstPage)
    this.following = new Following(() => this.model, projection)
    this.freshness = new Freshness({
      folder,
      projection,
      model: () => this.model,
      applies: () => this.revisionFor(this.shownPair()),
      pending: () => this.following.pending,
      staleChanged: stale => this.staleChanged(stale),
      aged: () => this.postPair(),
    })
    this.revision = new DefinitionRevision(() => this.model, projection)
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(services.context.extensionUri, 'dist')],
      enableCommandUris: false,
    }
    ProjectionTab.tabs.add(this)
    panel.iconPath = setProjectionIcon(services.context.extensionUri)
    const model = this.model
    this.failure = this.currentFailure()
    this.following.followed = model.pair
    this.disposables.push(
      model.onDidChange(() => this.modelChanged()),
      model.onDidRecordChanges(() => void this.freshness.evaluate()),
      panel.onDidChangeViewState(() => {
        this.activate()
        // A tab whose page reported a job, hidden or shown again: the status bar item's count of other tabs' jobs.
        if (this.last?.running) this.sidebar.updateStatus()
      }),
    )
    this.activate()
    // Its custom renderer builds when its sources are newer than its bundle (saved while no tab was open).
    void model.load().then(() => this.services.rendererBuilds?.opened(folder, projection))
  }

  /** The pair the tab shows: its pinned pair, else the folder's it follows. */
  shownPair(): Pair | undefined {
    return this.following.shown()
  }

  /** The folder's model changed: a definition, the edits, the choice or the refs. */
  private modelChanged() {
    // A definition that becomes valid (or invalid) reloads the tab.
    const failure = this.currentFailure()
    if (failure !== this.failure) {
      this.failure = failure
      this.show('inspect')
      return
    }
    this.revision.editsChanged()
    const follow = this.following.modelChanged(Boolean(this.freshness.stamp))
    if (follow) this.follow(follow)
    this.postPair()
    void this.freshness.evaluate()
  }

  protected override receive(message: unknown) {
    // For tests: a new extraction job reaches the backend late (`holdJobs`), to see what a long job shows.
    const hold = jobHold(message)
    if (hold > 0) return void setTimeout(() => super.receive(message), hold)
    const host = message as Partial<HostMessage> & {pair?: unknown; results?: unknown}
    const op = host?.tag === hostTag ? host.op : undefined
    if (op === 'restore') return this.restore()
    if (op === 'results') return this.keep(host.pair, host.results)
    super.receive(message)
  }

  /** The page asked what to show: the tab's pair, and the results it showed last when they are for that pair. */
  private restore() {
    this.loads++
    count('page.restore')
    // VS Code reloaded the page (it dropped it while the tab was hidden): commands wait for it to be ready again. A
    // load the extension started already has a pending ready, which callers may be waiting on.
    if (this.isReady) {
      this.isReady = false
      this.ready = new Promise(resolve => (this.markReady = resolve))
    }
    const pair = this.shownPair()
    const definitionRevision = this.revisionFor(pair)
    const editsKey = this.model.editKeys.get(this.projection)
    // A refresh the dropped page didn't finish carries on: the page extracts again rather than showing what it had.
    const kept = this.freshness.refreshing ? undefined : this.kept.restorable(pair, definitionRevision)
    const reply: TabRestore = {
      tag: restoreTag,
      definitionRevision,
      ...(editsKey ? {editsKey} : {}),
      ...(pair ? {pair: pairFields(pair)} : {}),
      ...(kept ? {results: kept} : {}),
    }
    void this.panel.webview.postMessage(reply)
  }

  /** Keeps the page's new results; the oldest tab beyond the limit drops its own (it extracts again when shown). */
  private keep(pair: unknown, results: unknown) {
    const kept = this.kept.keep(pair, results)
    if (!kept) return
    reportExtraction(this.sidebar, this.folder, this.projection, keptSides(kept))
    this.services.tabsChanged.fire()
  }

  /** What the Definition view follows for this tab: its projection and the extractions shown. */
  definitionTarget(): DefinitionTarget {
    const kept = this.kept.for(this.shownPair())
    return {folder: this.folder, projection: this.projection, kind: 'tab', documents: kept ? keptSides(kept) : []}
  }

  /** Shows the folder's pair. */
  private follow(pair: Pair) {
    count('tab.setPair')
    this.following.follow(pair)
    // Its row says it is comparing until the page reports this pair (at once when it was reported before).
    this.model.switching(this.projection, pair)
    void this.control({
      op: 'setPair',
      ...pairFields(pair),
      definitionRevision: this.revisionFor(pair),
      generation: this.switches.next(),
    }).catch(() => {})
  }

  /** The revision whose definition this tab applies to a pair: the working tree's while it has edits, unless Show committed. */
  revisionFor(pair: Pair | undefined): 'working-tree' | 'HEAD' {
    return this.revision.for(pair)
  }

  /**
   * Show committed (the "Your edits" indicator's action), or back to the edits (`null`, Use my edits): applies that
   * definition to both sides and extracts again, as asked.
   */
  async showCommitted(show: boolean) {
    const shown = this.revision.show(show)
    if (!shown) return
    this.freshness.refresh()
    await this.control({op: 'showCommitted', ...shown})
    this.postPair()
  }

  /** For tests: reloads the page as a window reload would, forgetting what the extension knew of the tab. */
  reloadAsNew() {
    this.revision.forget()
    this.kept.forget()
    this.freshness.forget()
    this.show('inspect')
  }

  /** The bridge relayed a request from the page: a new extraction job is stamped with the generation it started at. */
  protected override request(method: 'GET' | 'POST', path: string) {
    if (!startsJob(method, path)) return
    this.jobs++
    count('tab.job')
    this.freshness.jobStarted()
  }

  /** Whether the shown results apply the definition's uncommitted edits or, by Show committed, the committed version. */
  editsFor(pair: Pair | undefined): TabPairLabels['edits'] {
    return this.revision.edits(pair, this.last?.definitionRevision)
  }

  /** Whether the shown result is out of date changed: the side bar, the toolbar and the status bar say so. */
  private staleChanged(stale: TabStale | undefined) {
    this.following.reportStale(stale)
    this.postPair()
    if (this.panel.active) this.activate()
  }

  /** Refresh: extracts the shown pair again (or shows the pair the choice moved to). Nothing else refreshes a tab. */
  async refresh() {
    this.freshness.refresh()
    this.following.refreshing()
    const pin = this.following.takePendingPin()
    if (pin) return this.pinTo(pin)
    const pair = this.following.pendingFollow()
    if (pair) return this.follow(pair)
    // The definition the tab should apply changed (a commit, or the edits were undone): Refresh applies it.
    const desired = this.revisionFor(this.shownPair())
    if (this.last?.definitionRevision && this.last.definitionRevision !== desired)
      return void (await this.control({op: 'setDefinitionRevision', ref: desired}))
    await this.control({op: 'refresh'})
  }

  /** Tells the tab's toolbar its choice and pair, named for people (the pinned choice, else the folder's). */
  private postPair() {
    const pair = this.shownPair()
    const message = tabPairLabels({
      model: this.model,
      pinned: this.pinned,
      pair,
      edits: this.editsFor(pair),
      stamp: this.freshness.stamp,
      stale: this.stale,
      refreshes: () => refreshAction(this.last?.definitionRevision, this.revisionFor(pair), this.stale),
    })
    const text = JSON.stringify(message)
    if (text === this.posted) return
    this.posted = text
    count('tab.pair')
    void this.panel.webview.postMessage(message)
    this.services.tabsChanged.fire()
  }

  protected override pairAction(action: unknown) {
    const run = async () => {
      switch (action) {
        case 'refresh':
          return this.refresh()
        // The edits indicator: Show committed, and back to the edits.
        case 'showCommitted':
          return this.showCommitted(true)
        case 'useEdits':
          return this.showCommitted(false)
      }
    }
    void run().catch(error => void vscode.window.showErrorMessage(`Projections: ${error instanceof Error ? error.message : error}`))
  }

  get title(): string {
    return this.model.title(this.projection)
  }

  private currentFailure(): string | undefined {
    const invalid = this.model.invalidFor(this.projection)
    return invalid ? JSON.stringify(failureFor(invalid)) : undefined
  }

  protected override pageConfig(): Partial<WebviewConfig> {
    const model = this.model
    const pair = model.pair
    this.following.followed = pair
    const editsKey = model.editKeys.get(this.projection)
    return {
      projection: this.projection,
      title: this.title,
      chrome: 'none',
      toolbar: true,
      ...(pair ? pairFields(pair) : {}),
      definitionRevision: this.revisionFor(this.pinned?.pair ?? pair),
      ...(editsKey ? {editsKey} : {}),
      ...(this.failure ? {failure: JSON.parse(this.failure) as ProjectionFailure} : {}),
    }
  }

  protected override onReady(message: Partial<HostMessage>) {
    const pinned = (message as {pinned?: TabPair | null}).pinned
    this.following.pinned = pinned?.after ? pinnedChoice(this.model, pinned) : undefined
    // A tab restored with the window remembers Show committed while the edits are the same (its page applied it as it
    // loaded).
    this.revision.restore((message as {committed?: string | null}).committed)
    this.activate()
    // A page that (re)loaded knows nothing of the pair yet.
    this.posted = ''
    this.postPair()
  }

  protected override summary(summary: unknown) {
    if (typeof summary !== 'object' || summary === null) return
    // Sent before the page applied the latest switch: about a pair no longer shown.
    if (!this.switches.current((summary as TabSummary).generation)) return
    const applied = this.last?.definitionRevision
    const running = this.last?.running
    this.last = summary as TabSummary
    void this.freshness.stampResult(this.last)
    if (this.last.definitionRevision !== applied) this.postPair()
    this.following.report(this.last)
    if (this.panel.active) this.activate()
    // Another tab's job started or ended: the status bar item's tooltip counts them.
    else if (this.last.running !== running) this.sidebar.updateStatus()
  }

  /** The tab in front sets the status bar and the context keys its title actions read. */
  private activate() {
    if (!this.panel.active) {
      if (this.sidebar.active?.projection === this.projection && ProjectionTab.current === this) this.deactivate()
      return
    }
    ProjectionTab.current = this
    ProjectionTab.lastActive = this
    this.sidebar.active = {
      folder: this.folder,
      projection: this.projection,
      title: this.title,
      pinned: this.pinned,
      stale: this.stale ? {files: this.stale.files} : undefined,
      running: this.running,
      reducedMotion: this.last?.reducedMotion,
    }
    void setTabContext(this)
    this.sidebar.updateStatus()
  }

  /** No projection tab is in front any more: the status bar and title actions say so. */
  private deactivate() {
    ProjectionTab.current = undefined
    this.sidebar.active = undefined
    void setTabContext(undefined)
    this.sidebar.updateStatus()
  }

  /** Pins the tab to a choice and its pair, which it then shows whatever the folder's choice. */
  async pinTo(pinned: Pin) {
    await this.control({op: 'pin', pair: tabPair(pinned, this.revisionFor(pinned.pair)), generation: this.switches.next()})
    this.following.pinned = pinned
    this.activate()
    this.postPair()
  }

  /** Swaps Before and After: the tab's own pair when pinned, otherwise the folder's (every following tab swaps). */
  async swap() {
    if (this.pinned) {
      const pair = swapped(this.pinned.pair)
      await this.pinTo({...this.model.identify(pair), pair})
    } else {
      const model = this.model
      if (model.pair) model.setPair(swapped(model.pair))
    }
  }

  /** What the agent's current view says of this tab (`currentViewText`), and its tools default to (`tabDefaults`). */
  viewFacts(inFront: boolean, {page: ask = true}: {page?: boolean} = {}): Promise<TabFacts> {
    return tabFacts(this, inFront, ask, () => [...ProjectionTab.tabs].filter(tab => tab !== this).map(tab => tab.title))
  }

  /** The open tab of a projection, for tests driving it. */
  static find(projection: string): ProjectionTab | undefined {
    return [...ProjectionTab.tabs].reverse().find(tab => tab.projection === projection)
  }

  protected override dispose() {
    this.freshness.dispose()
    ProjectionTab.tabs.delete(this)
    this.kept.dispose()
    this.following.closed()
    this.services.tabsChanged.fire()
    if (ProjectionTab.lastActive === this) ProjectionTab.lastActive = undefined
    if (ProjectionTab.current === this) this.deactivate()
    super.dispose()
  }
}

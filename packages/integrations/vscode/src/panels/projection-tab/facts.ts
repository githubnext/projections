// What the agent's current view says of a projection tab (`currentViewText`), and its tools default to (`tabDefaults`):
// its projection and definition, its choice and pair, and what its page presents (or reported last, when VS Code
// dropped the hidden tab's page).
import * as vscode from 'vscode'
import type {Choice} from '../../choices/model.js'
import type {PageView, TabFacts, ViewSide} from '../../current-view/types.js'
import type {FolderModel} from '../../folder-model.js'
import {sideText} from '../../labels.js'
import type {SideLabel} from '../../labels.js'
import {definitionFile} from '../../projection-sources.js'
import type {Pair} from '../../projections/pairs.js'
import type {TabSummary} from '../../projections/rows.js'
import type {ControlRequest, TabPairLabels} from '../../protocol.js'
import {describePair} from '../../refs.js'
import type {TabStale} from './freshness.js'

/** The tab, as its facts read it. */
export interface FactsTab {
  readonly folder: vscode.WorkspaceFolder
  readonly projection: string
  readonly title: string
  readonly pinned: (Choice & {pair: Pair}) | undefined
  readonly last: TabSummary | undefined
  readonly stale: TabStale | undefined
  readonly model: FolderModel
  /** The pair the tab shows: its pinned pair, else the folder's it follows. */
  shownPair: () => Pair | undefined
  /** Whether the shown results apply the definition's edits or, by Show committed, the committed version. */
  editsFor: (pair: Pair | undefined) => TabPairLabels['edits']
  control: (message: ControlRequest, timeoutMs?: number) => Promise<unknown>
}

/** What the page presents now, unless VS Code dropped it (a hidden tab) or it doesn't answer in time. */
async function askPage(tab: FactsTab): Promise<PageView | undefined> {
  return (await Promise.race([
    tab.control({op: 'currentView'}, 5_000).catch(() => undefined),
    new Promise<undefined>(resolve => setTimeout(resolve, 5_000)),
  ])) as PageView | undefined
}

/** What the page reported last, standing in for a page VS Code dropped. */
function reportedPage(last: TabSummary): PageView {
  return {
    ...(last.status ? {status: last.status} : {}),
    ...(last.comparison ? {compared: last.comparison.compared, rows: last.comparison.rows, changes: last.comparison.changes} : {}),
    ...(last.view?.mode && last.view.modes?.length !== undefined && last.view.modes.length > 0
      ? {mode: last.view.mode, modes: last.view.modes}
      : {}),
  }
}

/** The pair's sides: their refs, commits and descriptions. */
async function viewSides(tab: FactsTab, pair: Pair | undefined): Promise<{before?: ViewSide; after?: ViewSide}> {
  const model = tab.model
  const labels =
    pair && (model.labels(pair) ?? (await describePair(tab.folder.uri.fsPath, pair, model.pairs?.refs ?? {}).catch(() => undefined)))
  const side = (ref: string | undefined, label: SideLabel | undefined): ViewSide | undefined =>
    ref ? {ref, ...(label?.commit ? {commit: label.commit} : {}), ...(label ? {text: sideText(label)} : {})} : undefined
  const before = side(pair?.before, labels?.before)
  const after = side(pair?.after, labels?.after)
  return {...(before ? {before} : {}), ...(after ? {after} : {})}
}

/** The projection's definition: its description, file and parts. */
function definitionFacts(tab: FactsTab, file: vscode.Uri | undefined): Partial<TabFacts> {
  const definition = tab.model.definition(tab.projection)
  return {
    ...(definition?.description ? {description: definition.description} : {}),
    ...(file ? {definitionFile: vscode.workspace.asRelativePath(file, false)} : {}),
    ...(definition
      ? {
          parts: {
            extractor: definition.extractor,
            renderer: definition.renderer,
            ...(definition.comparator !== undefined && definition.comparator !== '' ? {comparator: definition.comparator} : {}),
          },
        }
      : {}),
  }
}

/** What the agent's current view says of `tab`; `ask` the page what it presents, else what it reported last. */
export async function tabFacts(tab: FactsTab, inFront: boolean, ask: boolean, others: () => string[]): Promise<TabFacts> {
  const model = tab.model
  const pair = tab.shownPair()
  const choice = tab.pinned ?? model.choice
  const shown = tab.pinned ? model.describe(tab.pinned, tab.pinned.pair) : model.describe()
  // The page answers unless VS Code dropped it (a hidden tab); then what it reported last stands in.
  const page = ask ? await askPage(tab) : undefined
  const sides = await viewSides(tab, pair)
  const file = await definitionFile(tab.folder, tab.projection).catch(() => undefined)
  const last = tab.last
  const shownPage = page ?? (last ? reportedPage(last) : undefined)
  const edits = tab.editsFor(pair)
  const titles = others()
  const stale = tab.stale
  return {
    inFront,
    folder: tab.folder.name,
    projection: tab.projection,
    title: tab.title,
    ...definitionFacts(tab, file),
    choice: {id: choice.id, name: shown.name, ...(shown.detail ? {detail: shown.detail} : {})},
    pinned: Boolean(tab.pinned),
    ...sides,
    ...(last?.definitionRevision ? {definitionRevision: last.definitionRevision} : {}),
    ...(edits ? {edits} : {}),
    ...(stale
      ? {stale: {why: stale.why, tier: stale.tier, ...(stale.files !== undefined && stale.files !== 0 ? {files: stale.files} : {})}}
      : {}),
    ...(shownPage ? {page: shownPage} : {}),
    ...(titles.length ? {others: titles} : {}),
  }
}

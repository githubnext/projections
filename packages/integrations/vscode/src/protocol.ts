/** Messages between the extension and its Inspector webview, beside the transport's (`projections.inspector`). */

/** Host capabilities and replies the webview asks the extension for. */
export const hostTag = 'projections.host'
/** Commands the extension sends the webview's Inspector handle. */
export const controlTag = 'projections.control'
/** The extension's replies to `rendererFile`: a custom renderer bundle file, or why it is unavailable. */
export const rendererTag = 'projections.renderer'
/** The extension's answer to a projection tab page's `restore`: the pair to show and the results it kept (`TabRestore`). */
export const restoreTag = 'projections.restore'
/** The extension's description of what a projection tab shows, for its toolbar's notices and labels (`TabPairLabels`). */
export const pairTag = 'projections.pair'

/** One side of a tab's pair as its toolbar shows it. */
export interface TabSide {
  /** The ref the pair names (a branch, tag, commit or `working-tree`), as the tab's Inspector keys it. */
  ref: string
  name: string
  /** The rest: `"Add auth package" · 2 days ago`, or `1 untracked`. */
  detail: string
  icon: string
  title: string
}

/** What a projection tab shows, as one choice: `Branch changes · main → your files · 3 commits`. */
export interface TabChoice {
  /** `now`, `uncommitted`, `branch`, `pr:<n>`, `last-commit`, `release`, `bookmark:<id>` or `custom`. */
  id: string
  name: string
  detail: string
  icon: string
  title: string
}

/**
 * What a reloaded projection tab page (VS Code drops a hidden tab's webview) shows: the pair the tab shows, and the
 * extractions it showed last when they are for that pair, which it presents again without extracting.
 */
export interface TabRestore {
  tag: typeof restoreTag
  pair?: TabPair
  results?: {[ref: string]: {document: unknown; job?: string; definition?: string}}
  /** The revision whose definition the tab applies. */
  definitionRevision?: string
  /** The projection's current edits (`editKey`), for a page that keeps Show committed for them. */
  editsKey?: string
}

/** A projection tab's choice and the pair it resolved to, named for people, for its toolbar and pane labels. */
export interface TabPairLabels {
  tag: typeof pairTag
  choice: TabChoice
  before?: TabSide
  after?: TabSide
  /** One revision (Now): no comparison. */
  single: boolean
  backwards: boolean
  pinned: boolean
  /**
   * The result is out of date: `Out of date · 3 files changed` (`text`; `label` and `detail` either side of the dot),
   * and why, in a pill over the stage with Refresh.
   */
  stale?: {text: string; label: string; detail?: string; title: string}
  /**
   * The projection's definition (or a file it declares) has uncommitted edits. `yours`: the results apply them
   * ("Your edits", with Show committed); `committed`: the tab shows the committed version by Show committed (with Use
   * my edits).
   */
  edits?: 'yours' | 'committed'
  /** The result is an observation (live or varying data): `Observed 5 minutes ago`, beside Refresh. */
  observed?: {text: string; title: string}
  /** Who observed the result, and how faithfully (`provenanceBadge`): `From CI`, `Imported`, `Local`, `Approximate`, `Stale` or `Observed`. */
  provenance?: {label: string; title: string}
}

export type HostMessage =
  | {tag: typeof hostTag; op: 'openFile'; path: string; line?: number; column?: number}
  | {tag: typeof hostTag; op: 'revealInScm'; ref: string}
  | {tag: typeof hostTag; op: 'copyText'; text: string}
  | {tag: typeof hostTag; op: 'openExternal'; url: string}
  /** The Explore view's Add to CI: the extension hands its own prompt to the coding agent (never the page's text). */
  | {tag: typeof hostTag; op: 'addToCi'}
  /** The Inspector has started and its handle is ready for control messages; a projection tab says its pinned pair. */
  | {tag: typeof hostTag; op: 'ready'; page?: number; pinned?: TabPair | null; committed?: string | null}
  | {tag: typeof hostTag; op: 'controlResult'; id: number; result?: unknown; error?: string}
  /** A custom renderer bundle file (`/custom-renderers/…`), which the page opens as a Blob document. */
  | {tag: typeof hostTag; op: 'rendererFile'; id: number; path: string}
  /** A projection tab page asks what to show as it loads (`TabRestore`): kept results come back without extracting. */
  | {tag: typeof hostTag; op: 'restore'}
  /** A projection tab's new results (the shown pair's extractions), for the extension to keep while the tab is hidden. */
  | {tag: typeof hostTag; op: 'results'; pair: TabPair; results: {[ref: string]: {document: unknown; job?: string; definition?: string}}}
  /** A projection tab's summary changed (its pair, status and change counts), for the side bar. */
  | {tag: typeof hostTag; op: 'summary'; summary: unknown}
  /** The tab toolbar's notices: Refresh, and the edits indicator's Show committed and Use my edits. */
  | {tag: typeof hostTag; op: 'pairAction'; action: 'refresh' | 'showCommitted' | 'useEdits'}

export type RendererReply = {tag: typeof rendererTag; id: number} & ({type: string; base64: string} | {error: string})

export type ControlMessage =
  | {tag: typeof controlTag; id: number; op: 'selectProjection'; projection: string}
  /** Shows a pair; a projection tab's switches are numbered (`generation`), and its summaries say which one they show. */
  | {
      tag: typeof controlTag
      id: number
      op: 'setPair'
      before?: string
      after: string
      projection?: string
      definitionRevision?: string
      generation?: number
    }
  /** Applies the definition from a revision to both sides (`working-tree` uses your edits), extracting again. */
  | {tag: typeof controlTag; id: number; op: 'setDefinitionRevision'; ref: string}
  /**
   * Show committed for the edits `key` (the committed definition, kept with the tab's state across reloads while the
   * edits are the same), or back to the edits (`null`), extracting again.
   */
  | {tag: typeof controlTag; id: number; op: 'showCommitted'; key: string | null}
  | {tag: typeof controlTag; id: number; op: 'selectEntity'; entity: string | null}
  | {tag: typeof controlTag; id: number; op: 'summary'}
  /** What the page presents now, for the agent's current view (`PageView`): items, selection, summary bar and mode. */
  | {tag: typeof controlTag; id: number; op: 'currentView'}
  /** The page's elements matching `selector` (at most 200): their text and, if named, an attribute. For tests. */
  | {tag: typeof controlTag; id: number; op: 'elements'; selector: string; attribute?: string}
  /** Clicks the first element matching `selector` (and containing `text`), as a person would. For tests. */
  | {tag: typeof controlTag; id: number; op: 'click'; selector: string; text?: string}
  /** Focuses the first element matching `selector` (and containing `text`) and presses `key` on it. For tests. */
  | {tag: typeof controlTag; id: number; op: 'press'; selector: string; text?: string; key: string}
  /** A projection tab's view: its comparison mode, playback, how it is shown, or changes only (the editor's title actions). */
  | {tag: typeof controlTag; id: number; op: 'view'; action: ViewAction; value?: string | boolean}
  /** Where the presented changes are drawn and the frame they are drawn in, in the page's coordinates. For tests. */
  | {tag: typeof controlTag; id: number; op: 'anchors'}
  /** The page's elements matching `selector`: their boxes (and left border width), in page coordinates. For tests. */
  | {tag: typeof controlTag; id: number; op: 'boxes'; selector: string}
  /**
   * What the page showed since its first paint: the workbench's empty state ever, and its loading indicators; and since
   * the last `reset`, each distinct state it drew and its renderer frames' messages. For tests.
   */
  | {tag: typeof controlTag; id: number; op: 'probe'; reset?: boolean}
  /** Pins a projection tab to a choice and its pair (kept with the tab's state), or lets it follow the folder's again (`null`). */
  | {tag: typeof controlTag; id: number; op: 'pin'; pair: TabPair | null; generation?: number}
  /** Extracts the shown pair again and compares it: a projection tab's Refresh (tabs never refresh on their own). */
  | {tag: typeof controlTag; id: number; op: 'refresh'}
  /** Shows one of the projection's renderer scenarios instead of the pair (the agent's `open_projection` with `scenario`). */
  | {tag: typeof controlTag; id: number; op: 'showScenario'; scenario: string}

/** A Before → After pair (or one revision, `after`); a pinned tab's also names the choice it is. */
export interface TabPair {
  before?: string
  after: string
  /** The choice's identity (`TabChoice.id`), and a pull request's title. */
  choice?: string
  title?: string
  /** The revision whose definition the tab applies (`HEAD`, the committed version, or `working-tree`). */
  definitionRevision?: string
}

export type ViewAction = 'setMode' | 'togglePlayback' | 'showAs' | 'changesOnly' | 'runAction'

/** What a projection tab's view shows, as it reports it with its summary and keeps with `setState`. */
export interface TabView {
  mode?: string
  modes?: string[]
  playing?: boolean
  showAs?: 'renderer' | 'table' | 'text'
  changesOnly?: boolean
  /** The renderer's zoom actions it declares (`zoom-in`, `zoom-out`, `zoom-fit`). */
  zoom?: string[]
}

/** A control message without its envelope, as callers of the extension's `projections.inspectorControl` pass it. */
export type ControlRequest = ControlMessage extends infer Message ? (Message extends unknown ? Omit<Message, 'tag' | 'id'> : never) : never

/** What the webview page reads from its configuration element. */
export interface WebviewConfig {
  /** The base of the Inspector's assets (its engine and comparator Wasm and renderer bundles), a webview resource URL. */
  assets: string
  /** The bundled engine and comparator Workers, started from Blob URLs. */
  engineWorker: string
  comparatorWorker: string
  nonce: string
  /** Which of its panel's loads this page is, which it says when it's ready. */
  page?: number
  /** `explore` opens the Explore view; otherwise the Inspector. */
  view?: 'explore' | 'inspect'
  /** A projection tab: the projection it presents, with no Inspector shell (`chrome: 'none'`), on the folder's choice's pair. */
  projection?: string
  /** A projection tab's projection title, for its skeleton's "Loading <title>…". */
  title?: string
  before?: string
  after?: string
  chrome?: 'none'
  /** The revision whose definition a projection tab applies to both sides (`HEAD`, or `working-tree`). */
  definitionRevision?: string
  /** A projection tab's projection's current edits (`editKey`), for a page that keeps Show committed for them. */
  editsKey?: string
  /** A projection tab draws its own toolbar (the pair, mode, playback and view controls) instead of title actions. */
  toolbar?: boolean
  /** A projection tab whose definition can't load: why, shown instead of the projection. */
  failure?: ProjectionFailure
}

/** Why a projection can't be shown: its definition file's diagnostics, readable and located. */
export interface ProjectionFailure {
  title: string
  diagnostics: {message: string; path?: string; line?: number; column?: number}[]
}

/**
 * The origin server-relative URLs from the backend (a custom renderer base) resolve against in the webview. The
 * backend speaks over the extension's stdio, so this is a stable sentinel, matching the Origin its in-memory requests
 * carry; nothing is ever fetched from it.
 */
export const runnerOrigin = 'http://stdio.invalid'

/** A repository-relative path the webview may ask to open: no absolute paths, drive letters or `..` segments. */
export function relativePath(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path || path.length > 1024 || path.includes('\0')) return undefined
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => part === '..')) return undefined
  return normalized
}

/** A positive 1-based position, or undefined. */
export function position(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

/** A revision the webview may ask to reveal: `working-tree`, or a plain ref or commit, never an option. */
export function revision(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,199}$/.test(value) && !value.includes('..') ? value : undefined
}

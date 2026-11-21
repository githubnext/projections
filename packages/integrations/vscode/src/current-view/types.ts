/*
 * What the person's projection tab shows, for VS Code's agent: `#projections_current_view` says it (the projection, its
 * choice and resolved revisions, mode, selection, summary counts and changed items), and the other agent tools take an
 * omitted projection, and compare's omitted revisions, from it, saying where they came from so the agent never presents
 * another comparison as the one on screen. Nothing here imports VS Code, so it is unit tested on its own: its modules
 * import each other with `.ts` specifiers, which Node loads from source.
 */

/** The facts of a projection tab and what its page presents, as `current_view` reads them. */

/** One side of the pair the tab shows. */
export interface ViewSide {
  /** The ref the pair names: `working-tree`, `HEAD`, a branch, a tag or a commit. */
  ref: string
  /** The commit it resolved to; none for the working tree. */
  commit?: string
  /** How the toolbar names it: `feature/auth · "Add auth" · 2 days ago`. */
  text?: string
}

/** An item the page presents: an entity, relationship or change. */
export interface ViewItem {
  id: string
  label: string
  kind: string
  status?: string
  /** An identity change's correspondence (`declared`, `split` or `merge`): `unchanged`, but a change. */
  correspondence?: string
  /** A change's context: the items a person needs to read it, which the Changes scope shows beside it. */
  context?: ViewContext
}

/** A change's context: its first items, how many it has, and the comparator rules that added any. */
export interface ViewContext {
  items: {id: string; label: string; kind: string}[]
  total: number
  rules?: string[]
  /** Derived from the structure, as the comparison was saved without context. */
  derived?: boolean
}

/** A summary bar figure: its count of a noun and, in a comparison, the changes of it. */
export interface ViewFigure {
  noun: {singular: string; plural: string}
  count: number
  added?: number
  removed?: number
  modified?: number
  description?: string
}

/** What the tab's page presents now (its `currentView` control). */
export interface PageView {
  status?: string
  error?: string
  compared?: boolean
  rows?: number
  changes?: Record<string, number>
  /** The presented items, changed ones first (at most 100). */
  items?: ViewItem[]
  selection?: ViewItem
  figures?: ViewFigure[]
  mode?: string
  modes?: string[]
  showAs?: string
  changesOnly?: boolean
  /** How many items varied: within tolerance, beyond it, and regenerated from the same inputs. */
  variation?: {within: number; beyond: number; regenerated: number}
  /** The selection's generated values: each name, how it differs, and why, as prose. */
  generated?: {name: string; form: 'plain' | 'regenerated' | 'changed'; words?: string}[]
  /** The playback position of a comparison, 0 (before) to 1 (after). */
  progress?: number
  colorMode?: 'light' | 'dark'
  /** The page's size, in CSS pixels. */
  width?: number
  height?: number
  /** The notices the view shows, for example that a declared input doesn't exist at one revision. */
  notices?: string[]
}

/** What the extension knows of a projection tab, and what its page answered. */
export interface TabFacts {
  /** The tab is the active editor tab; otherwise it is the one shown last. */
  inFront: boolean
  folder: string
  projection: string
  title: string
  description?: string
  /** The definition file, repository-relative. */
  definitionFile?: string
  parts?: {extractor?: unknown; comparator?: unknown; renderer?: unknown}
  /** The choice it shows, as the toolbar names it: `Branch changes`, `#12 Fix the login`, a bookmark. */
  choice: {id: string; name: string; detail?: string}
  pinned: boolean
  before?: ViewSide
  after?: ViewSide
  /** The revision whose definition the shown result applies (`working-tree` or `HEAD`). */
  definitionRevision?: string
  /**
   * `yours`: the result uses the definition's uncommitted edits; `committed`: the person chose Show committed, so it
   * applies the committed definition despite them.
   */
  edits?: 'yours' | 'committed'
  stale?: {why: string; tier: string; files?: number}
  /** What the page answered; none when it didn't (a hidden tab whose page VS Code dropped). */
  page?: PageView
  /** The other open projection tabs' titles. */
  others?: string[]
}

/** What the tools take from the tab: its projection and the revisions it shows, resolved to commits. */
export interface TabDefaults {
  folder: string
  projection: string
  title: string
  choice: string
  pinned: boolean
  /** The resolved pair; only `after` when it shows one revision. */
  pair?: {before?: string; after: string}
  /** The revision whose definition the tab applies to its projection (`working-tree` or `HEAD`). */
  definitionRevision?: string
  parts?: TabFacts['parts']
  /** How the page presents it, for a screenshot of what the person sees. */
  view?: {mode?: string; progress?: number; theme?: 'light' | 'dark'; width?: number; height?: number}
}

/** A side's resolved revision: its commit, else its ref (the working tree). */
export function resolved(side: ViewSide): string {
  return side.commit ?? side.ref
}

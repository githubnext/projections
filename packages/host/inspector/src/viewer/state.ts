import type {ReactNode} from 'react'
import type {InspectorSummary} from '../control.js'
import type {InspectorHost} from '../host.js'
import type {InspectorAssets} from '../mount.js'
import type {InspectorTransport} from '../transport.js'

/** The view state the server owns (`ViewState` in packages/cli/src/view/state.rs). */
export interface ViewerState {
  generation: number
  projection?: string | null
  title?: string | null
  choice?: string | null
  before?: string | null
  after?: string | null
  /** What is compared, in words: `Branch changes`, or the revisions' subjects. */
  compared?: string
  /** Two named revisions' own names (a commit subject in full, `Your files`), which the header shortens. */
  sides?: {before?: string | null; after: string} | null
  mode?: string | null
  selection?: string | null
  scenario?: string | null
  refresh: number
  /** The server's own name, in the long poll's answers: another server at the same URL (one replacing it) has another. */
  instance?: string
  /** The revision whose definition extracts every side (`projections view --definition-revision`); the working tree's when absent. */
  definitionRevision?: string | null
  /** Who chose the projection shown: the agent, or the person from the title's menu. */
  chosenBy?: 'agent' | 'person' | null
  /** The viewer's name, in the long poll's answers: `default`, or the one an agent named. */
  viewer?: string
  /** The page whose report made this generation: for that page, the generation is its own report's echo. */
  reportedBy?: string | null
}

/** The options of `mountViewer`: where the viewer is and how to reach it, and what the embedding host offers. */
export interface MountViewerOptions {
  /** The server's base, `http://127.0.0.1:PORT/TOKEN/`; the page's own directory by default. */
  base?: URL | string
  /** Host capabilities, such as an app's theme (the Copilot canvas adapter). */
  host?: InspectorHost
  /**
   * How the page reaches its viewer, for a host that relays its requests: the viewer's own paths (`/view/state?…`,
   * `/view/report`) and the Inspector's (`/api/…`). By default, `fetch` under `base`.
   */
  transport?: InspectorTransport
  /** The Inspector's assets, for a host whose document can't load them beside it (see `InspectorAssets`). */
  assets?: InspectorAssets
  /**
   * Another viewer answers at the same place (one started with --trust replaced the last): what the page learned from
   * the last one no longer holds. By default the page reloads.
   */
  onReplaced?: () => void
  /** A host's own control at the header's end. */
  headerEnd?: ReactNode
  /**
   * The named viewer the page shows (`projections view show --viewer NAME`), each its own view of its own state; by
   * default the page URL's `?viewer=`, else the default viewer.
   */
  viewer?: string
  /**
   * The page is a capture (`projections view screenshot --page`), not the person's: its viewer doesn't count it as open
   * and it reports nothing. By default the page URL's `?capture`.
   */
  capture?: boolean
}

/** A mounted viewer page: `unmount` stops its requests and removes it. */
export interface MountedViewer {
  unmount(): void
}

/**
 * The status line: what the page is doing, in a few words; empty when there is nothing to say. `build` is the shown
 * projection's custom renderer build (`building`, `built`, `failed` or `untrusted`), when it has one.
 */
export function statusText(state: ViewerState | undefined, summary: InspectorSummary | undefined, build?: string): string {
  if (!state) return 'Connecting…'
  if (!state.projection) return 'Waiting for the agent…'
  if (build === 'building') return 'Building renderer…'
  if (build === 'failed') return "The renderer didn't build. The agent has the details."
  if (!summary) return 'Starting…'
  // An extraction says so in the stage: its loading state, or "Updating…" over the last drawing (`UpdatingChip`).
  if (summary.status === 'extracting') return ''
  if (summary.status === 'failed') return "The extractor didn't run. The agent has the details."
  if (summary.status === 'trust') return 'Needs trust'
  if (summary.error) return 'Something went wrong. The agent has the details.'
  if (build === 'untrusted') return "The renderer can't rebuild without trust. Ask the agent to restart the viewer with trust."
  return ''
}

import type * as vscode from 'vscode'
import type {PanelSource} from './backend-sources.js'
import type {BackendPool} from './backends.js'
import type {BundledDocs} from './docs.js'
import type {QuickPicks} from './pickers.js'
import type {RendererBuilds} from './renderer-builds.js'
import type {Runner} from './runner.js'
import type {Sidebar} from './sidebar.js'

/** What the extension's panels, commands and tools share: made on activation and passed to each. */
export interface Services {
  context: vscode.ExtensionContext
  output: vscode.LogOutputChannel
  /** The backends, one per source, shared by its panel, the comparator test view and commands. */
  backends: BackendPool<PanelSource>
  sidebar: Sidebar
  /** The documentation bundled with the extension, which a built-in part's row opens in the Markdown preview. */
  docs: BundledDocs
  /** The extension's quick picks, which tests wait for and answer. */
  picks: QuickPicks
  /** A projection tab opened, closed, moved its pair or showed new results: the Definition view follows. */
  tabsChanged: vscode.EventEmitter<void>
  /** Custom renderers built on save while a tab of their projection is open (`renderer-builds.ts`), once made. */
  rendererBuilds?: RendererBuilds | undefined
  /** Runs `action` with the folder's backend (`withBackend`). */
  withBackend: <T>(folder: vscode.WorkspaceFolder, action: (runner: Runner) => Promise<T>) => Promise<T>
}

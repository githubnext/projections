import * as vscode from 'vscode'
import {flattenSources} from '../configuration-model.js'
import type {DefinitionView} from '../definition.js'
import type {BundledDocs} from '../docs.js'
import type {agentTools} from '../language-model-tools.js'
import type {registerNewProjection} from '../new-projection.js'
import {ProjectionTab} from '../panels/projection-tab.js'
import {holdJobs} from '../panels/projection-tab/jobs.js'
import type {QuickPicks} from '../pickers.js'
import {counters} from '../probe.js'
import type {ProjectionSources} from '../projection-sources.js'
import type {ControlRequest} from '../protocol.js'
import type {Services} from '../services.js'
import type {Sidebar} from '../sidebar.js'
import type {StatusBar} from '../status-bar.js'
import type {ProjectionTests} from '../testing.js'
import type {ViewingView} from '../viewing.js'

/** What the extension's API for tests reads: its views, tabs, quick picks and tools, once activation made them. */
export interface ApiParts {
  services: Services
  sidebar: Sidebar
  tests: ProjectionTests
  tools: ReturnType<typeof agentTools>
  newProjection: ReturnType<typeof registerNewProjection>
  sources: ProjectionSources
  docs: BundledDocs
  picks: QuickPicks
  definitionView: () => DefinitionView
  viewingView: () => ViewingView
  statusBar: () => StatusBar
}

/** For tests: the Testing view's items, the side bar's views and projection tabs. */
export function extensionApi({
  services,
  sidebar,
  tests,
  tools,
  newProjection,
  sources,
  docs,
  picks,
  definitionView,
  viewingView,
  statusBar,
}: ApiParts) {
  return {
    comparatorTests: tests.api(),
    agentTools: tools.api,
    /** New Projection…'s input boxes and agent prompt, and the Projections section's selected rows. */
    newProjection: {
      ...newProjection.api,
      selected: () => sidebar.projectionsView.selection.flatMap(node => (node.kind === 'projection' ? [node.definition.id] : [])),
    },
    sidebar: {
      /** The Definition view's title and rows (following the active projection tab), and a row's click. */
      definition: () => definitionView().rows(),
      definitionActivate: (kind: string, label?: string) => definitionView().activate(kind as never, label),
      /** The Viewing view's title and rows, a row's click (or inline action) by its id, and how many times it checked recent commits. */
      viewing: () => viewingView().rows(),
      viewingActivate: (id: string, action?: 'choose' | 'bookmark' | 'remove') => viewingView().activate(id, action),
      viewingFinds: () => viewingView().finds,
      /** How many times each visible update happened (`probe.ts`): tree refreshes, page loads, pairs sent, jobs. */
      counters: () => counters(),
      /** The Suggested view's rows and the context keys that show it. */
      suggested: () => sidebar.suggestedRows(),
      /** A Projections row's decoration (its badge and color), as the FileDecorationProvider gives it. */
      decoration: (projection: string) => sidebar.decorationFor(vscode.workspace.workspaceFolders![0]!, projection),
      /** The items Go to Source… showed last (`Group: label`). */
      sources: () => sources.last,
      /** Opens a projection's Go to Source… entry by its label, as accepting it in the quick pick does. */
      openSource: async (projection: string, label: string) => {
        const folder = vscode.workspace.workspaceFolders![0]!
        const item = flattenSources(await sources.nodes(folder, projection)).find(entry => entry.label === label)
        if (!item) throw new Error(`No ${label} in ${projection}'s sources`)
        await sources.open(folder, item)
      },
      /** The bundled documentation pages read, and how many times the extension opened something outside VS Code. */
      docs: () => docs.state(),
      /** The diagnostics on a workspace file (an invalid definition's, or its shown extractions'). */
      diagnostics: (uri: vscode.Uri) => sidebar.diagnosticsFor(uri),
      rows: () => sidebar.rows(),
      refresh: () => sidebar.refresh(),
      badge: () => sidebar.badge(),
      /** The status bar item's text, and all it shows (its tooltip, accessible label, command and whether it is shown). */
      status: () => statusBar().state().text,
      statusBar: () => statusBar().state(),
      /** Holds each new extraction job this long before it reaches the backend (0: not at all), to see a long job. */
      holdJobs,
      /**
       * The open tabs of a projection: whether each is in front (the tab the title bar's commands act on), whether it
       * is pinned, its last summary and its icon's file.
       */
      tabs: (projection: string) =>
        [...ProjectionTab.tabs]
          .filter(tab => tab.projection === projection)
          .map(tab => ({
            inFront: ProjectionTab.current === tab,
            pinned: tab.pinned?.pair ?? null,
            choice: tab.pinned?.id ?? null,
            jobs: tab.jobs,
            checked: tab.checked,
            loads: tab.loads,
            firstPage: tab.firstPage ?? null,
            boundAt: tab.boundAt ?? null,
            stale: tab.stale ?? null,
            summary: tab.last ?? null,
            icon: tab.panel.iconPath && 'dark' in tab.panel.iconPath ? tab.panel.iconPath.dark.path.split('/').pop() : null,
          })),
      /** Reloads a projection's tab as a window reload would (the extension forgets the tab; its page state remains). */
      reload: (projection: string) => {
        const tab = ProjectionTab.find(projection)
        if (!tab) throw new Error(`No ${projection} tab is open`)
        tab.reloadAsNew()
      },
      /** Custom renderer builds: each one's projection, state and whether its task runs. */
      rendererBuilds: () => services.rendererBuilds?.list() ?? [],
      /** Whether one of the extension's quick picks is shown, for tests that answer it. */
      picking: () => picks.open > 0,
      /** The shown quick pick's title and items (separators as `---` and their label). */
      pickItems: () =>
        picks.shown
          ? {
              title: picks.shown.title ?? null,
              active: picks.shown.activeItems.map(item => item.label),
              items: picks.shown.items.map(item =>
                item.kind === vscode.QuickPickItemKind.Separator ? `--- ${item.label}`.trimEnd() : item.label,
              ),
            }
          : null,
      /** Picks a shown quick pick's item by its label, as a person would (it becomes active, then Enter). */
      pick: async (label: string) => {
        const item = picks.shown?.items.find(entry => entry.kind !== vscode.QuickPickItemKind.Separator && entry.label === label)
        if (!picks.shown || !item) throw new Error(`No ${label} in the quick pick`)
        picks.shown.activeItems = [item]
        // The extension host sends the active item on its next tick: accept once the workbench has it.
        await new Promise(resolve => setTimeout(resolve, 200))
        await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem')
      },
      /** The latest `changes` generation of the first folder, and the one each tab of a projection last checked. */
      generation: () => sidebar.model(vscode.workspace.workspaceFolders![0]!).generation,
      /** Drives a projection's open tab, as `projections.inspectorControl` drives a panel. */
      control: (projection: string, message: ControlRequest) => {
        const tab = ProjectionTab.find(projection)
        if (!tab) throw new Error(`No ${projection} tab is open`)
        return tab.control(message)
      },
    },
  }
}

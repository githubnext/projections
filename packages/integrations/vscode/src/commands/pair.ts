import * as vscode from 'vscode'
import {isChoice} from '../choices/model.js'
import {unavailableReason} from '../choices/resolve.js'
import {refreshPickLabel} from '../choices/status.js'
import {projectionScheme} from '../decorations.js'
import {ProjectionTab} from '../panels/projection-tab.js'
import {chooseRevision, folderFrom} from '../pickers.js'
import {refLabel, swapped, type Pair} from '../projections/pairs.js'
import type {Services} from '../services.js'
import type {ViewingView} from '../viewing.js'

/** The repository's choice's commands: choose (the picker), set, swap, two revisions, compare all. */
export function pairCommands(services: Services, viewingView: ViewingView): vscode.Disposable[] {
  const {sidebar, picks} = services
  return [
    vscode.commands.registerCommand('projections.setPair', async (folderUri: vscode.Uri | string, pair: Pair) => {
      const folder = vscode.workspace.getWorkspaceFolder(typeof folderUri === 'string' ? vscode.Uri.parse(folderUri) : folderUri)
      if (!folder || typeof pair?.after !== 'string') return
      const model = sidebar.model(folder)
      await model.load()
      model.setPair({...(pair.before ? {before: pair.before} : {}), after: pair.after})
    }),
    // A choice by its identity (`now`, `uncommitted`, `branch`, `last-commit`, `release`, `bookmark:<id>`), or a choice
    // with its revisions (`custom`, `pr:<n>`, `pair:<before>..<after>`), for keybindings, other extensions and tests. A
    // keybinding's `args` is the choice alone, for the folder in front.
    vscode.commands.registerCommand('projections.setChoice', async (argument: unknown, value?: unknown) => {
      const alone = value === undefined && isChoice(argument)
      const folder = await folderFrom(alone ? undefined : argument)
      if (!folder) return
      const choice = alone ? argument : typeof value === 'string' ? {id: value} : value
      if (!isChoice(choice)) throw new Error(`Projections: ${JSON.stringify(value)} isn't a choice`)
      const model = sidebar.model(folder)
      await model.load()
      const reason = unavailableReason(choice, model.facts())
      if (reason) throw new Error(`Projections: ${model.describe(choice, undefined).name} isn't available: ${reason}`)
      model.choose(choice)
    }),
    vscode.commands.registerCommand('projections.swapPair', async (argument?: unknown) => {
      // From a projection tab's title bar, the tab swaps (its own pair when pinned).
      if (argument instanceof vscode.Uri && argument.scheme === projectionScheme && ProjectionTab.current) {
        return ProjectionTab.current.swap()
      }
      const folder = await folderFrom(argument)
      if (!folder) return
      const model = sidebar.model(folder)
      await model.load()
      if (model.pair?.before) model.setPair(swapped(model.pair))
    }),
    // The Viewing quick pick (the status bar item's click, and a projection tab's `…` menu): the Viewing view's rows,
    // from the same item model; picking one does what its click does, Show in Side Bar reveals the view.
    vscode.commands.registerCommand('projections.changePair', async (argument?: unknown) => {
      const folder = await folderFrom(argument)
      if (!folder) return
      const model = sidebar.model(folder)
      await model.load()
      // The tab in front out of date: Refresh first, as its pill's Refresh.
      const front = ProjectionTab.current?.folder === folder ? ProjectionTab.current : undefined
      const refresh = refreshPickLabel(front && sidebar.active?.projection === front.projection ? sidebar.active.stale : undefined)
      const items: (vscode.QuickPickItem & {command?: vscode.Command; current?: boolean; refresh?: boolean})[] = [
        ...(refresh
          ? [
              {label: refresh, refresh: true},
              {label: '', kind: vscode.QuickPickItemKind.Separator},
            ]
          : []),
        ...viewingView.pickItems(model),
      ]
      const chosen = await picks.show(items, {
        title: 'Viewing',
        placeHolder: 'What should projections show?',
        matchOnDescription: true,
        // The current choice is the active item, as a picker opens on the current setting.
        active: items.find(item => item.current),
      })
      if (!chosen) return
      if (chosen.refresh) return front?.refresh()
      const command = chosen.command ?? {title: 'Show in Side Bar', command: 'projections.viewing.focus'}
      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []))
    }),
    vscode.commands.registerCommand('projections.choosePair', async (argument?: unknown) => {
      const folder = await folderFrom(argument)
      if (!folder) return
      const model = sidebar.model(folder)
      const before = await chooseRevision(services, folder, 'Before', 'The revision to compare from')
      if (!before) return
      const after = await chooseRevision(services, folder, 'After', `Compare ${refLabel(before)} with`)
      if (after) model.setPair({before, after})
    }),
    vscode.commands.registerCommand('projections.compareAll', async (argument?: unknown) => {
      const folder = await folderFrom(argument)
      if (!folder) return
      const model = sidebar.model(folder)
      await model.load()
      if (!model.pair?.before) {
        return void vscode.window.showInformationMessage(
          `Projections: ${model.describe().name} shows the working tree alone, so there's nothing to count. Choose a comparison first.`,
        )
      }
      await vscode.window.withProgress(
        {location: {viewId: 'projections.projections'}, title: 'Comparing every projection', cancellable: true},
        (progress, token) => model.compareAll(progress, token),
      )
    }),
  ]
}

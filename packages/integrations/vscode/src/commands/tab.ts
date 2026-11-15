import * as vscode from 'vscode'
import {ProjectionTab} from '../panels/projection-tab.js'
import {definitionFile} from '../projection-sources.js'
import type {ProjectionSources} from '../projection-sources.js'
import {modeTitles, nextMode} from '../projections/pairs.js'
import {rowTarget} from './row.js'

/** The projection editor's title actions and its `…` menu, on the projection tab in front. */
export function tabCommands(sources: ProjectionSources): vscode.Disposable[] {
  const current = () => {
    const tab = ProjectionTab.current
    if (!tab) throw new Error('No projection tab is in front')
    return tab
  }
  const view = (action: 'setMode' | 'togglePlayback' | 'showAs' | 'changesOnly' | 'runAction', value?: string | boolean) =>
    current().control({op: 'view', action, ...(value === undefined ? {} : {value})})
  const cycleMode = () => {
    const shown = current().last?.view
    const next = nextMode(shown?.mode, shown?.modes ?? [])
    return next ? view('setMode', next) : undefined
  }
  return [
    // The code behind the projection in front (an editor title button, and the palette).
    vscode.commands.registerCommand('projections.goToSource', () => {
      const tab = current()
      return sources.goTo(tab.folder, tab.projection)
    }),
    // One command per mode, each showing that mode's icon in the title bar; each moves on to the next mode.
    ...Object.keys(modeTitles).map(mode => vscode.commands.registerCommand(`projections.mode.${mode}`, cycleMode)),
    vscode.commands.registerCommand('projections.chooseMode', async () => {
      const shown = current().last?.view
      const chosen = await vscode.window.showQuickPick(
        (shown?.modes ?? []).map(mode => ({
          label: modeTitles[mode] ?? mode,
          mode,
          picked: mode === shown?.mode,
          description: mode === shown?.mode ? 'current' : '',
        })),
        {title: 'Comparison Mode'},
      )
      if (chosen) await view('setMode', chosen.mode)
    }),
    vscode.commands.registerCommand('projections.play', () => view('togglePlayback')),
    vscode.commands.registerCommand('projections.pause', () => view('togglePlayback')),
    ...(['renderer', 'table', 'text'] as const).map(kind =>
      vscode.commands.registerCommand(`projections.showAs.${kind}`, () => view('showAs', kind)),
    ),
    // The renderer's zoom, which its own toolbar offered.
    ...(['fit', 'in', 'out'] as const).map(zoom =>
      vscode.commands.registerCommand(`projections.zoom.${zoom}`, () => view('runAction', `zoom-${zoom}`)),
    ),
    vscode.commands.registerCommand('projections.changesOnly.on', () => view('changesOnly', true)),
    vscode.commands.registerCommand('projections.changesOnly.off', () => view('changesOnly', false)),
    // From the tab in front, or a Projections row's context menu.
    vscode.commands.registerCommand('projections.openDefinition', async (node?: unknown) => {
      const target = rowTarget(node) ?? {folder: current().folder, id: current().projection}
      const file = await definitionFile(target.folder, target.id)
      if (file) return vscode.window.showTextDocument(file)
      void vscode.window.showWarningMessage(`Projections: no definition file defines ${target.id}`)
    }),
  ]
}

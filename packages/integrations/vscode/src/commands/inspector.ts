import * as vscode from 'vscode'
import {sourceRoot} from '../backend-sources.js'
import {InspectorPanel} from '../panels/inspector-panel.js'
import {chooseFolder} from '../pickers.js'
import type {ControlRequest} from '../protocol.js'
import {defaultBranch} from '../refs.js'
import type {Services} from '../services.js'
import {execFileOutput as run} from '../exec.ts'

/**
 * The Inspector's commands: the repository's Inspector and Explore views, Compare Branch with Default, a saved
 * document or a renderer's scenarios in a panel of its own, and driving an open panel (for tests and other extensions).
 */
export function inspectorCommands(services: Services): vscode.Disposable[] {
  const {output} = services
  const open = async (view: 'explore' | 'inspect' = 'inspect') => {
    const folder = await chooseFolder()
    return folder ? InspectorPanel.open(services, {kind: 'repository', folder}, view) : undefined
  }
  return [
    vscode.commands.registerCommand('projections.openInspector', () => open('inspect')),
    // The Explore view: the projections this repository could have, trying them on recent changes, and adopting them.
    vscode.commands.registerCommand('projections.exploreRepository', () => open('explore')),
    vscode.commands.registerCommand('projections.compareBranchWithDefault', async () => {
      const panel = await open('inspect')
      if (!panel) return
      try {
        const cwd = sourceRoot(panel.source).fsPath
        const base = await defaultBranch(cwd)
        const {stdout} = await run('git', ['merge-base', base, 'HEAD'], {cwd})
        const before = stdout.trim()
        await panel.control({op: 'setPair', before, after: 'HEAD'})
        output.info(`Comparing ${base} (merge base ${before.slice(0, 8)}) → HEAD`)
      } catch (error) {
        void vscode.window.showErrorMessage(`Projections: ${error instanceof Error ? error.message : error}`)
      }
    }),
    // A saved extraction, comparison or pull request review (`projections show --output`, `projections pr`), presented
    // as it was saved; nothing runs.
    vscode.commands.registerCommand('projections.openArtifact', async (uri?: vscode.Uri) => {
      const file =
        uri ??
        (
          await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {'Projections documents': ['json']},
            title: 'Open a saved extraction, comparison or review',
          })
        )?.[0]
      return file ? InspectorPanel.open(services, {kind: 'document', file}).then(() => undefined) : undefined
    }),
    // A renderer package's (or a directory's) scenarios, with its bundle: the renderer and comparator workbench.
    vscode.commands.registerCommand('projections.openScenarios', async (uri?: vscode.Uri) => {
      const directory =
        uri ??
        (
          await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Open the scenarios of a renderer package or directory',
          })
        )?.[0]
      return directory ? InspectorPanel.open(services, {kind: 'fixtures', directory}).then(() => undefined) : undefined
    }),
    // For tests and other extensions: drive the open Inspector. It opens the repository's Inspector unless a panel is
    // already open (on either view); `target` drives the latest document or scenarios panel instead.
    vscode.commands.registerCommand('projections.inspectorControl', async (message: ControlRequest, target?: 'document' | 'fixtures') => {
      if (target) {
        const panel = InspectorPanel.latest(target)
        if (!panel) throw new Error(`No ${target} panel is open`)
        return panel.control(message)
      }
      const folder = await chooseFolder()
      if (!folder) return undefined
      const panel = InspectorPanel.find(folder) ?? (await InspectorPanel.open(services, {kind: 'repository', folder}, 'inspect'))
      return panel?.control(message)
    }),
  ]
}

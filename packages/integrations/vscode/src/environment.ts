// The environment in VS Code: the Projections: Prepare Environment command, which runs the repository's prepare
// steps (in the working tree, or the workspace for a commit) through the folder's backend, with progress, an output
// channel and cancellation. The logic is in environment-model.ts.
import * as vscode from 'vscode'
import type {Lease} from './backends.js'
import {prepareEnvironment} from './environment-model.js'

export function registerEnvironment(lease: (folder: vscode.WorkspaceFolder) => Lease): vscode.Disposable[] {
  const output = vscode.window.createOutputChannel('Projections: Prepare')
  const command = vscode.commands.registerCommand(
    'projections.prepareEnvironment',
    async (target?: {folder?: vscode.Uri; revision?: string}) => {
      const folders = vscode.workspace.workspaceFolders ?? []
      const folder =
        (target?.folder && vscode.workspace.getWorkspaceFolder(target.folder)) ||
        (folders.length === 1
          ? folders[0]
          : await vscode.window.showWorkspaceFolderPick({placeHolder: 'Prepare the environment of which folder?'}))
      if (!folder) return
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage(
          "Preparing runs the repository's prepare steps, which are repository code: trust the workspace first.",
        )
        return
      }
      let revision = target?.revision
      if (revision === undefined) {
        const choice = await vscode.window.showQuickPick(
          [
            {label: 'Working tree', description: 'Run the prepare steps in your checkout', target: 'working-tree'},
            {label: 'A commit…', description: 'Prepare the workspace Projections keeps for a commit', target: 'commit'},
          ],
          {placeHolder: 'Prepare which?'},
        )
        if (!choice) return
        if (choice.target === 'commit') {
          revision = await vscode.window.showInputBox({prompt: 'A branch, tag or commit', placeHolder: 'main'})
          if (!revision) return
        }
      }
      const held = lease(folder)
      output.show(true)
      output.appendLine(`Preparing ${revision ? `the workspace for ${revision}` : 'the working tree'} of ${folder.name}`)
      try {
        const runner = await held.current()
        const run = await vscode.window.withProgress(
          {location: vscode.ProgressLocation.Notification, title: 'Projections: preparing the environment', cancellable: true},
          (progress, token) => {
            const abort = new AbortController()
            token.onCancellationRequested(() => abort.abort())
            return prepareEnvironment(
              runner,
              {...(revision ? {revision} : {})},
              line => {
                output.appendLine(line)
                progress.report({message: line})
              },
              abort.signal,
            )
          },
        )
        if (run.status === 'succeeded') {
          output.appendLine('Prepared.')
          void vscode.window.showInformationMessage(
            `Projections prepared ${revision ? `the workspace for ${revision}` : 'the working tree'}.`,
          )
        } else {
          output.appendLine(run.error ?? run.status)
          if (run.log) output.appendLine(`The log ends:\n${run.log.split('\n').slice(-20).join('\n')}`)
          const show = await vscode.window.showErrorMessage(`Preparing the environment ${run.status}: ${run.error ?? ''}`, 'Show Output')
          if (show) output.show()
        }
      } catch (error) {
        output.appendLine(String((error as Error).message ?? error))
        void vscode.window.showErrorMessage(`Preparing the environment failed: ${(error as Error).message}`)
      } finally {
        held.dispose()
      }
    },
  )
  return [output, command]
}

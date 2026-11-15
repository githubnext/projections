import * as vscode from 'vscode'
import type {QuickPicks} from '../pickers.js'
import {definitionFile} from '../projection-sources.js'
import {definitionEntry} from '../projections/definition-entry.js'

/**
 * A part's entry in the definition file, from the Configuration view (selected; an absent one, such as the default
 * comparator, is started where it would go with the schema's suggestions). `beside` keeps the tab in front in view.
 */
export function partCommands(picks: QuickPicks): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      'projections.openPart',
      async (folderUri: vscode.Uri, id: string, part: string, options?: {beside?: boolean}) => {
        const folder = vscode.workspace.getWorkspaceFolder(folderUri)
        if (!folder || !['extractor', 'comparator', 'renderer'].includes(part)) return
        const file = await definitionFile(folder, id)
        if (!file) return void vscode.window.showWarningMessage(`Projections: no definition file defines ${id}`)
        const editor = await vscode.window.showTextDocument(file, {
          preview: true,
          ...(options?.beside ? {viewColumn: vscode.ViewColumn.Beside} : {}),
        })
        const document = editor.document
        const entry = definitionEntry(document.getText(), part)
        if (!entry) return
        if ('start' in entry) {
          editor.selection = new vscode.Selection(document.positionAt(entry.start), document.positionAt(entry.end))
          editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
          return
        }
        // Absent (the default comparator): looking changes nothing. Adding one is a choice, and each choice inserts valid JSON.
        const at = document.positionAt(entry.insert)
        editor.selection = new vscode.Selection(at, at)
        editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
        if (part !== 'comparator') return
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, '**/*.comparator.{yaml,yml}'),
          '**/{node_modules,.git,target,dist}/**',
          50,
        )
        type Choice = vscode.QuickPickItem & {value?: string; options?: boolean}
        const choices: Choice[] = [
          {label: '$(settings) Configure the default comparator', detail: 'Adds "comparator": {} and suggests its options', options: true},
          ...files.map(uri => {
            const path = vscode.workspace.asRelativePath(uri, false)
            return {label: `$(file) ${path}`, detail: 'Use this comparator file', value: path}
          }),
        ]
        const choice = await picks.show(choices, {
          title: `${id} uses the default comparator`,
          placeHolder: 'Change it, or press Escape to leave it as it is',
        })
        if (!choice) return
        const snippet = choice.options
          ? new vscode.SnippetString(`,\n  "comparator": {$0}`)
          : new vscode.SnippetString(`,\n  "comparator": ${JSON.stringify(choice.value)}$0`)
        await editor.insertSnippet(snippet, at)
        if (choice.options) await vscode.commands.executeCommand('editor.action.triggerSuggest')
      },
    ),
  ]
}

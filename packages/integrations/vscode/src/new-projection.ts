/*
 * **Projections: New Projection…**, the (+) in the Projections section's title bar: a guided quick pick that starts a
 * projection from a suggestion, from built-ins, from custom parts or with an agent, then writes it with the CLI's
 * `projections init` (the same flags a person would pass) and opens it. What it offers and runs is
 * `new-projection-model.ts`'s.
 */
import * as vscode from 'vscode'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {FolderModel} from './folder-model.js'
import {identifierPattern, startItems} from './new-projection-model.js'
import type {Plan, Start} from './new-projection-model.js'
import {fromBuiltins, fromCustomParts, fromSuggestion, withAgent} from './new-projection/starts.js'
import {repository} from './new-projection/steps.js'
import {title, Wizard} from './new-projection/wizard.js'
import {byTitle} from './projections/definitions.js'
import type {Runner} from './runner.js'

type Pick = <Item extends vscode.QuickPickItem>(
  items: readonly Item[],
  options: {title?: string; placeHolder?: string; matchOnDescription?: boolean},
) => Promise<Item | undefined>

/** What the command needs from the extension. */
export interface NewProjectionHost {
  extensionPath: string
  output: vscode.LogOutputChannel
  chooseFolder(): Promise<vscode.WorkspaceFolder | undefined>
  /** The extension's tracked quick pick, which tests answer. */
  pick: Pick
  model(folder: vscode.WorkspaceFolder): FolderModel
  withBackend<T>(folder: vscode.WorkspaceFolder, action: (runner: Runner) => Promise<T>): Promise<T>
  openProjection(folder: vscode.Uri, id: string, options: {preview?: boolean}): Promise<void>
  /** Selects a projection's row in the Projections section. */
  reveal(folder: vscode.WorkspaceFolder, id: string): Promise<void>
}

export function registerNewProjection(host: NewProjectionHost) {
  let lastPrompt: string | undefined
  const wizard = new Wizard(host, () =>
    identifierPattern(JSON.parse(readFileSync(join(host.extensionPath, 'dist', 'schemas', 'definition', 'v0.json'), 'utf8'))),
  )

  /** The guided flow: how to start, the parts, the ID and title, then `projections init`. */
  const run = async (): Promise<Plan | undefined> => {
    if (!vscode.workspace.isTrusted) {
      await wizard.error('creating a projection writes files into this repository, which needs a trusted workspace.', {
        title: 'Manage Workspace Trust',
        run: () => vscode.commands.executeCommand('workbench.trust.manage'),
      })
      return undefined
    }
    const folder = await host.chooseFolder()
    if (!folder) return undefined
    const model = host.model(folder)
    await model.load()
    // The Suggested section's source and order: the candidates that apply here and aren't adopted, by title.
    const suggestions = byTitle(
      model.candidates.filter(candidate => !candidate.adopted),
      candidate => candidate.title,
      candidate => candidate.id,
    )
    const start = (await host.pick(startItems(suggestions.length), {title, placeHolder: 'How do you want to start the projection?'}))?.start
    if (!start) return undefined
    const target = {folder, directory: repository(wizard, folder).directory}
    try {
      switch (start) {
        case 'explore':
          await vscode.commands.executeCommand('projections.exploreRepository')
          return undefined
        case 'suggestion':
          return await fromSuggestion(wizard, target, suggestions)
        case 'builtin':
          return await fromBuiltins(wizard, target)
        case 'custom':
          return await fromCustomParts(wizard, target)
        case 'agent':
          return await withAgent(wizard, target, prompt => (lastPrompt = prompt))
      }
    } catch (failure) {
      await wizard.showCliError(failure)
      return undefined
    }
  }

  return {
    disposable: vscode.commands.registerCommand('projections.newProjection', run),
    /** For tests: the input box shown (its title, value and validation message), answering it, and the agent's prompt. */
    api: {
      input: () =>
        wizard.shownInput
          ? {
              title: wizard.shownInput.title ?? null,
              value: wizard.shownInput.value,
              validation: (wizard.shownInput.validationMessage as string | undefined) ?? null,
            }
          : null,
      answer: async (value: string) => {
        if (!wizard.shownInput) throw new Error('No input box is shown')
        wizard.shownInput.value = value
        // The extension host sends the value on its next tick: accept once the workbench has it.
        await new Promise(resolve => setTimeout(resolve, 200))
        await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem')
      },
      prompt: () => lastPrompt ?? null,
    },
  }
}

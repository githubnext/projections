import * as vscode from 'vscode'
import {execFile} from 'node:child_process'
import type {NewProjectionHost} from '../new-projection.js'
import {failureMessage} from '../new-projection-model.js'
import {ensureExecutable, resolveCli} from '../runner/cli.js'

export const title = 'New projection'

/** A CLI run that failed: its message, and whether the executable is missing. */
export class CliError extends Error {
  readonly missing: boolean

  constructor(message: string, missing: boolean) {
    super(message)
    this.missing = missing
  }
}

export interface InputOptions {
  title: string
  prompt: string
  value?: string
  placeholder?: string
  validate?: (value: string) => string | undefined
}

/** What every step of New Projection… uses: the host, the CLI, input boxes, errors and the ID pattern. */
export class Wizard {
  /** The input box shown, which tests answer. */
  shownInput: vscode.InputBox | undefined
  private pattern: RegExp | undefined

  readonly host: NewProjectionHost
  private readonly identifierPattern: () => RegExp

  constructor(host: NewProjectionHost, identifierPattern: () => RegExp) {
    this.host = host
    this.identifierPattern = identifierPattern
  }

  /** The definition schema's ID pattern, read once. */
  idPattern(): RegExp {
    return (this.pattern ??= this.identifierPattern())
  }

  private cli() {
    const location = resolveCli({
      setting: vscode.workspace.getConfiguration('projections').get<string>('cliPath'),
      extensionPath: this.host.extensionPath,
    })
    if (location.source === 'bundled') ensureExecutable(location.path)
    return location
  }

  /** Runs the CLI in the folder, resolving its standard output. */
  runCli(folder: vscode.WorkspaceFolder, args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const executable = this.cli().path
      this.host.output.info(`projections ${args.map(arg => (/^[\w./@:-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ')}`)
      execFile(executable, args, {cwd: folder.uri.fsPath, maxBuffer: 32 * 1024 * 1024}, (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
        if (stderr.trim()) this.host.output.error(stderr.trim())
        reject(
          new CliError(
            missing ? `The projections CLI isn't installed: ${executable} was not found.` : failureMessage(stderr || error.message),
            missing,
          ),
        )
      })
    })
  }

  /** An input box tests can answer; it stays open while its value is invalid. */
  input(options: InputOptions): Promise<string | undefined> {
    const box = vscode.window.createInputBox()
    box.title = options.title
    box.prompt = options.prompt
    box.value = options.value ?? ''
    if (options.placeholder) box.placeholder = options.placeholder
    const check = () => (box.validationMessage = options.validate?.(box.value.trim()))
    check()
    return new Promise(resolve => {
      let accepted: string | undefined
      box.onDidChangeValue(check)
      box.onDidAccept(() => {
        if (check()) return
        accepted = box.value.trim()
        box.hide()
      })
      box.onDidHide(() => {
        if (this.shownInput === box) this.shownInput = undefined
        box.dispose()
        resolve(accepted)
      })
      box.show()
      this.shownInput = box
    })
  }

  async error(message: string, ...actions: {title: string; run: () => unknown}[]) {
    this.host.output.error(message)
    const chosen = await vscode.window.showErrorMessage(`Projections: ${message}`, ...actions.map(action => action.title))
    await actions.find(action => action.title === chosen)?.run()
  }

  showCliError(failure: unknown) {
    return failure instanceof CliError && failure.missing
      ? this.error(`${failure.message} Reinstall the Projections extension, or set projections.cliPath to a projections executable.`, {
          title: 'Open Settings',
          run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'projections.cliPath'),
        })
      : this.error(failure instanceof Error ? failure.message : String(failure))
  }
}

import * as vscode from 'vscode'
import type {BackendPool} from './backends.js'
import {workspaceArguments} from './environment-model.js'
import {startRunner} from './runner.js'
import {ensureExecutable, incompatibility, resolveCli} from './runner/cli.js'
import type {Runner} from './runner.js'
import {scenarioRenderer, sourceArguments} from './sources.js'

/**
 * What a panel presents: a repository folder (the Inspector and Explore), a saved extraction, comparison or pull
 * request review (`serve --stdio --document`), or a renderer package's scenarios (`serve --stdio --fixtures`).
 */
export type PanelSource =
  | {kind: 'repository'; folder: vscode.WorkspaceFolder}
  | {kind: 'document'; file: vscode.Uri}
  | {kind: 'fixtures'; directory: vscode.Uri}

/** A panel's key: one panel per repository, document or scenarios directory. */
export function sourceKey(source: PanelSource): string {
  return source.kind === 'repository'
    ? source.folder.uri.toString()
    : `${source.kind}:${(source.kind === 'document' ? source.file : source.directory).toString()}`
}

/** Where a panel's backend runs, and repository-relative paths open from. */
export function sourceRoot(source: PanelSource): vscode.Uri {
  if (source.kind === 'repository') return source.folder.uri
  const own = source.kind === 'document' ? vscode.Uri.joinPath(source.file, '..') : source.directory
  return vscode.workspace.getWorkspaceFolder(own)?.uri ?? own
}

/**
 * Starts `projections serve --stdio` for a source: the configured CLI, else the bundled one (see `resolveCli`), with
 * `--trust` for a repository or renderer scenarios in a trusted workspace. A CLI this extension can't use is refused with why.
 */
export async function launch(context: vscode.ExtensionContext, output: vscode.LogOutputChannel, source: PanelSource): Promise<Runner> {
  const cli = resolveCli({
    setting: vscode.workspace.getConfiguration('projections').get<string>('cliPath'),
    extensionPath: context.extensionPath,
  })
  if (cli.source === 'bundled') ensureExecutable(cli.path)
  const version = String((context.extension.packageJSON as {version?: unknown}).version ?? '0.0.0')
  const path = source.kind === 'document' ? source.file.fsPath : source.kind === 'fixtures' ? source.directory.fsPath : undefined
  const scenarios = source.kind === 'fixtures' && path ? scenarioRenderer(path, vscode.workspace.isTrusted) : undefined
  if (scenarios?.withheld)
    void vscode.window.showWarningMessage(
      "This renderer package's own renderer is repository code, which runs only in a trusted workspace: its scenarios use the built-in renderer for their schema.",
    )
  return startRunner({
    executable: cli.path,
    repository: sourceRoot(source).fsPath,
    // A scenarios backend's --trust serves only the renderer bundles its scenarios name.
    trust: (source.kind === 'repository' || source.kind === 'fixtures') && vscode.workspace.isTrusted,
    args: [
      ...sourceArguments({kind: source.kind, ...(path ? {path} : {}), renderer: scenarios?.renderer ?? false}),
      ...(source.kind === 'repository' ? workspaceArguments(vscode.workspace.getConfiguration('projections').get('workspace')) : []),
    ],
    log: line => output.info(line),
    check: info => incompatibility(info, version, cli),
  })
}

/**
 * Runs `action` with the folder's backend: the shared one when a panel or the test view holds it, else one started for
 * it and stopped afterwards.
 */
export async function withBackend<T>(
  backends: BackendPool<PanelSource>,
  folder: vscode.WorkspaceFolder,
  action: (runner: Runner) => Promise<T>,
): Promise<T> {
  const lease = backends.lease({kind: 'repository', folder})
  try {
    return await action(await lease.current())
  } finally {
    lease.dispose()
  }
}

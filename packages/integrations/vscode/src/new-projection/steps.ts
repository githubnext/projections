import * as vscode from 'vscode'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {
  definitionDirectory,
  definitionPath,
  freeId,
  idProblem,
  initArguments,
  initFailure,
  languageItems,
  parseExtractors,
  parseRenderers,
} from '../new-projection-model.js'
import type {BuiltinExtractor, Language, Plan} from '../new-projection-model.js'
import {byTitle} from '../projections/definitions.js'
import {CliError, title} from './wizard.js'
import type {Wizard} from './wizard.js'

/** The built-in extractors (from the CLI) and renderers (from the backend). */
export async function builtins(wizard: Wizard, folder: vscode.WorkspaceFolder) {
  const [extractors, renderers] = await Promise.all([
    wizard.runCli(folder, ['extractor', 'list', '--json']).then(stdout => parseExtractors(JSON.parse(stdout))),
    wizard.host.withBackend(folder, async runner => {
      const response = await runner.request({method: 'GET', path: '/api/renderers'})
      if (response.status !== 200) throw new Error(`Could not list the built-in renderers (${response.status})`)
      return parseRenderers(response.body)
    }),
  ])
  return {extractors, renderers}
}

export async function pickExtractor(wizard: Wizard, extractors: BuiltinExtractor[], placeHolder: string) {
  return (
    await wizard.host.pick(
      byTitle(
        extractors,
        extractor => extractor.title,
        extractor => extractor.id,
      ).map(extractor => ({
        label: extractor.title,
        description: extractor.id,
        detail: `${extractor.description}${extractor.runsCode ? ' · Runs repository code' : ''}`,
        extractor,
      })),
      {title: `${title}: extractor`, placeHolder, matchOnDescription: true},
    )
  )?.extractor
}

export async function pickLanguage(wizard: Wizard, detect: boolean): Promise<{language: Language | undefined} | undefined> {
  const chosen = await wizard.host.pick(languageItems(detect), {
    title: `${title}: extractor language`,
    placeHolder: 'The language of the starter extractor you write',
  })
  return chosen && {language: chosen.language}
}

/** The repository's directory for definitions, and whether an ID is taken there or by a definition it loaded. */
export function repository(wizard: Wizard, folder: vscode.WorkspaceFolder) {
  const root = folder.uri.fsPath
  const directory = definitionDirectory({
    github: existsSync(join(root, '.github', 'projections')),
    dot: existsSync(join(root, '.projections')),
  })
  const model = wizard.host.model(folder)
  const taken = (id: string) =>
    model.definition(id) !== undefined ||
    model.invalidFor(id) !== undefined ||
    ['.github/projections', '.projections'].some(base => existsSync(join(root, ...base.split('/'), `${id}.json`))) ||
    existsSync(join(root, ...directory.split('/'), id))
  return {directory, taken}
}

/** Asks for the ID and title: `undefined` if the person cancels. */
export async function name(wizard: Wizard, folder: vscode.WorkspaceFolder, suggested: {id?: string; title?: string}) {
  const {taken} = repository(wizard, folder)
  const id = await wizard.input({
    title: `${title}: ID`,
    prompt: 'The projection ID: letters, digits, ".", "_" or "-". It names the definition file.',
    value: suggested.id ? freeId(suggested.id, taken) : '',
    placeholder: 'service-map',
    validate: value => idProblem(value, {pattern: wizard.idPattern(), taken}),
  })
  if (id === undefined) return undefined
  const chosen = await wizard.input({
    title: `${title}: title`,
    prompt: 'The title viewers see. Leave it empty to make one from the ID.',
    value: suggested.title ?? '',
  })
  return chosen === undefined ? undefined : {id, title: chosen}
}

/** Why `projections init` failed, with what to do: choose a language and create again, or open the existing definition. */
async function initFailed(
  wizard: Wizard,
  folder: vscode.WorkspaceFolder,
  plan: Plan,
  failure: unknown,
): Promise<{plan: Plan; output: string} | undefined> {
  const kind = failure instanceof CliError && !failure.missing ? initFailure(failure.message) : 'other'
  if (kind === 'language' && failure instanceof Error) {
    let retried: {plan: Plan; output: string} | undefined
    await wizard.error(failure.message, {
      title: 'Choose a Language…',
      run: async () => {
        const language = await pickLanguage(wizard, false)
        if (language) retried = await create(wizard, folder, {...plan, extractor: language})
      },
    })
    return retried
  }
  if (kind === 'exists' && failure instanceof Error) {
    const file = vscode.Uri.joinPath(folder.uri, ...definitionPath(plan).split('/'))
    await wizard.error(
      failure.message,
      ...(existsSync(file.fsPath) ? [{title: 'Open Definition', run: () => vscode.window.showTextDocument(file)}] : []),
    )
    return undefined
  }
  await wizard.showCliError(failure)
  return undefined
}

/** Writes the projection with `projections init`, then opens its definition and tab and selects its row. */
export async function create(
  wizard: Wizard,
  folder: vscode.WorkspaceFolder,
  plan: Plan,
): Promise<{plan: Plan; output: string} | undefined> {
  const {host} = wizard
  let output: string
  try {
    output = await vscode.window.withProgress(
      {location: vscode.ProgressLocation.Notification, title: `Projections: creating ${plan.title.trim() || plan.id}…`},
      () => wizard.runCli(folder, initArguments(plan)),
    )
  } catch (failure) {
    return initFailed(wizard, folder, plan, failure)
  }
  host.output.info(output.trim())
  const model = host.model(folder)
  await model.refresh()
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, ...definitionPath(plan).split('/')), {preview: false})
  await host.openProjection(folder.uri, plan.id, {preview: false})
  await host.reveal(folder, plan.id)
  void vscode.window
    .showInformationMessage(`Projections: created ${model.title(plan.id)} in ${definitionPath(plan)}.`, 'Show Next Steps')
    .then(choice => choice && host.output.show(true))
  return {plan, output}
}

/** Opens the chat in agent mode with the prompt, for the person to send; without a chat, copies it. */
export async function askAgent(prompt: string) {
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {query: prompt, mode: 'agent', isPartialQuery: true})
  } catch {
    await vscode.env.clipboard.writeText(prompt)
    void vscode.window.showInformationMessage('Projections: copied the prompt for your coding agent. Paste it into its chat.')
  }
}

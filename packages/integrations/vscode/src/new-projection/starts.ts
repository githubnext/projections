import type * as vscode from 'vscode'
import {agentPrompt, customItems, rendererChoices, writesExtractor} from '../new-projection-model.js'
import type {CustomParts, DefinitionDirectory, Plan} from '../new-projection-model.js'
import type {Candidate} from '../projections/definitions.js'
import {byTitle} from '../projections/definitions.js'
import {askAgent, builtins, create, name, pickExtractor, pickLanguage} from './steps.js'
import {title} from './wizard.js'
import type {Wizard} from './wizard.js'

/** Where a start writes: the folder and its definitions' directory. */
export interface Target {
  folder: vscode.WorkspaceFolder
  directory: DefinitionDirectory
}

/** From a suggestion: a built-in projection that applies here. */
export async function fromSuggestion(wizard: Wizard, {folder, directory}: Target, suggestions: readonly Candidate[]) {
  const chosen = await wizard.host.pick(
    suggestions.map(candidate => ({
      label: candidate.title,
      description: candidate.id,
      detail: `${candidate.description ?? ''}${candidate.requiresTrust ? ' · Runs repository code' : ''}`.replace(/^ · /u, ''),
      candidate,
    })),
    {title: `${title}: suggestion`, placeHolder: 'A built-in projection that applies here', matchOnDescription: true},
  )
  if (!chosen) return undefined
  const named = await name(wizard, folder, chosen.candidate)
  if (!named) return undefined
  const {candidate} = chosen
  const extractor = {builtin: candidate.extractor ?? candidate.id, ...(candidate.inputs ? {inputs: candidate.inputs} : {})}
  return (await create(wizard, folder, {...named, extractor, definitionDirectory: directory}))?.plan
}

/** From built-ins: an extractor, then a renderer that draws it (its default first). */
export async function fromBuiltins(wizard: Wizard, {folder, directory}: Target) {
  const {extractors, renderers} = await builtins(wizard, folder)
  const extractor = await pickExtractor(wizard, extractors, 'What the projection reads from the repository')
  if (!extractor) return undefined
  const renderer = (
    await wizard.host.pick(
      // The default first, then by title as every list here is.
      byTitle(
        rendererChoices(extractor, renderers),
        choice => choice.title,
        choice => choice.name,
      )
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
        .map(choice => ({
          label: choice.title,
          description: choice.name,
          ...(choice.isDefault ? {detail: `What ${extractor.title} uses by default`} : {}),
          renderer: choice,
        })),
      {title: `${title}: renderer`, placeHolder: `How to draw ${extractor.title}`, matchOnDescription: true},
    )
  )?.renderer
  if (!renderer) return undefined
  const named = await name(wizard, folder, {id: extractor.id, title: extractor.title})
  if (!named) return undefined
  return (
    await create(wizard, folder, {
      ...named,
      extractor: {builtin: extractor.id},
      // The default is what the extractor's template already names, as `projections init --extractor` writes it.
      ...(renderer.isDefault ? {} : {renderer: renderer.name}),
      definitionDirectory: directory,
    })
  )?.plan
}

/** From custom parts: the parts you write, and the extractor's language or the built-in extractor they work with. */
export async function fromCustomParts(wizard: Wizard, {folder, directory}: Target) {
  const parts: CustomParts | undefined = (
    await wizard.host.pick(customItems, {title: `${title}: custom parts`, placeHolder: 'The parts you write yourself'})
  )?.parts
  if (!parts) return undefined
  let extractor: Plan['extractor'] | undefined
  if (writesExtractor(parts)) extractor = await pickLanguage(wizard, true)
  else {
    const chosen = await pickExtractor(wizard, (await builtins(wizard, folder)).extractors, 'The built-in extractor your part works with')
    extractor = chosen && {builtin: chosen.id}
  }
  if (!extractor) return undefined
  const named = await name(wizard, folder, {})
  if (!named) return undefined
  return (
    await create(wizard, folder, {
      ...named,
      extractor,
      ...(parts === 'renderer' || parts === 'extractor-renderer' ? {renderer: 'custom'} : {}),
      ...(parts === 'comparator' ? {comparator: true} : {}),
      definitionDirectory: directory,
    })
  )?.plan
}

/** With an agent: what it should show, a starter projection, then a prompt for the person's coding agent. */
export async function withAgent(wizard: Wizard, {folder, directory}: Target, prompted: (prompt: string) => void) {
  const description = await wizard.input({
    title: `${title}: what it shows`,
    prompt: 'What should the projection show? Your coding agent builds it from this.',
    placeholder: 'the services and the queues between them',
    validate: value => (value ? undefined : 'Describe what the projection should show'),
  })
  if (!description) return undefined
  const named = await name(wizard, folder, {})
  if (!named) return undefined
  const created = await create(wizard, folder, {...named, extractor: {language: undefined}, definitionDirectory: directory})
  if (!created) return undefined
  const prompt = agentPrompt(created.output, description, created.plan.id)
  prompted(prompt)
  await askAgent(prompt)
  return created.plan
}

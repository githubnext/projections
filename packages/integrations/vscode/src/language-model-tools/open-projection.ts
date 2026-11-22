import type * as vscode from 'vscode'
import {isChoice} from '../choices/model.js'
import {resolveChoice, unavailableReason} from '../choices/resolve.js'
import type {PageView} from '../current-view/types.js'
import type {FolderModel} from '../folder-model.js'
import {ProjectionTab} from '../panels/projection-tab.js'
import {pairLabel, type Pair} from '../projections/pairs.js'
import type {Sidebar} from '../sidebar.js'
import {sleep, toolFolder} from './folders.js'
import type {ToolInput} from './types.js'

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** The choice or pair `open_projection` asks for, checked against the folder: a choice that doesn't apply is refused. */
function requested(input: ToolInput, model: FolderModel): {chosen?: {id: string}; pair?: Pair} {
  const before = text(input.before)
  const after = text(input.after) ?? (before ? 'working-tree' : undefined)
  const chosen = typeof input.choice === 'string' ? {id: input.choice} : undefined
  if (chosen && (before || after)) throw new Error('Give a choice or revisions, not both')
  if (chosen) {
    if (!isChoice(chosen)) {
      throw new Error(`${chosen.id} isn't a choice: use branch, uncommitted, last-commit, now, release or bookmark:<id>`)
    }
    const reason = unavailableReason(chosen, model.facts())
    if (reason) throw new Error(`${model.describe(chosen, undefined).name} doesn't apply here: ${reason}`)
  }
  const pair: Pair | undefined = after ? {...(before ? {before} : {}), after} : chosen ? resolveChoice(chosen, model.facts()) : undefined
  return {...(chosen ? {chosen} : {}), ...(pair ? {pair} : {})}
}

/** The projection's tab, once it has opened. */
async function openedTab(id: string, folder: vscode.WorkspaceFolder): Promise<ProjectionTab> {
  const deadline = Date.now() + 20_000
  let tab: ProjectionTab | undefined
  while (!(tab = [...ProjectionTab.tabs].reverse().find(item => item.projection === id && item.folder === folder))) {
    if (Date.now() > deadline) throw new Error(`The ${id} tab didn't open`)
    await sleep(100)
  }
  return tab
}

/** Sets a mode once the comparison is shown and its renderer's modes are known; whether it could. */
async function setMode(tab: ProjectionTab, mode: string): Promise<boolean> {
  for (const end = Date.now() + 15_000; Date.now() < end;) {
    const page = (await tab.control({op: 'currentView'}).catch(() => undefined)) as PageView | undefined
    if (page?.modes?.includes(mode)) {
      await tab.control({op: 'view', action: 'setMode', value: mode}).catch(() => undefined)
      return true
    }
    if (page?.status === 'ok' && page.modes && !page.modes.includes(mode)) return false
    await sleep(250)
  }
  return false
}

/** Selects an entity once the comparison, which loads after the tab, shows it; whether it could. */
async function selectEntity(tab: ProjectionTab, entity: string): Promise<boolean> {
  for (const end = Date.now() + 15_000; Date.now() < end;) {
    const selected = Boolean(await tab.control({op: 'selectEntity', entity}).catch(() => false))
    if (selected) return true
    await sleep(250)
  }
  return false
}

/** What `open_projection` did, in words. */
function openedText(
  tab: ProjectionTab,
  id: string,
  where: string,
  done: {scenario?: string; mode?: string; moded: boolean; entity?: string; selected: boolean},
): string {
  const {scenario, mode, moded, entity, selected} = done
  return `Opened ${tab.title} (${id}) in ${where}${scenario ? `, showing the scenario ${scenario}` : ''}${mode ? (moded ? `, in ${mode}` : `; its renderer doesn't offer ${mode}`) : ''}${
    entity ? (selected ? `, with ${entity} selected` : `; it doesn't show ${entity}, so nothing is selected`) : ''
  }.`
}

/**
 * `open_projection`: opens (or shows) a projection's tab on a choice or pair (pinned to the tab when asked, else the
 * folder's), then shows a scenario, sets a mode and selects an entity, saying which of those it could.
 */
export function openProjectionTool(
  sidebar: Sidebar,
  openProjection: (folder: vscode.Uri, id: string, options: {preview?: boolean}) => Promise<void>,
) {
  return async (input: ToolInput): Promise<string> => {
    const folder = toolFolder(input.folder)
    if (typeof input.projection !== 'string') {
      throw new Error('Name a projection: no projection tab is open to take it from (list_projections lists them)')
    }
    const id = input.projection
    const model = sidebar.model(folder)
    await model.load()
    if (!model.definition(id) && !model.invalidFor(id)) {
      throw new Error(`${folder.name} defines no projection ${id}; list_projections lists them`)
    }
    const {chosen, pair} = requested(input, model)
    const pin = input.pin === true
    if (chosen && !pin) model.choose(chosen)
    else if (pair && !pin) model.setPair(pair)
    await openProjection(folder.uri, id, {preview: false})
    const tab = await openedTab(id, folder)
    if (pair && pin) await tab.pinTo({...(chosen ?? model.identify(pair)), pair})
    const scenario = text(input.scenario)
    if (scenario) await tab.control({op: 'showScenario', scenario})
    const mode = text(input.mode)
    const moded = mode ? await setMode(tab, mode) : false
    const entity = text(input.entity)
    const selected = entity ? await selectEntity(tab, entity) : false
    const shown = tab.pinned?.pair ?? model.pair
    const where = `${folder.name}${shown ? ` on ${pairLabel(shown)}` : ''}${tab.pinned ? ', pinned to its tab' : ''}`
    return openedText(tab, id, where, {
      ...(scenario ? {scenario} : {}),
      ...(mode ? {mode} : {}),
      moded,
      ...(entity ? {entity} : {}),
      selected,
    })
  }
}

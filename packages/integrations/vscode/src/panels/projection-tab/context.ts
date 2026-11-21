// A projection tab's pin, as its page keeps it, and the context keys the projection editor's title actions read.
import * as vscode from 'vscode'
import {isChoice} from '../../choices/model.js'
import {resolveChoice} from '../../choices/resolve.js'
import type {Choice} from '../../choices/model.js'
import type {FolderModel} from '../../folder-model.js'
import {samePair} from '../../projections/pairs.js'
import type {Pair} from '../../projections/pairs.js'
import type {TabSummary} from '../../projections/rows.js'
import type {TabPair} from '../../protocol.js'

/** A pair's sides, as the page's messages carry them: Before (unless one revision) and After. */
export const pairFields = (pair: Pair): Pair => ({...(pair.before ? {before: pair.before} : {}), after: pair.after})

/** A pinned choice as a tab keeps it with its page's state. */
export function tabPair(pinned: Choice & {pair: Pair}, definitionRevision?: string): TabPair {
  return {
    ...pairFields(pinned.pair),
    ...(definitionRevision ? {definitionRevision} : {}),
    choice: pinned.id,
    ...(pinned.title ? {title: pinned.title} : {}),
  }
}

/** A tab's kept pin as a choice: the choice it names, else the one its pair is. */
export function pinnedChoice(model: FolderModel, kept: TabPair): Choice & {pair: Pair} {
  const pair = pairFields(kept)
  const named = {id: kept.choice ?? '', pair, ...(kept.title ? {title: kept.title} : {})}
  const choice = isChoice(named) ? (named.id === 'custom' || named.id.startsWith('pr:') ? named : {id: named.id}) : model.identify(pair)
  return {...choice, pair}
}

/**
 * A pinned tab keeps its own choice, resolved again as refs move (a custom pair or a pull request stays put): the
 * choice with the pair it moved to, or nothing when it didn't move.
 */
export function movedPin(pinned: (Choice & {pair: Pair}) | undefined, model: FolderModel): (Choice & {pair: Pair}) | undefined {
  const moved = pinned && resolveChoice(pinned, model.facts())
  return pinned && moved && !samePair(moved, pinned.pair) ? {...pinned, pair: moved} : undefined
}

/** The context keys the projection editor's title actions read: its mode, playback, view, changes only and pin. */
export async function setTabContext(tab: {last: TabSummary | undefined; pinned: unknown} | undefined) {
  const view = tab?.last?.view
  const comparing = Boolean(tab?.last?.pair?.before) && Boolean(view?.modes?.length)
  const entries: [string, unknown][] = [
    ['projections.tabMode', comparing ? (view?.mode ?? '') : ''],
    ['projections.tabPlaying', Boolean(view?.playing)],
    ['projections.tabShowAs', view?.showAs ?? ''],
    ['projections.tabChangesOnly', Boolean(view?.changesOnly)],
    ['projections.tabZoom', view?.showAs === 'renderer' && Boolean(view?.zoom?.includes('zoom-fit'))],
    ['projections.tabPinned', Boolean(tab?.pinned)],
  ]
  await Promise.all(entries.map(([key, value]) => vscode.commands.executeCommand('setContext', key, value)))
}

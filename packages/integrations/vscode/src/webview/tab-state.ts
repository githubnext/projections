// What a projection tab's page keeps: its state with VS Code's webview state (so a restored or re-shown tab comes back
// as it was), how it shows its projection, the latest switch of pair it applied, and what the extension says it showed.
import type {ViewKind} from '@githubnext/projections-host-vscode'
import {hostTag, restoreTag} from '../protocol.js'
import type {TabPair, TabRestore} from '../protocol.js'
import {fromExtension, post, vscode} from './host.js'

/** What a projection tab keeps with VS Code's webview state, so a restored or re-shown tab comes back as it was. */
interface TabState {
  pinned?: TabPair
  showAs?: ViewKind
  mode?: string
  changesOnly?: boolean
  selection?: string
  /**
   * Show committed: the edits (`editKey`) this tab shows the committed definition for, remembered across a window
   * reload while the edits are the same.
   */
  committed?: string
}
export const saved = ((vscode.getState() as TabState | undefined) ?? {}) satisfies TabState
export const tabState: TabState = {...saved}
export const keep = (patch: {[K in keyof TabState]?: TabState[K] | undefined}) => {
  Object.assign(tabState, patch)
  for (const key of Object.keys(patch) as (keyof TabState)[]) if (patch[key] === undefined) Reflect.deleteProperty(tabState, key)
  vscode.setState(tabState)
}

/** How a projection tab shows its projection (renderer, table or text), which the editor's `…` menu changes. */
export const showAs = (() => {
  let value: ViewKind | undefined = saved.showAs
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: ViewKind) => {
      value = next
      keep({showAs: next})
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})()

/** The extension's latest switch of pair this page applied (`ControlMessage`'s `generation`), which summaries name. */
let shownSwitch: number | undefined
export const appliedSwitch = () => shownSwitch
export const applySwitch = (generation: number) => {
  shownSwitch = generation
}

/** Asks the extension what the tab showed (`TabRestore`); nothing after a moment, as for a new tab. */
export function restore(): Promise<TabRestore | undefined> {
  return new Promise(resolve => {
    const stop = fromExtension(data => {
      const message = data as Partial<TabRestore> | null | undefined
      if (message?.tag !== restoreTag) return
      finish(message as TabRestore)
    })
    const timer = setTimeout(() => finish(undefined), 5000)
    function finish(restored: TabRestore | undefined) {
      clearTimeout(timer)
      stop()
      resolve(restored)
    }
    post({tag: hostTag, op: 'restore'})
  })
}

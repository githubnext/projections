// A projection tab's own toolbar: the projection view's toolbar, with what the tab shows at its start as one choice
// ("My branch · 3 commits + uncommitted", named by the extension) with Swap beside it (hidden on Now, which compares
// nothing), and Pin or Follow at its end. The choice opens the extension's quick pick; the toolbar's layout reflows it
// (name and detail, the name alone, or one button) as it narrows. An out-of-date result isn't a tool: the view draws
// "Out of date · 3 files changed · Refresh" as a pill floating over the stage (`TabStaleNotice`).
import {StageNotice} from '@githubnext/projections-host-vscode'
import type {PairForm} from '@githubnext/projections-host-vscode'
import {createElement as h, useSyncExternalStore} from 'react'
import {hostTag, pairTag} from '../protocol.js'
import type {HostMessage, TabPairLabels, TabSide} from '../protocol.js'

let labels: TabPairLabels | undefined
const listeners = new Set<() => void>()
const store = {
  get: () => labels,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/** The choice the tab shows (`TabChoice.id`: `pr:12`, `branch`…), once the extension has described it. */
export const shownChoice = () => labels?.choice.id

/**
 * The pair's revisions named for people, by ref, for the Inspector's panes, slider and
 * labels (`InspectorHost.revisionLabels`).
 */
let named: Record<string, string> | undefined
export const revisionLabels = {
  get: () => named,
  subscribe: store.subscribe,
}
const text = (side: TabSide) => (side.detail ? `${side.name} · ${side.detail}` : side.name)

/** Keeps the pair the extension describes; `listen` delivers the extension's messages. */
export function listenForPair(listen: (listener: (data: unknown) => void) => void) {
  let last = ''
  listen(data => {
    const message = data as Partial<TabPairLabels> | null | undefined
    if (message?.tag !== pairTag) return
    // The same description again changes nothing: the toolbar and the view aren't drawn again.
    const json = JSON.stringify(message)
    if (json === last) return
    last = json
    labels = message as TabPairLabels
    // Only sides the extension has described (with their subject, age or changes); until then the Inspector names them.
    // Names stay for revisions shown before, as a pair still presented while the next one extracts shows them.
    const next = {
      ...named,
      ...Object.fromEntries(
        [labels.before, labels.after]
          .filter((side): side is TabSide => Boolean(side?.ref && side.detail))
          .map(side => [side.ref, text(side)]),
      ),
    }
    if (JSON.stringify(next) !== JSON.stringify(named)) named = next
    for (const listener of listeners) listener()
  })
}

const style = `
.tp-pair{display:flex;align-items:center;gap:4px;min-width:0;margin:0;padding:0;border:0}
.tp-observed{display:flex;align-items:center;gap:4px;margin-left:4px;height:24px;color:var(--vscode-descriptionForeground);font-size:12px;white-space:nowrap}
.tp-provenance{flex:none;display:flex;align-items:center;gap:4px;margin-left:4px;color:var(--vscode-descriptionForeground);font-size:12px;white-space:nowrap}
.tp-edits{flex:none;display:flex;align-items:center;gap:4px;margin-left:4px;height:24px;color:var(--vscode-descriptionForeground);font-size:12px;white-space:nowrap}
.tp-refresh{border:0;background:none;padding:0 4px;height:20px;color:var(--vscode-textLink-foreground);font:inherit;cursor:pointer;border-radius:2px}
.tp-refresh:hover{text-decoration:underline}
.tp-refresh:focus-visible{outline:1px solid var(--vscode-focusBorder)}
`
let styled = false
function addStyle() {
  if (styled) return
  styled = true
  const element = document.createElement('style')
  element.textContent = style
  document.head.append(element)
}

const provenanceIcons: Record<string, string> = {
  'From CI': 'github-action',
  Imported: 'package',
  Approximate: 'info',
  Stale: 'history',
  Observed: 'pulse',
}

const post = (action: Extract<HostMessage, {op: 'pairAction'}>['action'], postMessage: (message: HostMessage) => void) =>
  postMessage({tag: hostTag, op: 'pairAction', action})

/**
 * The tab's notices, at the toolbar's start: your edits, an unusual provenance and an observation's time. What the tab
 * shows is the side bar's Show view's choice (and its pane headers), not a control here; the merged form has none.
 * Out of date is the stage's (`TabStaleNotice`).
 */
export function TabPairPicker({form, postMessage}: {form: PairForm; postMessage: (message: HostMessage) => void}) {
  addStyle()
  const pair = useSyncExternalStore(store.subscribe, store.get)
  if (!pair) return null
  const {choice} = pair
  if (form === 'merged') return h('div', {className: 'tp-pair', 'data-form': form, 'data-choice': choice.id})
  return h(
    'div',
    {className: 'tp-pair', 'data-form': form, 'data-choice': choice.id},
    // The definition's uncommitted edits apply ("Your edits", quiet), with one action: Show committed; or, after it, the
    // committed version with Use my edits.
    pair.edits ? h(EditsIndicator, {edits: pair.edits, postMessage}) : null,
    // Who observed the result, only when it is unusual (From CI, Imported, Approximate, Stale or Observed): quiet, a codicon and
    // muted text. An ordinary local result shows none; the Configuration view's Provenance names it.
    pair.provenance
      ? h(
          'span',
          {className: 'tp-provenance', 'data-provenance': pair.provenance.label, title: pair.provenance.title},
          h('span', {className: `codicon codicon-${provenanceIcons[pair.provenance.label] ?? 'info'}`, 'aria-hidden': true}),
          pair.provenance.label,
        )
      : null,
    // An observation (live data) says when it ran instead of whether it is out of date.
    pair.observed && !pair.stale
      ? h(
          'span',
          {className: 'tp-observed', title: pair.observed.title},
          h('span', {className: 'codicon codicon-pulse', 'aria-hidden': true}),
          h('span', null, `${pair.observed.text} ·`),
          h('button', {type: 'button', className: 'tp-refresh', onClick: () => post('refresh', postMessage)}, 'Refresh'),
        )
      : null,
  )
}

/**
 * D5: nothing refreshes on its own, so an out-of-date result says so, with Refresh: "Out of date · 3 files changed"
 * in a pill over the stage (the view's `stageNotice`), at its top centre, whatever the view and however it scrolls.
 */
export function TabStaleNotice({postMessage}: {postMessage: (message: HostMessage) => void}) {
  const pair = useSyncExternalStore(store.subscribe, store.get)
  const stale = pair?.stale
  if (!stale) return null
  return h(StageNotice, {
    label: stale.label,
    detail: stale.detail,
    title: stale.title,
    action: {label: 'Refresh', icon: 'refresh', onClick: () => post('refresh', postMessage)},
    data: {'data-notice': stale.text},
  })
}

/**
 * "Your edits · Show committed": the tab applies the definition's uncommitted edits (to both sides). Show committed
 * holds this tab on the committed definition until the edits change again: "Committed version · Use my edits".
 */
function EditsIndicator({edits, postMessage}: {edits: 'yours' | 'committed'; postMessage: (message: HostMessage) => void}) {
  const yours = edits === 'yours'
  return h(
    'span',
    {
      className: 'tp-edits',
      'data-edits': edits,
      title: yours
        ? "This tab applies the projection's uncommitted edits (its definition, or a file it declares) to both sides. Show committed shows the committed version until the edits change again."
        : 'This tab shows the committed version of the projection, not your uncommitted edits, until they change again. Use my edits applies them.',
    },
    h('span', {className: `codicon codicon-${yours ? 'edit' : 'git-commit'}`, 'aria-hidden': true}),
    h('span', null, `${yours ? 'Your edits' : 'Committed version'} ·`),
    h(
      'button',
      {type: 'button', className: 'tp-refresh', onClick: () => post(yours ? 'showCommitted' : 'useEdits', postMessage)},
      yours ? 'Show committed' : 'Use my edits',
    ),
  )
}

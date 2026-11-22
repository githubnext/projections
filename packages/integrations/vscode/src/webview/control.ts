// Commands from the extension (`projections.inspectorControl`), for tests and other extensions driving the page: each
// control operation runs on the Inspector's handle once it is ready, and its result (or why it failed) goes back.
import type {InspectorHandle} from '@githubnext/projections-inspector/mount'
import type {ViewKind} from '@githubnext/projections-host-vscode'
import {controlTag, hostTag} from '../protocol.js'
import type {ControlMessage} from '../protocol.js'
import {anchors, boxes, click, elements, press} from './driving.js'
import {fromExtension, post} from './host.js'
import {currentView} from './page-view.js'
import type {View} from './page-view.js'
import {probeReport} from './probe.js'
import {applySwitch, keep, showAs} from './tab-state.js'

type Op = ControlMessage['op']
type MessageOf<O extends Op> = Partial<Extract<ControlMessage, {op: O}>>
/** The Inspector's handle once it is shown (and, if `loaded`, the runner's definitions have loaded). */
type Ready = (loaded: boolean) => Promise<InspectorHandle>
type Operation<O extends Op> = (message: MessageOf<O>, ready: Ready) => unknown

const text = (value: unknown) => (value === undefined ? undefined : typeof value === 'string' ? value : JSON.stringify(value))

/** The editor's title actions on a projection tab's view: how it shows, its mode, playback, changes only and actions. */
function runViewAction(view: View | null | undefined, {action, value}: MessageOf<'view'>) {
  if (action === 'showAs') return void showAs.set(String(value) as ViewKind)
  if (!view) throw new Error('The projection is not shown yet')
  switch (action) {
    case 'setMode':
      view.setMode(String(value) as Parameters<View['setMode']>[0])
      return
    case 'togglePlayback':
      view.togglePlayback()
      return
    case 'changesOnly':
      view.setChangesOnly(Boolean(value))
      return
    case undefined:
      return
    case 'runAction':
      view.runAction(String(value))
  }
}

/**
 * The control operations by name. Pairs arrive in order (`setPair` and `pin` share their numbering); one superseded
 * while the Inspector was getting ready isn't shown on its way.
 */
function operations(): {[O in Op]: Operation<O>} {
  let pairGeneration = 0
  return {
    async selectProjection(message, ready) {
      ;(await ready(true)).selectProjection(String(message.projection))
    },
    async setPair(message, ready) {
      const generation = ++pairGeneration
      const inspector = await ready(true)
      if (generation !== pairGeneration) return
      if (typeof message.generation === 'number') applySwitch(message.generation)
      inspector.setPair({
        after: String(message.after),
        ...(message.before ? {before: message.before} : {}),
        ...(message.projection ? {projection: message.projection} : {}),
        ...(message.definitionRevision ? {definitionRevision: message.definitionRevision} : {}),
      })
    },
    async setDefinitionRevision(message, ready) {
      ;(await ready(true)).setDefinitionRevision(String(message.ref))
    },
    async showCommitted(message, ready) {
      keep({committed: message.key ?? undefined})
      ;(await ready(true)).setDefinitionRevision(message.key ? 'HEAD' : 'working-tree')
    },
    selectEntity: async (message, ready) => (await ready(true)).selectEntity(message.entity ?? null),
    summary: async (_message, ready) => (await ready(false)).summary(),
    currentView: async (_message, ready) => currentView(await ready(false)),
    async view(message, ready) {
      runViewAction((await ready(true)).view(), message)
    },
    anchors: async (_message, ready) => anchors(await ready(true)),
    probe: message => probeReport(Boolean(message.reset)),
    boxes: message => boxes(String(message.selector)),
    async refresh(_message, ready) {
      ;(await ready(true)).refresh()
    },
    async showScenario(message, ready) {
      ;(await ready(true)).showScenario(String(message.scenario))
    },
    async pin(message, ready) {
      const pair = message.pair
      keep({pinned: pair ?? undefined})
      const generation = ++pairGeneration
      if (!pair) return
      const inspector = await ready(true)
      if (generation !== pairGeneration) return
      if (typeof message.generation === 'number') applySwitch(message.generation)
      inspector.setPair({
        ...(pair.before ? {before: pair.before} : {}),
        after: pair.after,
        ...(pair.definitionRevision ? {definitionRevision: pair.definitionRevision} : {}),
      })
    },
    elements: message => elements(String(message.selector), message.attribute),
    press(message) {
      press(String(message.selector), text(message.text), String(message.key))
    },
    click(message) {
      click(String(message.selector), text(message.text))
    },
  }
}

/** Commands from the extension (`projections.inspectorControl`), for tests and other extensions driving the page. */
export function listenForControl(ready: Ready) {
  const operation = operations()
  fromExtension(async data => {
    const message = data as Partial<ControlMessage> | null | undefined
    if (message?.tag !== controlTag || typeof message.id !== 'number') return
    const id = message.id
    try {
      const op = message.op
      if (op === undefined || !Object.hasOwn(operation, op)) throw new Error('Unknown control')
      const result = await (operation[op] as Operation<Op>)(message, ready)
      post({tag: hostTag, op: 'controlResult', id, ...(result === undefined ? {} : {result})})
    } catch (error) {
      post({tag: hostTag, op: 'controlResult', id, error: error instanceof Error ? error.message : String(error)})
    }
  })
}

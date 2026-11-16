/*
 * The check probe. The Inspector's fixtures mode injects this script into
 * every renderer document it serves, so the checks can measure what the
 * renderer painted. The host connects with `{projectionsProbe: 0, type:
 * 'connect'}` and a transferred MessagePort; requests and replies travel only
 * on that port, never on the window the renderer protocol uses.
 */
import {
  affordanceFailures,
  clickBackground,
  clickEntity,
  clippedContent,
  contentTop,
  focusFailures,
  entityTexts,
  identifierFonts,
  entitySamples,
  hoveredEntities,
  horizontalOverflow,
  legends,
  opening,
  selectedEntities,
  ringFailures,
  ringFocusFailures,
  ringNeutral,
  settle,
  stageInsets,
  stageSurface,
  styleSystem,
  visibleEntities,
} from './measure.js'
import type {ProbeCall} from './types.js'

const calls: Record<ProbeCall, (args: unknown) => unknown> = {
  samples: () => entitySamples(),
  entities: () => visibleEntities(),
  affordances: () => affordanceFailures(document.body),
  overflow: () => horizontalOverflow(),
  legends: () => legends(),
  selected: () => selectedEntities(),
  hovered: () => hoveredEntities(),
  settle: () => settle(),
  click: args => clickEntity(String(args)),
  clickBackground: () => clickBackground(),
  clipping: () => clippedContent(),
  identifiers: () => identifierFonts(),
  statusText: () => entityTexts(),
  contentTop: () => contentTop(),
  opening: args => opening(document.body, Array.isArray(args) ? (args as string[]) : []),
  focus: args => focusFailures(String(args)),
  ringNeutral: args => ringNeutral(String(args)),
  rings: args => ringFailures(args as {id: string; state: 'hover' | 'selected' | 'focus'}),
  ringFocus: args => ringFocusFailures(String(args)),
  styles: () => styleSystem(),
  stageSurface: () => stageSurface(),
  stageInsets: () => stageInsets(),
  viewport: () => ({width: innerWidth, height: innerHeight}),
}

addEventListener('message', event => {
  const data = event.data as {projectionsProbe?: unknown; type?: unknown} | null
  if (event.source !== parent || !data || data.projectionsProbe !== 0 || data.type !== 'connect' || !event.ports[0]) return
  const port = event.ports[0]
  port.onmessage = async ({data: request}: MessageEvent<{id: number; call: ProbeCall; args?: unknown}>) => {
    try {
      const call = calls[request.call]
      if (!call) throw new Error(`Unknown probe call ${String(request.call)}`)
      port.postMessage({id: request.id, result: await call(request.args)})
    } catch (error) {
      port.postMessage({id: request.id, error: error instanceof Error ? error.message : String(error)})
    }
  }
  port.postMessage({id: 0, result: 'connected'})
})

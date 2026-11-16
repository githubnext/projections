// The Projections viewer as an MCP App: the viewer's page (`mountViewer`, as `projections view` serves it), shown by an
// MCP Apps host in its conversation, side panel or full screen. `projections mcp` serves this page as
// `ui://projections/viewer` and links `open_projection` to it; the page relays its requests to the viewer through
// the server (relay.ts), takes its assets from itself (assets.ts) and the host's theme (theme.ts). The agent drives
// the view; the person watches, plays, zooms and selects, and every view of the same viewer mirrors the others. A view
// shows the viewer its `open_projection` call named (`viewer`), else the default one.
import {relayRendererFrames} from '@githubnext/projections-inspector/mount'
import type {InspectorHost} from '@githubnext/projections-inspector/mount'
import {mountViewer} from '@githubnext/projections-inspector/viewer'
import type {MountedViewer} from '@githubnext/projections-inspector/viewer'
import {inlineAssets, readInlineAssets} from './assets.js'
import {expandButton} from './expand.js'
import {connect} from './host.js'
import type {Host, HostContext} from './host.js'
import {customRenderers, relayTransport, viewerOrigin} from './relay.js'
import {hostTheme} from './theme.js'

/** The view's height in the conversation, where the host lets the view choose it, up to its maximum. */
const inlineHeight = 600

/**
 * Lays the page out for where the host shows it: filling a container of fixed height (the side panel, full screen),
 * else at `inlineHeight` within the host's maximum, which it tells the host. Returns the height it chose.
 */
function layOut(host: Host, context: HostContext, last: {height?: number | undefined}) {
  const size = context.containerDimensions ?? {}
  const fixed = typeof size.height === 'number' && context.displayMode !== 'inline'
  const height = fixed ? undefined : Math.max(320, Math.min(inlineHeight, size.maxHeight ?? inlineHeight))
  const root = document.documentElement
  root.dataset.displayMode = context.displayMode ?? 'inline'
  root.style.height = height === undefined ? '100%' : `${height}px`
  if (height !== undefined && height !== last.height) host.notify('ui/notifications/size-changed', {height})
  last.height = height
}

async function main() {
  const host = await connect({name: 'projections-viewer', version: '1'}, {availableDisplayModes: ['inline', 'fullscreen']})
  const last: {height?: number | undefined} = {}
  layOut(host, host.context(), last)
  host.onContext(context => layOut(host, context, last))
  const transport = relayTransport(host)
  relayRendererFrames(`${viewerOrigin}/custom-renderers/`, customRenderers(host))
  const inspectorHost: InspectorHost = {
    theme: hostTheme(host),
    ...(host.capabilities.openLinks ? {openExternal: (url: string) => void host.request('ui/open-link', {url}).catch(() => {})} : {}),
  }
  const assets = await inlineAssets(readInlineAssets())
  const root = document.getElementById('root')!
  let viewer: MountedViewer | undefined
  let named: string | undefined
  const mount = () => {
    viewer?.unmount()
    root.replaceChildren()
    viewer = mountViewer(root, {
      transport,
      assets,
      host: inspectorHost,
      ...(named ? {viewer: named} : {}),
      headerEnd: expandButton(host),
      // Another viewer answers now (one started with --trust replaced the last): the view starts again on it.
      onReplaced: () => mount(),
    })
  }
  mount()
  // The call this view shows may name a viewer, heard once the host sends its arguments: the view starts again on it.
  host.onToolInput(args => {
    const next = typeof args.viewer === 'string' && args.viewer !== 'default' ? args.viewer : undefined
    if (next === named) return
    named = next
    mount()
  })
  host.onTeardown(() => viewer?.unmount())
}

void main().catch(error => {
  document.getElementById('root')!.textContent =
    `Could not start the Projections viewer: ${error instanceof Error ? error.message : String(error)}`
})

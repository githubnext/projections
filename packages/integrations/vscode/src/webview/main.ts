// The Inspector webview page: the mountable Inspector, bundled with the VS Code UI (one React instance), mounted with a
// message transport (the extension proxies to the runner) and VS Code host capabilities. The projection view is the
// VS Code UI's (`VscodeProjectionView`: VSCode Elements and codicons, themed from VS Code's `--vscode-*` variables), and
// the mount root is marked `data-host-ui="vscode"` so `inspector.css` draws the Inspector's shell in VS Code style.
import * as mount from '@githubnext/projections-inspector/mount'
import type {InspectorHandle, InspectorHost} from '@githubnext/projections-inspector/mount'
import {codiconTokens, LoadingStatus} from '@githubnext/projections-host-vscode'
import {hostTag, runnerOrigin} from '../protocol.js'
import {customRenderers, webviewAssets} from './assets.js'
import {listenForControl} from './control.js'
import {config, fromExtension, post, vscode} from './host.js'
import {replaceSkeleton, showFailure} from './page-states.js'
import {watchPage} from './probe.js'
import {reportTab} from './report.js'
import {listenForPair, revisionLabels} from './tab-pair.js'
import {restore, tabState} from './tab-state.js'
import {vscodeTheme} from './theme.js'
import {PanelProjectionView, TabProjectionView} from './views.js'

// The part icons at codicon weight, as the side bar's Definition tree draws them: the Inspector's Parts section draws
// `--projections-icon-<part>`.
for (const part of ['extractor', 'comparator', 'renderer'] as const) {
  document.documentElement.style.setProperty(`--projections-icon-${part}`, codiconTokens[`icon-${part}`])
}

// For tests, from the page's first paint (the `probe` control).
watchPage()

/** VS Code's host capabilities for the Inspector: opening files, Source Control, the clipboard, links, its agent, and its theme. */
function inspectorHost(): InspectorHost {
  return {
    openFile: (path, line, column) =>
      post({
        tag: hostTag,
        op: 'openFile',
        path,
        ...(line !== undefined && line !== 0 ? {line} : {}),
        ...(column !== undefined && column !== 0 ? {column} : {}),
      }),
    revealInScm: ref => post({tag: hostTag, op: 'revealInScm', ref}),
    copyText: async text => post({tag: hostTag, op: 'copyText', text}),
    openExternal: url => post({tag: hostTag, op: 'openExternal', url}),
    addToCi: () => post({tag: hostTag, op: 'addToCi'}),
    theme: vscodeTheme(),
    // A projection tab's pair, named as its pickers name it.
    ...(config.toolbar ? {revisionLabels} : {}),
  }
}

async function main() {
  if (config.toolbar) listenForPair(listener => void fromExtension(listener))
  const root = document.getElementById('root')!
  root.dataset.hostUi = 'vscode'
  // The Inspector's handle, which changes when an in-page link switches views; null on the Explore view.
  let current: InspectorHandle | null = null
  // Commands for the Inspector wait until it is shown and the runner's definitions have loaded.
  const handle = async (loaded: boolean) => {
    for (let waited = 0; waited < 30_000; waited += 100) {
      if (current && (!loaded || current.summary().projection)) return current
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('The Inspector is not shown')
  }
  listenForControl(handle)
  if (config.failure) {
    showFailure(root, config.failure)
    post({tag: hostTag, op: 'ready', ...(config.page === undefined ? {} : {page: config.page})})
    return
  }
  const transport = mount.createMessageTransport({
    post: message => vscode.postMessage(message),
    listen: fromExtension,
    origin: runnerOrigin,
    // The extension answers change subscriptions from the backend's notifications.
    subscriptions: true,
  })
  mount.relayRendererFrames(`${runnerOrigin}/custom-renderers/`, customRenderers())
  const target = root
  // A projection tab's page is dropped while the tab is hidden: it asks what it showed, and presents that again.
  const restored = config.projection ? await restore() : undefined
  const editsKey = restored?.editsKey ?? config.editsKey
  const definitionRevision =
    tabState.committed && tabState.committed === editsKey ? 'HEAD' : (restored?.definitionRevision ?? config.definitionRevision)
  const pair =
    restored?.pair ??
    tabState.pinned ??
    (config.after ? {...(config.before ? {before: config.before} : {}), after: config.after} : undefined)
  const host = inspectorHost()
  // The static page's progress bar (see `webviewHtml`) gives way to the Inspector's own loading state; a projection
  // tab's skeleton gives way part by part as the projection view draws its own.
  document.querySelector('.pj-boot')?.remove()
  replaceSkeleton()
  mount.mountInspector(target, {
    transport,
    host,
    assets: await webviewAssets(),
    view: config.view ?? 'inspect',
    viewLinksInPlace: !config.projection,
    projectionView: config.projection ? TabProjectionView : PanelProjectionView,
    // VS Code's progress: one thin bar at the top of the tab, after a short delay; never a ring that scales with a pane.
    loadingStatus: LoadingStatus,
    // VS Code's words for the Explore view's recent-changes grid (the UI never says "sweep").
    sweepLabels: {
      run: 'Check recent commits',
      again: 'Check again',
      running: 'Checking recent commits…',
      empty: 'This branch has no commits to check yet.',
    },
    onHandle: shown => (current = shown),
    // A projection tab presents its projection alone on its pinned pair or the folder's; the editor's tab, title
    // actions and side bar are its shell.
    ...(config.projection
      ? {
          initial: {
            projection: config.projection,
            ...(pair ? {...(pair.before ? {before: pair.before} : {}), after: pair.after} : {}),
          },
          ...(restored?.results ? {initialResults: restored.results} : {}),
          // The extension's choice (your edits while there are any), or the committed one when this tab showed it for
          // the same edits before the window reloaded.
          ...(definitionRevision ? {definitionRevision} : {}),
          chrome: 'none' as const,
          // Nothing extracts again on its own: the extension says when the result is out of date, and Refresh asks.
          // By tier, a renderer edit reloads the view and a comparator edit compares again.
          refresh: 'compare' as const,
        }
      : {}),
  })
  if (config.projection) reportTab(() => current)
  post({
    tag: hostTag,
    op: 'ready',
    ...(config.page === undefined ? {} : {page: config.page}),
    ...(config.projection
      ? {pinned: tabState.pinned ?? null, committed: tabState.committed && tabState.committed === editsKey ? tabState.committed : null}
      : {}),
  })
}

void main().catch(error => {
  document.getElementById('root')!.textContent = `Could not start the Inspector: ${error instanceof Error ? error.message : String(error)}`
})

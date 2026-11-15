// The mountable Inspector bundle (`mount.js` and `mount.css` in the client build) for hosts other than the web page:
// an editor webview or an app's side panel loads them and calls `mountInspector(element, {transport, host})`.
import '@githubnext/projections-host/ui.css'
import './styles.css'

export * from './mount.js'
export {mountViewer} from './viewer/mount.js'
export type {MountViewerOptions, MountedViewer} from './viewer/state.js'

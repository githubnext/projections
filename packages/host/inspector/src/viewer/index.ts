// The agent viewer's page for hosts that embed it (`@githubnext/projections-inspector/viewer`), such as an MCP Apps
// host's view: mount it with the host's transport, assets and theme.
export {mountViewer} from './mount.js'
export {applyAppTheme} from './theme.js'
export type {MountViewerOptions, MountedViewer, ViewerState} from './state.js'

// The projection views the page mounts in the Inspector: a projection tab's (with its own toolbar, or none) and the
// Inspector panel's, both the VS Code UI's projection view without full screen, which a webview can't enter.
import {VscodeProjectionView, type PairForm, type VscodeProjectionViewProps} from '@githubnext/projections-host-vscode'
import {createElement, useSyncExternalStore} from 'react'
import {config, post} from './host.js'
import {TabPairPicker, TabStaleNotice} from './tab-pair.js'
import {saved, showAs} from './tab-state.js'

/**
 * A projection tab's view: the VS Code UI's projection view without its toolbar, since the editor's title actions are
 * its controls. Showing it as another kind remounts it on that kind.
 */
export function TabProjectionView(props: VscodeProjectionViewProps) {
  const kind = useSyncExternalStore(showAs.subscribe, showAs.get)
  return createElement(VscodeProjectionView, {
    ...props,
    // A webview can't enter full screen (VS Code's frame doesn't allow it), so the button would only fill the tab.
    features: {...props.features, fullscreen: false},
    // The tab draws its own toolbar: what it shows (one choice) with Swap, the mode, playback and view controls.
    ...(config.toolbar
      ? {
          toolbar: true,
          toolbarStart: (_compact: boolean, form: PairForm) => createElement(TabPairPicker, {form, postMessage: post}),
          // Its start holds only notices: the switches lead the row, as in VS Code's own editor toolbars.
          centreModes: false,
          // Playback floats on the stage, and the panes' labels are chips on it.
          utilityArea: true,
          // D5: out of date is the result's state, not a tool: a pill over the stage rather than in the toolbar.
          stageNotice: createElement(TabStaleNotice, {postMessage: post}),
        }
      : {toolbar: false}),
    key: kind ?? 'default',
    ...(kind ? {initialView: kind} : {}),
    ...(saved.mode ? {initialMode: saved.mode as NonNullable<VscodeProjectionViewProps['initialMode']>} : {}),
  })
}

/** The Inspector panel's projection view, without full screen, which a webview can't enter. */
export function PanelProjectionView(props: VscodeProjectionViewProps) {
  return createElement(VscodeProjectionView, {...props, features: {...props.features, fullscreen: false}})
}

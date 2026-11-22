import type {RefObject} from 'react'
import {useFullscreen, type FullscreenState} from '@githubnext/projections-host'
import {ActionButton} from './elements.js'
import {uiCodicons} from './codicons.js'

/** The class the full-screen fallback puts on its target; pass it to `useFullscreen` to share one state among blocks. */
export const fullscreenFallbackClass = 'phv-fullscreen-fallback'

export const fallbackClass = fullscreenFallbackClass

export const noTarget: RefObject<HTMLElement | null> = {current: null}

/**
 * "Enter full screen"/"Exit full screen" for `target` (the core's `useFullscreen`). Pass `state` (one
 * `useFullscreen(target, {fallbackClass: fullscreenFallbackClass})` for the view) when the button can unmount while
 * full screen lasts, for example when a toolbar moves it into `MoreMenu`.
 */
export function FullscreenButton({target, state}: {target: RefObject<HTMLElement | null>; state?: FullscreenState | undefined}) {
  const own = useFullscreen(state ? noTarget : target, {fallbackClass})
  const {active, toggle} = state ?? own
  return (
    <ActionButton
      icon={active ? uiCodicons.exitFullscreen : uiCodicons.fullscreen}
      label={active ? 'Exit full screen' : 'Enter full screen'}
      className="phv-fullscreen"
      onClick={toggle}
      data-focus-id="fullscreen"
      data-icon={active ? 'screen-normal' : 'screen-full'}
    />
  )
}

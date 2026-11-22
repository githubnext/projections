import {use} from 'react'
import type {RefObject} from 'react'
import {Maximize2, Minimize2} from 'lucide-react'
import {useFullscreen} from '../fullscreen.js'
import type {FullscreenState} from '../fullscreen.js'
import {Button} from './components/button.js'
import {MoreContext} from './toolbar.js'

const fallbackClass = 'ph-fullscreen-fallback'

/**
 * Full screen for a view root (`useFullscreen` with the default UI's fallback class), to share one state among
 * `FullscreenButton`s, for example one in the row and one in a `MoreMenu` that unmounts when it closes.
 */
export function useViewFullscreen(target: RefObject<HTMLElement | null>): FullscreenState {
  return useFullscreen(target, {fallbackClass})
}

/**
 * Shows `target` (typically the view root) full screen with the Fullscreen API, or, where element full screen is
 * unavailable (iOS), as a fixed overlay over the page (`data-fullscreen="fallback"`). Escape exits. In a `MoreMenu`,
 * it closes the menu as it goes; pass the view's `fullscreen` state (`useViewFullscreen`) so the overlay outlives it.
 */
export function FullscreenButton({target, fullscreen}: {target: RefObject<HTMLElement | null>; fullscreen?: FullscreenState}) {
  const own = useFullscreen(target, {fallbackClass})
  const {active, toggle} = fullscreen ?? own
  const close = use(MoreContext)
  const label = active ? 'Exit full screen' : 'Enter full screen'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="ph-fullscreen pj:shrink-0 pj:text-muted-foreground pj:hover:text-foreground"
      aria-label={label}
      title={label}
      data-state={active ? 'on' : 'off'}
      onClick={() => {
        close?.()
        toggle()
      }}
    >
      {active ? <Minimize2 /> : <Maximize2 />}
    </Button>
  )
}

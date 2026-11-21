import type {ReactNode} from 'react'
import {LoadingStatus} from '../loading.js'
import type {PaneState} from '../pane.js'
import type {PaneKey} from '../projection.js'

/** A pane's default loading or failure state: `LoadingStatus` while loading, and plain, accessible text for a failure. */
export function DefaultStatus({pane, title, reducedMotion}: {pane: PaneState; title: string; reducedMotion: boolean}) {
  if (pane.status === 'loading') {
    return <LoadingStatus className="ph-pane-status" label={`Loading the ${title} renderer…`} reducedMotion={reducedMotion} />
  }
  if (pane.status === 'failed') {
    return (
      <div role="alert" className="ph-error ph-pane-status">
        <p>
          <strong>The {title} renderer stopped.</strong> {pane.message}
        </p>
      </div>
    )
  }
  if (pane.rendererErrors.length) {
    return (
      <div role="alert" className="ph-error ph-pane-status">
        The renderer reported a problem: {pane.rendererErrors.at(-1)}
      </div>
    )
  }
  return null
}

/**
 * The stage's status while both panes of side by side or swipe load: over the whole stage, centred on it, so it isn't
 * said twice, each centred in its own half (or half-revealed, in swipe).
 */
export function StageStatus({children}: {children: ReactNode}) {
  return (
    <div
      className="ph-stage-status"
      style={{position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', pointerEvents: 'none'}}
    >
      {children}
    </div>
  )
}

/** Whether both panes of side by side or swipe (`twoPanes`) are loading, which `StageStatus` then says once. */
export const bothPanesLoading = (panes: Readonly<Record<PaneKey, PaneState>>, twoPanes: boolean) =>
  twoPanes && panes.before.status === 'loading' && panes.after.status === 'loading'

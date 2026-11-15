import {LoadingStatus} from '../loading.js'
import type {PaneState} from '../pane.js'

/** A pane's default loading or failure state: `LoadingStatus` while loading, and plain, accessible text for a failure. */
export function DefaultStatus({pane, title, reducedMotion}: {pane: PaneState; title: string; reducedMotion: boolean}) {
  if (pane.status === 'loading')
    return <LoadingStatus className="ph-pane-status" label={`Loading the ${title} renderer…`} reducedMotion={reducedMotion} />
  if (pane.status === 'failed')
    return (
      <div role="alert" className="ph-error ph-pane-status">
        <p>
          <strong>The {title} renderer stopped.</strong> {pane.message}
        </p>
      </div>
    )
  if (pane.rendererErrors.length)
    return (
      <div role="alert" className="ph-error ph-pane-status">
        The renderer reported a problem: {pane.rendererErrors.at(-1)}
      </div>
    )
  return null
}

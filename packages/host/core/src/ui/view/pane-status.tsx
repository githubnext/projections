import {CircleAlert, TriangleAlert} from 'lucide-react'
import {LoadingStatus} from '../../loading.js'
import type {PaneState} from '../../pane.js'
import type {ViewKind} from '../blocks.js'
import {Alert, AlertDescription, AlertTitle} from '../components/alert.js'
import {Button} from '../components/button.js'

/**
 * A renderer pane's loading or failure state in the default view: loading (or the embedder's job it waits on), a stopped renderer (with the built-in views
 * that still present the subject, and a way to show one), or the problem a renderer reported.
 */
export function RendererPaneStatus({
  pane,
  rendererTitle,
  reducedMotion,
  views,
  comparing,
  running,
  onViewChange,
}: {
  pane: PaneState
  rendererTitle: string
  reducedMotion: boolean
  views: ViewKind[]
  comparing: boolean
  /** The embedder's job for the shown pair, which a loading pane names instead of the renderer. */
  running?: 'extracting' | 'comparing' | null | undefined
  onViewChange: (view: ViewKind) => void
}) {
  const recoverView = views.find(kind => kind !== 'renderer')
  return pane.status === 'loading' ? (
    <LoadingStatus
      label={running === 'extracting' ? 'Extracting…' : running === 'comparing' ? 'Comparing…' : `Loading the ${rendererTitle} renderer…`}
      reducedMotion={reducedMotion}
    />
  ) : pane.status === 'failed' ? (
    <Alert variant="destructive" className="ph-error pj:border-divider pj:bg-surface-raised">
      <CircleAlert className="pj:h-4 pj:w-4" />
      <AlertTitle>The {rendererTitle} renderer stopped.</AlertTitle>
      <AlertDescription className="pj:flex pj:flex-col pj:items-start pj:gap-2">
        <p className="pj:break-words">{pane.message}</p>
        {recoverView && (
          <p className="pj:text-foreground/80">
            The {views.filter(kind => kind !== 'renderer').join(' and ')} {views.length > 2 ? 'views still present' : 'view still presents'}{' '}
            this {comparing ? 'comparison' : 'extraction'}.
          </p>
        )}
        {recoverView && (
          <Button type="button" variant="outline" size="sm" className="pj:text-foreground" onClick={() => onViewChange(recoverView)}>
            Show {recoverView}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  ) : pane.rendererErrors.length ? (
    <Alert variant="destructive" className="ph-error pj:border-divider pj:bg-surface-raised">
      <TriangleAlert className="pj:h-4 pj:w-4" />
      <AlertDescription className="pj:break-words">
        The renderer reported a problem: {pane.rendererErrors.at(-1)} The table and text views remain available.
      </AlertDescription>
    </Alert>
  ) : null
}

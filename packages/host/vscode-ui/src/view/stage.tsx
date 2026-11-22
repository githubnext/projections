import {ProjectionStage} from '@githubnext/projections-host'
import type {PaneEdge, PaneState, ProjectionController, RendererEntry} from '@githubnext/projections-host'
import {Notice} from '../notice.js'
import {LoadingStatus} from '../loading.js'
import {Playback, handlePlaybackKey} from '../blocks.js'
import type {ViewKind} from '../blocks.js'
import {VscodeLegend} from '../views/legend.js'

/** Pane cards (side by side, swipe) take the box's divider edge: one border, drawn inside. */
const paneEdge: PaneEdge = {border: 'var(--borderWidth-thin) solid var(--phv-divider)', radius: '0'}
/** Renderer and host messages read as sentences. */
const sentence = (text: string | undefined) => (!text ? '' : /[.!?]$/u.test(text) ? text : `${text}.`)

interface PaneStatusProps {
  pane: PaneState
  renderer: RendererEntry
  reducedMotion: boolean
  /** `comparison` or `extraction`, as the failure notice names it. */
  term: string
  /** The built-in view a stopped renderer's notice offers to show instead. */
  recoverView: 'table' | 'text' | undefined
  setView: (view: ViewKind) => void
}

/** A pane's loading spinner, or its renderer's failure or last reported problem. */
function PaneStatus({pane, renderer, reducedMotion, term, recoverView, setView}: PaneStatusProps) {
  if (pane.status === 'loading') return <LoadingStatus label={`Loading ${renderer.title}…`} reducedMotion={reducedMotion} />
  if (pane.status === 'failed') {
    return (
      <div role="alert" className="phv-pane-status">
        <Notice
          severity="error"
          title={`The ${renderer.title} renderer stopped.`}
          {...(recoverView ? {actions: [{label: `Show ${recoverView}`, onClick: () => setView(recoverView)}]} : {})}
        >
          {sentence(pane.message)} The table and text views still present this {term}.
        </Notice>
      </div>
    )
  }
  return pane.rendererErrors.length ? (
    <div role="alert" className="phv-pane-status">
      <Notice severity="warning" title="The renderer reported a problem">
        {sentence(pane.rendererErrors.at(-1))} The table and text views remain available.
      </Notice>
    </div>
  ) : null
}

/** The renderer's box: the stage with its panes' statuses, and the legend as its footer band. */
export function RendererBox({
  projection: p,
  renderer,
  view,
  beforeLabel,
  afterLabel,
  fill,
  recoverView,
  setView,
  utilityArea = false,
  playback = false,
}: {
  projection: ProjectionController
  /** Playback in the stage's utility area, and chips for the panes' labels (`VscodeProjectionViewProps.utilityArea`). */
  utilityArea?: boolean
  /** Whether the view shows playback now (a comparison, in Animated, with the feature on): only then the area has it. */
  playback?: boolean
  renderer: RendererEntry
  view: ViewKind
  beforeLabel: string
  afterLabel: string
  fill: boolean
  recoverView: 'table' | 'text' | undefined
  setView: (view: ViewKind) => void
}) {
  const {comparing, mode} = p
  const term = comparing ? 'comparison' : 'extraction'
  return (
    <div className="phv-box" hidden={view !== 'renderer'} onKeyDown={event => handlePlaybackKey(event, p)}>
      <div className="phv-box-body" data-comparison-mode={comparing ? mode : undefined}>
        <ProjectionStage
          projection={p}
          labels={{before: beforeLabel, after: afterLabel}}
          hidden={view !== 'renderer'}
          fill={fill}
          legend={false}
          paneEdge={paneEdge}
          {...(utilityArea ? {paneLabels: 'chips' as const} : {})}
          {...(utilityArea && playback
            ? {
                utility: (
                  // As wide as it needs, up to 560px, and at most the stage less its insets and edge.
                  <div className="phv-utility-playback" style={{width: 'min(560px, calc(100vw - 26px))', padding: '4px 8px 4px 4px'}}>
                    <Playback projection={p} beforeLabel={beforeLabel} afterLabel={afterLabel} />
                  </div>
                ),
              }
            : {})}
          renderStatus={pane => (
            <PaneStatus
              pane={pane}
              renderer={renderer}
              reducedMotion={p.reducedMotion}
              term={term}
              recoverView={recoverView}
              setView={setView}
            />
          )}
        />
      </div>
      {/* The box's footer band, filling or not: a band never covers what the renderer draws at the stage's edge. */}
      {view === 'renderer' && <VscodeLegend legend={p.legend} tokens={p.theme.tokens} className="phv-legend-footer" />}
    </div>
  )
}

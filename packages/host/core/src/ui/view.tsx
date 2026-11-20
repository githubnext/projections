import {useImperativeHandle, useMemo, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {Info} from 'lucide-react'
import {useProjection} from '../projection.js'
import type {ProjectionController} from '../projection.js'
import {ProjectionStage} from '../stage.js'
import {TableView, TextView} from './views.js'
import {SummaryBar} from './summary-bar.js'
import {DetailCard} from './detail-card.js'
import {ComparatorLine, featureOn, offeredModes, rendererLabel, spaceTogglesPlayback, zoomGroup} from './blocks.js'
import type {ProjectionFeatures, ViewKind} from './blocks.js'
import {Alert, AlertDescription} from './components/alert.js'
import {Button} from './components/button.js'
import {ScopedRoot} from './components/scoped-root.js'
import {useColorMode} from './lib/color-mode.js'
import {shadcnRendererTokens} from './lib/tokens.js'
import {cn} from './lib/utils.js'
import {viewOptions} from './view/options.js'
import {RendererPaneStatus} from './view/pane-status.js'
import type {ProjectionViewProps} from './view/props.js'
import {ViewToolbar} from './view/toolbar.js'
import {ScopeNotice} from './scope-notice.js'
import {Notices} from './view/notices.js'

/** A notice under the toolbar: a band of the raised surface, edge to edge, ruled off below by a hairline. */
const band = 'pj:shrink-0 pj:rounded-none pj:border-0 pj:border-b pj:border-divider pj:bg-surface-raised pj:py-2'
/**
 * The default host UI: one consumer of the headless core (`useProjection`
 * and `ProjectionStage`), built with shadcn/ui components inside a scoped
 * root. Presents one extraction or a comparison through a sandboxed renderer,
 * with the host's own table and text views beside it, under one dense toolbar
 * row composed of the layer-2 blocks (`blocks.tsx`). It fills its container's
 * height by default. Renderer frames receive the matching Projector theme tokens.
 */
export function ProjectionView(props: ProjectionViewProps) {
  const colorMode = useColorMode(props.colorMode)
  const themeTokens = useMemo(() => ({...shadcnRendererTokens(colorMode), ...props.themeTokens}), [colorMode, props.themeTokens])
  const projection = useProjection(viewOptions(props, colorMode, themeTokens))
  useImperativeHandle(props.controllerRef, () => projection, [projection])
  return <DefaultView projection={projection} props={props} />
}

function DefaultView({projection: p, props}: {projection: ProjectionController; props: ProjectionViewProps}) {
  const {subject, comparing, renderer, mode} = p
  const features = props.features
  const on = (name: Exclude<keyof ProjectionFeatures, 'modes'>) => featureOn(features, name)
  const marks = useMemo(() => new Map(p.annotationMarks.map(mark => [mark.id, mark])), [p.annotationMarks])
  const beforeLabel = props.beforeLabel ?? 'Before'
  const afterLabel = props.afterLabel ?? 'After'
  const fill = props.fill !== false
  const root = useRef<HTMLDivElement>(null)
  const views: ViewKind[] = [
    ...(renderer ? ['renderer' as const] : []),
    ...(on('table') ? ['table' as const] : []),
    ...(on('text') ? ['text' as const] : []),
  ]
  if (!views.length) views.push('table')
  const initial = props.initialView && views.includes(props.initialView) ? props.initialView : views[0]!
  const [chosen, setView] = useState<ViewKind>(initial)
  const [shownRenderer, setShownRenderer] = useState(renderer)
  if (shownRenderer !== renderer) {
    setShownRenderer(renderer)
    if (renderer && !shownRenderer) setView('renderer')
  }
  const view = views.includes(chosen) ? chosen : views[0]!
  const active = view === 'renderer' && renderer ? rendererLabel(p) : view === 'table' ? 'Built-in table view' : 'Built-in text view'
  const modes = features?.modes === false ? [] : offeredModes(features)
  const showModes = view === 'renderer' && Boolean(renderer) && modes.length > 0
  // The table and text views present progress in every mode.
  const showPlayback = on('playback') && comparing && (mode === 'animated' || view !== 'renderer')
  const showZoom = on('zoom') && view === 'renderer' && p.controls.some(control => control.group === zoomGroup)
  // The varied toggle is the summary bar's, unless the view has none.
  const showVaried = comparing && ((p.variation?.within ?? 0) > 0 || (p.variation?.regenerated ?? 0) > 0) && !on('summary')
  const notices = p.notices.slice(props.rendererNotice ? 1 : 0)
  const workspace = useRef<HTMLDivElement>(null)
  const space = showPlayback ? spaceTogglesPlayback(p) : undefined
  return (
    <ScopedRoot
      ref={root}
      colorMode={p.colorMode}
      className={cn('ph', props.className)}
      style={p.themeStyle as CSSProperties}
      data-mode={subject.mode}
      data-view={view}
      data-progress={p.progress}
      data-position={p.position}
      data-steps={p.stepEnds.length}
      data-comparison-mode={comparing ? mode : undefined}
      data-renderer-status={p.rendererStatus}
      data-rendered-progress={mode === 'animated' ? (p.renderedProgress ?? '') : ''}
      data-fill={fill || undefined}
    >
      {on('title') && <h2 className="pj:sr-only">{p.projection.title}</h2>}
      {/*
        The toolbar is planned, never wrapped (toolbar-layout.ts): one row whose regions collapse in priority order,
        and with playback a second row, playback's alone, with a full-width slider. Start, mode and end keep their
        places in row 1 across plans, so they aren't remounted when playback comes and goes.
      */}
      <ViewToolbar
        projection={p}
        props={props}
        view={view}
        views={views}
        onViewChange={setView}
        root={root}
        modes={modes}
        showModes={showModes}
        showPlayback={showPlayback}
        showZoom={showZoom}
        showVaried={showVaried}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
        space={space}
      />
      {props.banner && <div className="ph-banner pj:shrink-0 pj:p-2">{props.banner}</div>}
      {/* About this projection shows these visibly; they stay mounted for assistive technology and embedders. */}
      <p className="ph-active pj:sr-only" aria-live="polite">
        Showing: <strong data-active-view={view}>{active}</strong>
      </p>
      {props.comparator && (
        <div className="ph-comparator pj:sr-only" data-comparator={props.comparator.id}>
          <ComparatorLine comparator={props.comparator} />
        </div>
      )}
      {props.rendererNotice && (
        <Alert role="status" className={cn('ph-notice', band)}>
          <Info className="pj:h-4 pj:w-4" />
          <AlertDescription>{props.rendererNotice}</AlertDescription>
        </Alert>
      )}
      {notices.length > 0 && (
        <Alert role={undefined} className={band}>
          <Info className="pj:h-4 pj:w-4" />
          <AlertDescription>
            <Notices notices={notices} />
          </AlertDescription>
        </Alert>
      )}
      {comparing && p.scope === 'changes' && p.scopeCounts.changes === 0 && on('changesOnly') && (
        // The icon labels the row of text and its 28px button: centred on that row, not pinned to a text line's top.
        <Alert role="status" className={cn('ph-no-changes', band, 'pj:*:[svg]:row-span-1 pj:*:[svg]:translate-y-0 pj:*:[svg]:self-center')}>
          <Info className="pj:h-4 pj:w-4" />
          <AlertDescription className="pj:flex pj:flex-wrap pj:items-center pj:gap-x-3 pj:gap-y-1">
            <span>No changes: both revisions present the same items.</span>
            <Button type="button" variant="outline" size="sm" className="pj:h-7" onClick={() => p.setScope('all')}>
              Show all
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {/* The detail card overlays the workspace (its containing block), so selecting never moves the stage. */}
      <div
        ref={workspace}
        className={cn(
          'ph-workspace pj:relative pj:flex pj:min-h-0 pj:min-w-0 pj:flex-col pj:gap-3 pj:text-foreground',
          fill && 'pj:flex-1',
        )}
      >
        <div className="ph-panel pj:flex pj:min-h-0 pj:min-w-0 pj:flex-1 pj:flex-col">
          {/* The stage's chrome takes focus when clicked, so Space there toggles playback like in the toolbar. */}
          {renderer && (
            <div
              className="ph-stage-box pj:flex pj:min-h-0 pj:min-w-0 pj:flex-1 pj:flex-col pj:focus-visible:outline-hidden"
              hidden={view !== 'renderer'}
              {...(space ? {tabIndex: -1, onKeyDown: space} : {})}
            >
              <ProjectionStage
                projection={p}
                hidden={view !== 'renderer'}
                labels={{before: beforeLabel, after: afterLabel}}
                fill={fill}
                renderStatus={pane => (
                  <RendererPaneStatus
                    pane={pane}
                    rendererTitle={renderer.title}
                    reducedMotion={p.reducedMotion}
                    views={views}
                    comparing={comparing}
                    running={props.running}
                    onViewChange={setView}
                  />
                )}
              />
            </div>
          )}
          {view === 'table' && (
            <div className={cn('ph-scroll pj:min-w-0 pj:bg-surface-canvas pj:p-3', fill && 'pj:min-h-0 pj:flex-1 pj:overflow-auto')}>
              <TableView
                subject={subject}
                rows={p.visibleRows}
                total={p.rows.length}
                progress={p.progress}
                selectedId={p.selectedId}
                onSelect={p.select}
                annotations={marks}
                onAnnotationActivate={p.activateAnnotation}
              />
            </div>
          )}
          {view === 'text' && (
            <div className={cn('ph-scroll pj:min-w-0 pj:bg-surface-canvas pj:p-3', fill && 'pj:min-h-0 pj:flex-1 pj:overflow-auto')}>
              <TextView
                subject={subject}
                rows={p.visibleRows}
                progress={p.progress}
                selectedId={p.selectedId}
                onSelect={p.select}
                annotations={marks}
                onAnnotationActivate={p.activateAnnotation}
                summary={on('summary') ? p.summary : undefined}
              />
            </div>
          )}
        </div>
        {/* Without the summary bar, which says what the scope hides, a pill over the stage says it. */}
        {on('changesOnly') && !on('summary') && <ScopeNotice projection={p} />}
        {props.details !== 'none' && (
          <DetailCard
            projection={p}
            container={workspace}
            view={root}
            onOpen={props.onOpen}
            evidenceLink={props.evidenceLink}
            beforeLabel={beforeLabel}
            afterLabel={afterLabel}
            renderDetails={props.renderDetails}
            annotations={on('annotations')}
          />
        )}
      </div>
      {on('summary') && <SummaryBar projection={p} />}
    </ScopedRoot>
  )
}

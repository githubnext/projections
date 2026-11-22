import {useImperativeHandle, useMemo, useRef, type CSSProperties} from 'react'
import {Info} from 'lucide-react'
import {useProjection, type ProjectionController} from '../projection.js'
import {ProjectionStage} from '../stage.js'
import {UpdatingChip} from './updating-chip.js'
import {stageUtility, useUtilityPlayback} from './view/utility.js'
import {StageFoot} from './view/stage-foot.js'
import {HostViews} from './view/host-views.js'
import {DetailCard} from './detail-card.js'
import {ComparatorLine, featureOn, spaceTogglesPlayback, type ProjectionFeatures} from './blocks.js'
import {useViewChoice} from '../view-choice.js'
import {viewControls, viewLabel, viewNotices} from '../view-model.js'
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
  const {views, view, setView} = useViewChoice(p, features, props.initialView)
  const active = viewLabel(p, view)
  const controls = viewControls(p, {features, view, ...(props.playbackInViews ? {playbackInViews: props.playbackInViews} : {})})
  const showPlayback = controls.playback
  const notices = viewNotices(p, Boolean(props.rendererNotice))
  const workspace = useRef<HTMLDivElement>(null)
  const space = showPlayback ? spaceTogglesPlayback(p) : undefined
  // With a utility area, playback floats over the stage (or the table or text view) instead of taking a toolbar row.
  const utility = props.utilityArea === true
  const {panel, floating, scrollTop, toolbarPlayback, paneLabels, rootStyle} = useUtilityPlayback({
    projection: p,
    utility,
    showPlayback,
    view,
    beforeLabel,
    afterLabel,
  })
  return (
    <ScopedRoot
      ref={root}
      colorMode={p.colorMode}
      className={cn('ph', props.className)}
      style={{...(p.themeStyle as CSSProperties), ...rootStyle}}
      data-mode={subject.mode}
      data-view={view}
      data-progress={p.progress}
      data-position={p.position}
      data-steps={p.stepEnds.length}
      data-comparison-mode={comparing ? mode : undefined}
      data-renderer-status={p.rendererStatus}
      data-rendered-progress={mode === 'animated' ? (p.renderedProgress ?? '') : ''}
      data-fill={fill || undefined}
      data-utility-area={utility || undefined}
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
        modes={controls.modes}
        showModes={controls.modeSwitch}
        showPlayback={toolbarPlayback}
        showZoom={controls.zoom}
        showVaried={controls.varied}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
        space={space}
      />
      {Boolean(props.banner) && <div className="ph-banner pj:shrink-0 pj:p-2">{props.banner}</div>}
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
        {/* Space toggles playback from the stage's chrome and from the floating playback over the table and text views. */}
        <div ref={panel} className="ph-panel pj:relative pj:flex pj:min-h-0 pj:min-w-0 pj:flex-1 pj:flex-col" onKeyDown={space}>
          {/* The stage's chrome takes focus when clicked, so Space there toggles playback like in the toolbar. */}
          {renderer && (
            <div
              className="ph-stage-box pj:flex pj:min-h-0 pj:min-w-0 pj:flex-1 pj:flex-col pj:focus-visible:outline-hidden"
              hidden={view !== 'renderer'}
              {...(space ? {tabIndex: -1} : {})}
            >
              <ProjectionStage
                projection={p}
                hidden={view !== 'renderer'}
                labels={{before: beforeLabel, after: afterLabel}}
                fill={fill}
                paneLabels={paneLabels}
                legend={false}
                foot={<StageFoot projection={p} summary={on('summary')} legend scope={on('changesOnly')} />}
                utility={view === 'renderer' ? stageUtility(props.utility, floating) : undefined}
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
          {view !== 'renderer' && (
            <HostViews
              projection={p}
              view={view}
              fill={fill}
              marks={marks}
              summary={on('summary')}
              scope={on('changesOnly')}
              floating={floating}
              scrollTop={scrollTop}
            />
          )}
        </div>
        <UpdatingChip projection={p} running={props.running} rendererShown={view === 'renderer'} />
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
    </ScopedRoot>
  )
}

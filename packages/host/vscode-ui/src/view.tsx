import {useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {useFullscreen, useProjection, useViewChoice, viewControls} from '@githubnext/projections-host'
import type {ProjectionController, ProjectionSelection} from '@githubnext/projections-host'
import {OverlayLayer} from './overlay/overlay.js'
import {StageNoticeSlot} from './stage-notice.js'
import {ScopeNotice} from './scope-switch.js'
import {fullscreenFallbackClass} from './blocks.js'
import {VscodeTableView} from './views/table.js'
import {VscodeTextView} from './views/text.js'
import {SummaryBar} from './summary-bar.js'
import {DetailCard} from './detail-card.js'
import {useVscodeTheme} from './theme/dom.js'
import {featureOn, projectionOptions} from './view/options.js'
import {RendererBox} from './view/stage.js'
import {ViewNotices} from './view/notices.js'
import {ViewToolbar} from './view/toolbar.js'
import type {VscodeProjectionViewProps} from './view/props.js'

/**
 * The VS Code UI for a projection: the headless core (`useProjection` and `ProjectionStage`) drawn with VS Code's own
 * controls (VSCode Elements and codicons). Renderer frames receive theme tokens resolved from VS Code's `--vscode-*`
 * variables, so they follow the person's color theme in a webview. Import `./styles.css`, link the codicon stylesheet
 * as `vscode-codicon-stylesheet`, and render it where VS Code's variables apply (a webview, or `VscodeThemeFrame`).
 */
export function VscodeProjectionView(props: VscodeProjectionViewProps) {
  const root = useRef<HTMLDivElement>(null)
  const vscode = useVscodeTheme(root)
  const onRowSelectionChange = props.onSelectionChange
  const onSelectionChange = useCallback(
    (selection: ProjectionSelection | null) => onRowSelectionChange?.(selection?.rowId ?? null, selection),
    [onRowSelectionChange],
  )
  const projection = useProjection(projectionOptions(props, vscode, onSelectionChange))
  useImperativeHandle(props.controllerRef, () => projection, [projection])
  return <VscodeView projection={projection} props={props} root={root} kind={vscode.kind} />
}

function VscodeView({
  projection: p,
  props,
  root,
  kind,
}: {
  projection: ProjectionController
  props: VscodeProjectionViewProps
  root: {current: HTMLDivElement | null}
  kind: string
}) {
  const {subject, comparing, renderer, mode} = p
  const features = props.features ?? {}
  const on = featureOn(features)
  const {views, view, setView, recoverView} = useViewChoice(p, features, props.initialView)
  const controls = viewControls(p, {features, view, ...(props.playbackInViews ? {playbackInViews: props.playbackInViews} : {})})
  // The modes the features offer that the renderer supports, in the renderer's order.
  const {modes} = controls
  const beforeLabel = props.beforeLabel ?? 'Before'
  const afterLabel = props.afterLabel ?? 'After'
  // One full-screen state for the view: its control moves between the toolbar and More as the layout collapses.
  const fullscreen = useFullscreen(root, {fallbackClass: fullscreenFallbackClass})
  // Overlays open inside the view, so they stay visible when it is full screen.
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)

  // A controlled mode the features don't offer falls back to the first offered.
  const setMode = p.setMode
  useEffect(() => {
    if (comparing && p.modesKnown && features.modes !== undefined && modes.length && !modes.includes(mode)) setMode(modes[0]!)
  }, [comparing, p.modesKnown, features.modes, modes, mode, setMode])

  const fill = props.fill !== false
  const annotated = on('annotations')
  const marks = useMemo(() => new Map(p.annotationMarks.map(mark => [mark.id, mark])), [p.annotationMarks])
  const markProps = annotated ? {marks, onAnnotationActivate: p.activateAnnotation} : {}
  const workspace = useRef<HTMLDivElement>(null)
  const labels = {beforeLabel, afterLabel}
  const rows = {subject, rows: p.visibleRows, progress: p.progress, selectedId: p.selectedId, onSelect: p.select, ...markProps}

  return (
    <div
      ref={root}
      className={`ph phv-root ${props.className ?? ''}`}
      style={p.themeStyle as CSSProperties}
      data-vscode-theme-kind={kind}
      data-host-ui="vscode"
      data-mode={subject.mode}
      data-view={view}
      data-progress={p.progress}
      data-position={p.position}
      data-steps={p.stepEnds.length}
      data-comparison-mode={comparing ? mode : undefined}
      data-renderer-status={p.rendererStatus}
      data-rendered-progress={mode === 'animated' ? (p.renderedProgress ?? '') : ''}
      data-fill={fill || undefined}
      data-toolbar={props.toolbar === false ? 'none' : undefined}
    >
      <div ref={setLayer} className="phv-layer" />
      <OverlayLayer value={layer}>
        {on('title') && <h2 className="phv-visually-hidden">{p.projection.title}</h2>}
        {props.toolbar !== false && (
          <ViewToolbar
            projection={p}
            props={props}
            features={features}
            modes={modes}
            view={view}
            views={views}
            setView={setView}
            root={root}
            fullscreen={fullscreen}
            {...labels}
          />
        )}
        <ViewNotices projection={p} props={props} view={view} />
        {/* The detail card overlays the workspace (its containing block), so selecting never moves the stage. */}
        <div ref={workspace} className="phv-workspace">
          <div className="phv-main">
            {renderer && (
              <RendererBox
                projection={p}
                renderer={renderer}
                view={view}
                {...labels}
                fill={fill}
                recoverView={recoverView}
                setView={setView}
                utilityArea={props.utilityArea === true}
                playback={controls.playback && mode === 'animated'}
              />
            )}
            {view === 'table' && <VscodeTableView {...rows} total={p.rows.length} />}
            {view === 'text' && <VscodeTextView {...rows} summary={on('summary') ? p.summary : undefined} />}
          </div>
          {/* Over the stage, not in its scrolling content: the workspace doesn't scroll, the view inside it does. */}
          {props.stageNotice ? <StageNoticeSlot>{props.stageNotice}</StageNoticeSlot> : null}
          {/* Without the summary bar, which says what the scope hides, a pill over the stage says it. */}
          {on('changesOnly') && !on('summary') && <ScopeNotice projection={p} />}
          {props.details !== 'none' && (
            <DetailCard
              projection={p}
              container={workspace}
              view={root}
              onOpen={props.onOpen}
              evidenceLink={props.evidenceLink}
              {...labels}
              renderDetails={props.renderDetails}
              annotations={annotated}
            />
          )}
        </div>
        {on('summary') && <SummaryBar projection={p} {...(props.running !== undefined ? {running: props.running} : {})} />}
      </OverlayLayer>
    </div>
  )
}

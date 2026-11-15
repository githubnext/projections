import {useCallback, useEffect, useMemo, useRef} from 'react'
import type {ComponentType, KeyboardEvent} from 'react'
import {interactionCapabilities} from '@githubnext/projections-renderer-sdk/interactions'
import {useRenderer} from '@githubnext/projections-renderer-sdk/react'
import {RendererBoundary} from '../components.js'
import {LegendContext} from '../legend-context.js'
import {useDocumentModel, useTimeline} from './document.js'
import {ContentAspect, FrameFill, FrameSizing, FrameViewport, PaintGate, StageInset, StageMaxHeight, stageInsetOf} from './frame.js'
import type {MountOptions, RendererProps} from './props.js'
import {
  useAspectReport,
  useDeclaredControls,
  useFrameFillReport,
  useLegendReport,
  usePaintAcknowledgement,
  useStepsReport,
} from './reports.js'
import {focusedIds, focusRequest} from '../../focus.js'
import {useHostFilter, useOpeningReveal} from './focus.js'
import {useSelection} from './selection.js'
import {useSummaryReport} from './summary.js'

/** Connects a kit renderer component to its host through the renderer frame protocol. */
export function KitRenderer({component: Renderer, options}: {component: ComponentType<RendererProps>; options: MountOptions}) {
  const interactive = options.interactions !== false
  const listeners = useRef(new Set<(id: string) => void>())
  const capabilities = {
    ...(interactive ? interactionCapabilities : {}),
    ...options.capabilities,
    ...(options.controls ? {controls: [...options.controls]} : {}),
  }
  const renderer = useRenderer({
    capabilities,
    ...(options.accepts ? {accepts: options.accepts} : {}),
    acknowledge: false,
    onAction: id => {
      for (const listener of listeners.current) listener(id)
    },
  })
  const onAction = useCallback((listener: (id: string) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])
  const {client, init, selection, selectionVersion} = renderer
  const {controls, declareControls} = useDeclaredControls(client, options.controls, renderer.options)
  const hold = usePaintAcknowledgement(client, init, renderer.progress)
  const root = useRef<HTMLDivElement>(null)
  const {filling, fill} = useFrameFillReport(client, root)
  const reportAspect = useAspectReport(client)
  const {selected, setSelection, onSelect} = useSelection(client, {selection, selectionVersion}, root, interactive)
  const onOpen = useCallback((path: string, line?: number) => client?.open(path, line), [client])
  const onError = useCallback((message: string) => client?.error(message), [client])
  const reportLegend = useLegendReport(client)
  const reportSteps = useStepsReport(client)
  const model = useDocumentModel(init)
  const declareNouns = useSummaryReport(client, init, options, onError, {
    model: model && model.init === init ? model.model : undefined,
    controls,
  })
  const pane = renderer.environment ? renderer.environment.pane : init?.pane
  const sizing = renderer.environment ? renderer.environment.sizing : init?.sizing
  const tokens = (renderer.environment ?? init)?.theme.tokens
  const stageInset = stageInsetOf(tokens)
  const stageMaxHeight = tokens?.['stage-max-height']
  const automatic = (options.steps ?? 'schedule') === 'schedule'
  const {comparing, diff, position, schedule, highlighting, emphasis} = useTimeline(
    init,
    model,
    {progress: renderer.progress, pane},
    automatic,
    reportSteps,
  )
  useEffect(() => {
    if (model?.model instanceof Error) onError(model.model.message)
  }, [model, onError])
  const filter = useHostFilter(client)
  const focus = useMemo(() => focusRequest(init, filter), [init, filter])
  const resolved = model && !(model.model instanceof Error) ? model.model : undefined
  const focused = useMemo(() => focusedIds(resolved, focus, diff), [resolved, focus, diff])
  useOpeningReveal(root, focused, resolved)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || selected === null) return
    if (event.target instanceof Element && event.target.closest('input, select, textarea')) return
    setSelection(null)
  }
  const content = () => {
    if (renderer.failure) return <Failure title="Renderer not connected" message={renderer.failure} />
    if (!init || !model) return <div className="pk-waiting" aria-busy="true" />
    if (model.model instanceof Error) return <Failure title="This comparison could not be presented" message={model.model.message} />
    return (
      <ContentAspect.Provider value={reportAspect}>
        <FrameFill.Provider value={fill}>
          <FrameSizing.Provider value={sizing}>
            <FrameViewport.Provider value={renderer.viewport}>
              <StageInset.Provider value={stageInset}>
                <StageMaxHeight.Provider value={stageMaxHeight}>
                  <PaintGate.Provider value={hold}>
                    <RendererBoundary resetKey={init} onError={onError}>
                      <LegendContext.Provider value={reportLegend}>
                        <Renderer
                          init={init}
                          model={model.model}
                          comparing={comparing}
                          diff={diff}
                          comparisonMode={init.mode === 'comparison' ? init.comparisonMode : undefined}
                          pane={pane}
                          focusRequest={focus}
                          progress={position.progress}
                          highlighting={highlighting}
                          emphasis={emphasis}
                          direction={position.direction}
                          schedule={schedule}
                          rendererName={init.projection.renderer}
                          selectedId={selected}
                          hoveredId={renderer.hovered}
                          onSelect={onSelect}
                          onOpen={onOpen}
                          reportSteps={reportSteps}
                          controls={controls}
                          declareControls={declareControls}
                          onAction={onAction}
                          reportLegend={reportLegend}
                          declareNouns={declareNouns}
                          options={renderer.options}
                          viewport={renderer.viewport}
                          reducedMotion={renderer.environment?.reducedMotion ?? init.reducedMotion}
                          locale={renderer.environment?.locale ?? init.locale}
                          colorMode={renderer.environment?.theme.colorMode ?? init.theme.colorMode}
                        />
                      </LegendContext.Provider>
                    </RendererBoundary>
                  </PaintGate.Provider>
                </StageMaxHeight.Provider>
              </StageInset.Provider>
            </FrameViewport.Provider>
          </FrameSizing.Provider>
        </FrameFill.Provider>
      </ContentAspect.Provider>
    )
  }
  return (
    <div
      ref={root}
      className="pk"
      data-renderer={options.name}
      data-fill={filling ? '' : undefined}
      data-mode={init?.mode}
      data-comparison-mode={diff ? 'diff' : undefined}
      data-progress={init ? position.progress : undefined}
      data-highlighting={init ? position.highlighting : undefined}
      data-reduced-motion={renderer.environment?.reducedMotion ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      {content()}
    </div>
  )
}

function Failure({title, message}: {title: string; message: string}) {
  return (
    <div role="alert" className="error-state">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  )
}

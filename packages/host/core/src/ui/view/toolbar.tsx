import {useRef, useState} from 'react'
import type {KeyboardEventHandler, RefObject} from 'react'
import type {ProjectionController} from '../../projection.js'
import type {ComparisonMode} from '../../modes.js'
import {
  FilterButton,
  FullscreenButton,
  InfoButton,
  ModeSwitch,
  Playback,
  SettingsMenu,
  ShowAsChip,
  Toolbar,
  ToolbarRow,
  RegeneratedToggle,
  ScopeSwitch,
  VariedToggle,
  ZoomControls,
  featureOn,
  hasSettings,
  useViewFullscreen,
} from '../blocks.js'
import type {ProjectionFeatures, ShowAsOptions, ViewKind} from '../blocks.js'
import {useToolbarLayout, type ToolbarAction} from '../toolbar-layout.js'
import {cn} from '../lib/utils.js'
import type {ProjectionViewProps} from './props.js'
import {ToolbarMore} from './toolbar-more.js'

/** The expanded filter field's width (`pj:w-56`) and the button it replaces. */
const filterFieldWidth = 224
const filterButtonWidth = 32

export interface ViewToolbarProps {
  projection: ProjectionController
  props: ProjectionViewProps
  view: ViewKind
  views: ViewKind[]
  onViewChange: (view: ViewKind) => void
  /** The whole view, which full screen shows. */
  root: RefObject<HTMLDivElement | null>
  /** The comparison modes the view offers. */
  modes: readonly ComparisonMode[]
  showModes: boolean
  showPlayback: boolean
  showZoom: boolean
  showVaried: boolean
  beforeLabel: string
  afterLabel: string
  /** Space toggles playback while the toolbar has focus. */
  space: KeyboardEventHandler | undefined
}

/**
 * The default view's toolbar. It is planned, never wrapped (toolbar-layout.ts): one row whose regions collapse in
 * priority order, or two rows, with playback and a full-width slider in the second.
 */
export function ViewToolbar({
  projection: p,
  props,
  view,
  views,
  onViewChange: setView,
  root,
  modes,
  showModes,
  showPlayback,
  showZoom,
  showVaried,
  beforeLabel,
  afterLabel,
  space,
}: ViewToolbarProps) {
  const {comparing, renderer, mode} = p
  const features = props.features
  const on = (name: Exclude<keyof ProjectionFeatures, 'modes'>) => featureOn(features, name)
  // The scope beside the mode: which part of the comparison, as the mode is how its revisions relate.
  const showScope = comparing && on('changesOnly')
  const row = useRef<HTMLDivElement>(null)
  const {plan, sliderMin, sliderFitMin} = useToolbarLayout(
    row,
    {
      pair: typeof props.toolbarStart === 'function',
      modes: (showModes && comparing && p.availableModes.filter(value => modes.includes(value)).length > 1) || showScope,
      playback: Boolean(showPlayback),
      actions: [
        ...(showVaried ? (['varied'] as const) : []),
        ...(showZoom ? (['zoom'] as const) : []),
        ...(on('info') ? (['info'] as const) : []),
        ...(on('fullscreen') ? (['fullscreen'] as const) : []),
        ...(on('search') ? (['filter'] as const) : []),
      ],
    },
    `${comparing}-${mode}-${view}-${views.join()}-${showPlayback}-${showZoom}-${p.controls.length}-${p.stepEnds.length > 0}-${Boolean(props.actions)}-${p.availableModes.join()}-${p.variation?.within ?? 0}-${p.variation?.regenerated ?? 0}-${showScope && p.scope}`,
  )
  // The filter expands in the row only when the row's flexible room (the spacer and the slider beyond its minimum) can
  // take the field, so opening it never makes the row re-plan and move the Filter block while it is in use.
  const filterFits = () => {
    const element = row.current
    if (!element || plan.rows !== 1) return false
    const width = (selector: string) => element.querySelector(selector)?.getBoundingClientRect().width ?? 0
    const spare = width('[data-fit-min="0"]') + Math.max(0, width('.ph-progress') - sliderMin)
    return spare >= filterFieldWidth - filterButtonWidth
  }
  const inMore = (action: ToolbarAction) => plan.more.includes(action)
  const hasMore = plan.more.length > 0 || (showPlayback && plan.playback === 'minimal')
  const start = typeof props.toolbarStart === 'function' ? props.toolbarStart(plan.pair !== 'full', plan.pair) : props.toolbarStart
  // Table and text are escape hatches: chosen under Settings' "Show as", and marked in the row by a chip that returns to the renderer.
  const showAs: ShowAsOptions = {view, views, onViewChange: setView, rendererTitle: renderer?.title}
  const chip = (
    <ShowAsChip
      view={view}
      rendererTitle={renderer?.title}
      onDismiss={renderer && views.includes('renderer') ? () => setView('renderer') : undefined}
    />
  )
  const settings = hasSettings(p, features, showAs) && <SettingsMenu projection={p} features={features} showAs={showAs} />
  const info = on('info') && <InfoButton projection={p} comparator={props.comparator} diagnostics={props.diagnostics} />
  const fullscreenState = useViewFullscreen(root)
  // The filter's open state outlives the toolbar's re-plans, which move the Filter block.
  const [filterOpen, setFilterOpen] = useState(false)
  const fullscreen = on('fullscreen') && <FullscreenButton target={root} fullscreen={fullscreenState} />
  const playback = showPlayback && (
    <div data-toolbar-region="playback" data-fit="row" className="ph-toolbar-playback pj:flex pj:min-w-0 pj:flex-1">
      <Playback
        projection={p}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
        always={view !== 'renderer'}
        compact={plan.playback === 'compact'}
        minimal={plan.playback === 'minimal'}
        sliderMin={sliderMin}
        sliderFitMin={sliderFitMin}
        className="pj:flex-1"
      />
    </div>
  )
  return (
    <Toolbar ref={row} rows onKeyDown={space} className={cn(plan.rows === 2 && 'ph-toolbar-two-rows')}>
      <ToolbarRow>
        {start && (
          <div data-toolbar-region="start" className="ph-toolbar-start pj:flex pj:min-w-0 pj:shrink-0">
            {start}
          </div>
        )}
        {(showModes || showScope) && (
          <div data-toolbar-region="mode" className="ph-toolbar-mode pj:flex pj:shrink-0 pj:items-center pj:gap-1.5 pj:empty:hidden">
            {showModes && <ModeSwitch projection={p} modes={modes} form={plan.mode} />}
            {/* A row short enough to fold the mode into a menu leaves the scope to Settings' "Show". */}
            {showScope && plan.mode !== 'menu' && <ScopeSwitch projection={p} />}
          </div>
        )}
        {showPlayback && plan.rows === 1 ? playback : <span aria-hidden="true" data-fit-min="0" className="pj:flex-1" />}
        <div data-toolbar-region="end" className="ph-toolbar-end pj:flex pj:shrink-0 pj:items-center pj:gap-1.5">
          {showVaried && !inMore('varied') && (
            <>
              <RegeneratedToggle projection={p} />
              <VariedToggle projection={p} />
            </>
          )}
          {chip}
          {showZoom && !inMore('zoom') && <ZoomControls projection={p} />}
          <div className="pj:flex pj:items-center pj:gap-0.5">
            {on('search') && !inMore('filter') && (
              <FilterButton
                projection={p}
                popover={plan.rows === 2}
                open={filterOpen}
                onOpenChange={setFilterOpen}
                canExpand={filterFits}
              />
            )}
            {settings}
            {!inMore('info') && info}
            {props.actions && <div className="ph-actions pj:flex pj:items-center pj:gap-1">{props.actions}</div>}
            {!inMore('fullscreen') && fullscreen}
            {hasMore && (
              <ToolbarMore
                projection={p}
                view={view}
                playback={showPlayback && plan.playback === 'minimal'}
                varied={showVaried && inMore('varied')}
                zoom={showZoom && inMore('zoom')}
                filter={on('search') && inMore('filter')}
                info={inMore('info') && info}
                fullscreen={inMore('fullscreen') && fullscreen}
              />
            )}
          </div>
        </div>
      </ToolbarRow>
      {showPlayback && plan.rows === 2 && <ToolbarRow className="ph-toolbar-playback-row pj:pr-1.5">{playback}</ToolbarRow>}
    </Toolbar>
  )
}

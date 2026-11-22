import {useRef} from 'react'
import {
  FilterButton,
  FullscreenButton,
  InfoButton,
  ModeSwitch,
  MoreMenu,
  Playback,
  SettingsMenu,
  ShowAsChip,
  Toolbar,
  RegeneratedToggle,
  VariedToggle,
  ZoomControls,
  handlePlaybackKey,
} from '../blocks.js'
import type {PairForm} from '../blocks.js'
import {toolbarGrid} from '../layout/grid.js'
import {ScopeSwitch} from '../scope-switch.js'
import {useToolbarLayout} from '../layout/use-toolbar-layout.js'
import type {ToolbarLayout} from '../layout/steps.js'
import {overflow, toolbarContent} from './toolbar-content.js'
import type {ViewToolbarProps} from './toolbar-content.js'

/** The pair picker's form as the default UI names it (`PairForm`): the layout's `compact` is its `short`. */
const pairForms: Record<ToolbarLayout['pickers'], PairForm> = {full: 'full', compact: 'short', merged: 'merged'}

/**
 * The view's toolbar: the start content (a pair picker), the mode switch, playback, and the actions, which move into
 * More one at a time as the toolbar runs short of room (`useToolbarLayout`).
 */
export function ViewToolbar(toolbarProps: ViewToolbarProps) {
  const {projection: p, props, features, modes, view, views, setView, root, fullscreen, beforeLabel, afterLabel} = toolbarProps
  const {on, showModeSwitch, showPlayback, showZoom, zoomControls, showVaried, collapsible} = toolbarContent(toolbarProps)
  // The scope beside the mode: which part of the comparison, as the mode is how its revisions relate.
  const showScope = p.comparing && on('changesOnly')
  const modeRegion = showModeSwitch || showScope
  const toolbar = useRef<HTMLDivElement>(null)
  const layout = useToolbarLayout(toolbar, {
    pickers: typeof props.toolbarStart === 'function',
    centre: props.centreModes ?? false,
    modes: modeRegion,
    playback: showPlayback,
    actions: collapsible,
    key: [
      views.join(),
      view,
      p.mode,
      zoomControls.map(control => `${control.id}:${control.type}`).join(),
      p.stepEnds.length > 0,
      beforeLabel,
      afterLabel,
      p.rendererStatus === 'failed',
      Boolean(props.actions),
      Boolean(props.toolbarStart),
      p.variation?.within ?? 0,
      p.variation?.regenerated ?? 0,
      showScope && p.scope,
    ].join('|'),
  })
  const {inMore, settingsFeatures, moreItems} = overflow(layout, zoomControls, features)
  // Table and text are escape hatches: "Show as" in Settings chooses them, and a chip in the row returns to the renderer.
  const showAs = {view, views, onViewChange: setView, rendererTitle: p.renderer?.title}
  const dismissChip = p.renderer && p.rendererStatus !== 'failed' ? () => setView('renderer') : undefined
  const start =
    typeof props.toolbarStart === 'function'
      ? props.toolbarStart(layout.pickers === 'merged', pairForms[layout.pickers])
      : props.toolbarStart

  return (
    <div className="phv-toolbar-wrap">
      <Toolbar
        ref={toolbar}
        layout={layout}
        style={toolbarGrid(layout, {start: Boolean(start), mode: modeRegion, playback: showPlayback})}
        onKeyDown={event => {
          handlePlaybackKey(event, p, showPlayback)
        }}
      >
        {Boolean(start) && <div className="phv-toolbar-start">{start}</div>}
        {modeRegion && (
          <div className="phv-toolbar-mode">
            {showModeSwitch && <ModeSwitch projection={p} modes={modes} variant={layout.modes} />}
            {/* A row short enough to fold the mode into a menu leaves the scope to Settings' "Show". */}
            {showScope && layout.modes !== 'menu' && <ScopeSwitch projection={p} />}
          </div>
        )}
        {showPlayback && (
          <Playback
            projection={p}
            beforeLabel={beforeLabel}
            afterLabel={afterLabel}
            ends={layout.sliderEnds}
            overflow={layout.playbackOverflow}
            always
          />
        )}
        <div className="phv-toolbar-end">
          {!inMore('varied') && showVaried && (
            <>
              <RegeneratedToggle projection={p} />
              <VariedToggle projection={p} />
            </>
          )}
          {!inMore('zoom') && showZoom && <ZoomControls projection={p} />}
          <ShowAsChip view={view} rendererTitle={p.renderer?.title} onDismiss={dismissChip} />
          {!inMore('filter') && on('search') && <FilterButton projection={p} />}
          <SettingsMenu projection={p} features={settingsFeatures} {...showAs} />
          {!inMore('info') && on('info') && <InfoButton projection={p} comparator={props.comparator} diagnostics={props.diagnostics} />}
          {!inMore('fullscreen') && on('fullscreen') && <FullscreenButton target={root} state={fullscreen} />}
          {moreItems.length > 0 && (
            <MoreMenu
              projection={p}
              features={features}
              items={moreItems}
              {...showAs}
              fullscreenTarget={root}
              fullscreenState={fullscreen}
              comparator={props.comparator}
              diagnostics={props.diagnostics}
            />
          )}
          {Boolean(props.actions) && <div className="phv-actions">{props.actions}</div>}
        </div>
      </Toolbar>
    </div>
  )
}

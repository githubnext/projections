import {useRef, useState} from 'react'
import type {CSSProperties, KeyboardEvent, ReactNode, Ref, RefObject} from 'react'
import {useFullscreen} from '@githubnext/projections-host'
import type {FullscreenState, ProjectionController} from '@githubnext/projections-host'
import type {Diagnostic} from '@githubnext/projections-schemas'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import {vscodeControlIcons} from './controls.js'
import {ActionButton} from './elements.js'
import {Menu} from './overlay/menu.js'
import type {MenuItem} from './overlay/menu-entry.js'
import {uiCodicons} from './codicons.js'
import type {ToolbarLayout} from './layout/steps.js'
import {on} from './features.js'
import type {ViewKind, VscodeProjectionFeatures} from './features.js'
import type {PopoverControl} from './toolbar-popover.js'
import {FilterButton, regeneratedLabel, variedLabel, zoomGroup} from './view-controls.js'
import {hasSettings, SettingsMenu} from './settings-menu.js'
import {InfoButton} from './about.js'
import {fallbackClass, noTarget} from './fullscreen-button.js'

/** What `MoreMenu` can hold. */
export type MoreMenuItem = 'steps' | 'varied' | 'zoom' | 'filter' | 'settings' | 'info' | 'fullscreen'

const allMoreItems: readonly MoreMenuItem[] = ['steps', 'varied', 'zoom', 'filter', 'settings', 'info', 'fullscreen']

/**
 * The toolbar's overflow: VS Code's "…" action (More Actions) whose menu holds, of `items` (default all), the previous
 * and next step, the varied count as a check item (`VariedToggle`), the renderer's zoom actions, Filter, Settings, About this projection and full screen. Filter,
 * Settings and About open from the More action. The prebuilt views pass the actions that moved there
 * (`ToolbarLayout`'s `moreActions`): Settings stays an action.
 */
export function MoreMenu({
  projection: p,
  features,
  view,
  views = [],
  onViewChange,
  rendererTitle,
  fullscreenTarget,
  fullscreenState,
  comparator,
  diagnostics,
  items = allMoreItems,
}: {
  projection: ProjectionController
  features?: VscodeProjectionFeatures | undefined
  /** What the menu holds (default all). */
  items?: readonly MoreMenuItem[]
  /** The view and the views "Show as" in Settings offers. */
  view?: ViewKind
  views?: readonly ViewKind[]
  onViewChange?: (view: ViewKind) => void
  rendererTitle?: string | undefined
  /** The element full screen shows; omit to leave full screen out. */
  fullscreenTarget?: RefObject<HTMLElement | null> | undefined
  /** Full screen's state, shared with a `FullscreenButton` (see there); by default the menu keeps its own. */
  fullscreenState?: FullscreenState | undefined
  comparator?: {id: string; digest: string} | undefined
  diagnostics?: readonly Diagnostic[] | undefined
}) {
  const anchor = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState(false)
  const [popover, setPopover] = useState<'filter' | 'settings' | 'info' | null>(null)
  const own = useFullscreen(fullscreenState ? noTarget : (fullscreenTarget ?? noTarget), {fallbackClass})
  const fullscreen = fullscreenState ?? own
  const control = (name: 'filter' | 'settings' | 'info'): PopoverControl => ({
    open: popover === name,
    onOpenChange: open => setPopover(open ? name : null),
    anchorRef: anchor,
  })
  const has = (item: MoreMenuItem) => items.includes(item)
  const zoom =
    has('zoom') &&
    on(features, 'zoom') &&
    on(features, 'rendererControls') &&
    (view ?? 'renderer') === 'renderer' &&
    p.rendererStatus !== 'failed'
      ? p.controls.filter(item => item.group === zoomGroup)
      : []
  // Actions alone become menu items; a zoom group with a slider or a choice stays together in Settings.
  const zoomActions = zoom.every(item => item.type === 'action') ? zoom : []
  const settingsFeatures = zoom.length && !zoomActions.length ? {...features, zoom: false} : features
  const steps = has('steps') && on(features, 'playback') && p.comparing && p.mode === 'animated' && p.stepEnds.length > 0
  const showAs = view && onViewChange && views.length > 1 ? {view, views, onViewChange, rendererTitle} : {}
  const filterActive = p.search.trim().length > 0
  const entries: MenuItem[] = [
    ...(steps
      ? [
          {
            id: 'previous-step',
            group: 'steps',
            label: 'Previous step',
            icon: uiCodicons.previousStep,
            disabled: p.previousStep === undefined,
            onSelect: p.stepBack,
          },
          {
            id: 'next-step',
            group: 'steps',
            label: 'Next step',
            icon: uiCodicons.nextStep,
            disabled: p.nextStep === undefined,
            onSelect: p.stepForward,
          },
        ]
      : []),
    ...(has('varied') && p.comparing && (p.variation?.regenerated ?? 0) > 0
      ? [
          {
            id: 'regenerated',
            group: 'variation',
            label: regeneratedLabel(p.variation!.regenerated),
            icon: uiCodicons.generated,
            checkbox: true,
            checked: p.regeneratedOnly,
            onSelect: () => p.setRegeneratedOnly(!p.regeneratedOnly),
          },
        ]
      : []),
    ...(has('varied') && p.comparing && (p.variation?.within ?? 0) > 0
      ? [
          {
            id: 'varied',
            group: 'variation',
            label: variedLabel(p.variation!.within),
            icon: uiCodicons.varied,
            checkbox: true,
            checked: p.variedOnly,
            onSelect: () => p.setVariedOnly(!p.variedOnly),
          },
        ]
      : []),
    ...zoomActions.map(item => ({
      id: item.id,
      group: 'zoom',
      label: item.label,
      icon: item.type === 'action' && item.icon ? vscodeControlIcons[item.icon] : undefined,
      onSelect: () => p.runAction(item.id),
    })),
    ...(has('filter') && on(features, 'search')
      ? [
          {
            id: 'filter',
            group: 'actions',
            label: 'Filter',
            icon: filterActive ? uiCodicons.filterActive : uiCodicons.filter,
            detail: filterActive ? 'Active' : undefined,
            onSelect: () => setPopover('filter'),
          },
        ]
      : []),
    ...(has('settings') && hasSettings(p, settingsFeatures, 'views' in showAs ? views : [])
      ? [{id: 'settings', group: 'actions', label: 'Settings', icon: uiCodicons.settings, onSelect: () => setPopover('settings')}]
      : []),
    ...(has('info') && on(features, 'info')
      ? [{id: 'info', group: 'actions', label: 'About this projection', icon: uiCodicons.info, onSelect: () => setPopover('info')}]
      : []),
    ...(has('fullscreen') && fullscreenTarget && on(features, 'fullscreen')
      ? [
          {
            id: 'fullscreen',
            group: 'actions',
            label: fullscreen.active ? 'Exit full screen' : 'Enter full screen',
            icon: fullscreen.active ? uiCodicons.exitFullscreen : uiCodicons.fullscreen,
            onSelect: fullscreen.toggle,
          },
        ]
      : []),
  ]
  return (
    <>
      <ActionButton
        ref={anchor as Ref<VscodeToolbarButton>}
        icon={uiCodicons.more}
        label="More"
        title="More Actions..."
        popup="menu"
        expanded={menu}
        className="phv-more-button"
        onClick={() => setMenu(!menu)}
        data-active={filterActive || undefined}
        data-focus-id="more"
        data-icon="ellipsis"
      />
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        anchor={anchor}
        label="More"
        items={entries}
        groupLabels={{steps: 'Steps', variation: 'Variation', zoom: 'Zoom'}}
      />
      {has('filter') && on(features, 'search') && <FilterButton projection={p} control={control('filter')} />}
      {has('settings') && <SettingsMenu projection={p} features={settingsFeatures} control={control('settings')} {...showAs} />}
      {has('info') && on(features, 'info') && (
        <InfoButton projection={p} comparator={comparator} diagnostics={diagnostics} control={control('info')} />
      )}
    </>
  )
}

/**
 * The prebuilt views' toolbar (VS Code's view title bar: 35px a row, action bar buttons): a labeled group. Without
 * `layout` its blocks share one line that never wraps; put trailing blocks in `.phv-toolbar-end`. With `layout` (from
 * `useToolbarLayout`) and `style` (from `toolbarGrid`) it is a grid of regions: `.phv-toolbar-start` (the picker),
 * `.phv-toolbar-mode`, the `Playback` group and `.phv-toolbar-end` (the actions), on one row or two planned rows. Pass
 * `onKeyDown={event => handlePlaybackKey(event, projection)}` for the Space shortcut.
 */
export function Toolbar({
  children,
  label = 'Projection toolbar',
  className,
  ref,
  layout,
  ...rest
}: {
  children: ReactNode
  label?: string
  className?: string
  ref?: Ref<HTMLDivElement>
  layout?: (Omit<ToolbarLayout, 'moreActions'> & Partial<Pick<ToolbarLayout, 'moreActions'>> & {step?: number}) | undefined
  style?: CSSProperties | undefined
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined
}) {
  const attributes = layout
    ? {
        'data-rows': layout.rows,
        'data-pickers': layout.pickers,
        'data-modes': layout.modes,
        'data-step': layout.step,
        'data-playback-overflow': layout.playbackOverflow || undefined,
        'data-actions-overflow': layout.actionsOverflow || undefined,
        'data-more-actions': layout.moreActions?.join(' ') || undefined,
      }
    : {}
  return (
    <div ref={ref} className={`phv-toolbar ${className ?? ''}`} role="group" aria-label={label} {...attributes} {...rest}>
      {children}
    </div>
  )
}

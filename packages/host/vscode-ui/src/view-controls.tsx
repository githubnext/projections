import {useId, useRef, useState} from 'react'
import {flushSync} from 'react-dom'
import type {RefObject} from 'react'
import {comparisonModes, rovingIndex, zoomControlGroup} from '@githubnext/projections-host'
import type {ComparisonMode, ProjectionController} from '@githubnext/projections-host'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import {VscodeRendererControl} from './controls.js'
import {ActionButton, VscTabHeader, VscTabs, VscTextfield, focusControl} from './elements.js'
import {Menu} from './overlay/menu.js'
import {modeCodicons, uiCodicons} from './codicons.js'
import type {ToolbarLayout} from './layout/steps.js'
import type {ViewKind} from './features.js'
import {ToolbarPopover} from './toolbar-popover.js'
import type {PopoverControl} from './toolbar-popover.js'

/** Each mode's codicon name (`data-icon`): none is a playback glyph. */
export const modeIconNames: Readonly<Record<ComparisonMode, string>> = modeCodicons

/**
 * The comparison mode, like the diff editor's inline and side by side toggles: one action bar button per mode (a
 * radio group: arrows move and choose, the checked one is in the tab order), or (`variant="menu"`, for crowded
 * toolbars) one action showing the current mode's codicon, named "Comparison mode: Animated", whose menu ("Comparison
 * mode") offers the modes. Hidden unless comparing with more than one mode.
 */
export function ModeSwitch({
  projection: p,
  modes = p.availableModes,
  variant = 'segmented',
}: {
  projection: ProjectionController
  modes?: readonly ComparisonMode[]
  variant?: ToolbarLayout['modes']
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<VscodeToolbarButton>(null)
  const group = useRef<HTMLDivElement>(null)
  // In the renderer's order: its first mode is its default.
  const options = p.availableModes
    .filter(value => modes.includes(value))
    .flatMap(value => comparisonModes.filter(option => option.value === value))
  if (!p.comparing || options.length < 2) return null
  if (variant === 'menu') {
    const current = options.find(option => option.value === p.mode) ?? options[0]!
    return (
      <>
        <ActionButton
          ref={button}
          icon={modeCodicons[current.value]}
          label={`Comparison mode: ${current.label}`}
          popup="menu"
          expanded={open}
          className="phv-mode-menu"
          onClick={() => setOpen(!open)}
          data-mode={current.value}
          data-icon={modeCodicons[current.value]}
          data-focus-id="mode"
        />
        <Menu
          open={open}
          onClose={() => setOpen(false)}
          anchor={button}
          placement="below-start"
          label="Comparison mode"
          items={options.map(option => ({
            id: option.value,
            label: option.label,
            icon: modeCodicons[option.value],
            checked: p.mode === option.value,
            onSelect: () => p.setMode(option.value),
            'data-mode': option.value,
          }))}
        />
      </>
    )
  }
  const index = Math.max(
    0,
    options.findIndex(option => option.value === p.mode),
  )
  const choose = (next: number) => {
    const option = options[(next + options.length) % options.length]!
    // Commit the choice first, so focus lands on the radio that is now checked (and in the tab order).
    flushSync(() => p.setMode(option.value))
    focusControl(group.current?.querySelector(`[data-mode="${option.value}"]`))
  }
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Comparison mode"
      className="phv-mode-switch"
      onKeyDown={event => {
        const next = rovingIndex(event.key, index, options.length)
        if (next === undefined) return
        event.preventDefault()
        choose(next)
      }}
    >
      {options.map((option, position) => (
        <ActionButton
          key={option.value}
          icon={modeCodicons[option.value]}
          label={option.label}
          checked={p.mode === option.value}
          tabIndex={position === index ? 0 : -1}
          onClick={() => p.setMode(option.value)}
          data-mode={option.value}
          data-icon={modeCodicons[option.value]}
          {...(position === index ? {'data-focus-id': 'mode'} : {})}
        />
      ))}
    </div>
  )
}

export const viewIcons: Record<ViewKind, string> = {renderer: uiCodicons.renderer, table: uiCodicons.table, text: uiCodicons.text}

/**
 * The renderer, table and text tabs: VSCode Elements' `vscode-tabs`, VS Code's panel tabs (arrow keys, Home and End
 * move between them). Pass `idPrefix` to label a panel: tabs are `<idPrefix>-tab-<view>` and control `<idPrefix>-panel`.
 */
export function ViewSwitch({
  view,
  onViewChange,
  views,
  rendererTitle,
  idPrefix,
}: {
  view: ViewKind
  onViewChange: (view: ViewKind) => void
  views: readonly ViewKind[]
  rendererTitle?: string | undefined
  idPrefix?: string
}) {
  const generated = useId()
  const prefix = idPrefix ?? generated
  return (
    <VscTabs
      aria-label="Presentation"
      className="phv-view-switch"
      selectedIndex={Math.max(0, views.indexOf(view))}
      onVscTabsSelect={event => {
        const next = views[event.detail.selectedIndex]
        if (next && next !== view) onViewChange(next)
      }}
    >
      {views.map(kind => (
        <VscTabHeader key={kind} slot="header" id={`${prefix}-tab-${kind}`} aria-controls={`${prefix}-panel`} data-view={kind}>
          <span className={`codicon codicon-${viewIcons[kind]} phv-view-icon`} aria-hidden="true" /> {viewName(kind, rendererTitle)}
        </VscTabHeader>
      ))}
    </VscTabs>
  )
}

/** A Filter action whose widget holds "Filter rows" (VS Code's find input) and the number of matching rows. */
export function FilterButton({projection: p, control}: {projection: ProjectionController; control?: PopoverControl}) {
  const input = useRef<HTMLElement>(null)
  const active = p.search.trim().length > 0
  return (
    <ToolbarPopover
      icon={active ? uiCodicons.filterActive : uiCodicons.filter}
      label="Filter"
      title="Filter"
      className="phv-filter"
      active={active}
      initialFocus={input}
      control={control}
      focusId="filter"
    >
      <VscTextfield
        ref={input as RefObject<never>}
        type="search"
        label="Filter rows"
        aria-label="Filter rows"
        placeholder="Filter entities and relationships"
        value={p.search}
        onInput={event => p.setSearch((event.target as HTMLInputElement).value)}
        className="phv-filter-input"
      >
        <span slot="content-before" className="codicon codicon-search" aria-hidden="true" />
      </VscTextfield>
      <p role="status" className="phv-muted phv-popover-note">
        {active
          ? `${p.visibleRows.length.toLocaleString()} of ${p.rows.length.toLocaleString()} rows match`
          : `${p.rows.length.toLocaleString()} rows`}
      </p>
    </ToolbarPopover>
  )
}

/** The control group a toolbar draws as `ZoomControls` (the kit's `graphCanvasControls`: zoom out, fit, zoom in). */
export const zoomGroup = zoomControlGroup

/** A view's name: the renderer's title ("Renderer" without one), "Table" or "Text". */
export function viewName(kind: ViewKind, rendererTitle: string | undefined) {
  return kind === 'renderer' ? (rendererTitle ?? 'Renderer') : kind === 'table' ? 'Table' : 'Text'
}

/** How a view is shown: the renderer, or one of the built-in table and text views ("escape hatches"). */
export interface ShowAsProps {
  view: ViewKind
  /** The views offered, renderer first; "Show as" needs two. */
  views: readonly ViewKind[]
  onViewChange: (view: ViewKind) => void
  rendererTitle?: string | undefined
}

/**
 * While the table or text view replaces the renderer, a compact chip says so ("Table ×"): one click (`onDismiss`)
 * returns to the renderer, and it is named for that, for example "Showing table; show the Basic renderer". Without
 * `onDismiss` (no renderer, or it stopped) it is a plain label, "Showing table". Renders nothing for the renderer view.
 */
export function ShowAsChip({
  view,
  rendererTitle,
  onDismiss,
}: {
  view: ViewKind
  rendererTitle?: string | undefined
  onDismiss?: (() => void) | undefined
}) {
  if (view === 'renderer') return null
  const name = viewName(view, rendererTitle)
  const content = (
    <>
      <span className={`codicon codicon-${viewIcons[view]} phv-chip-icon`} aria-hidden="true" />
      <span className="phv-chip-text phv-cap">{name}</span>
    </>
  )
  if (!onDismiss) {
    return (
      <span className="phv-chip" data-view={view}>
        <span className="phv-visually-hidden">Showing </span>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="phv-chip"
      data-view={view}
      data-dismissible=""
      onClick={onDismiss}
      aria-label={`Showing ${name.toLowerCase()}; show the ${rendererTitle ?? 'default'} renderer`}
      title={`Show the ${rendererTitle ?? 'default'} renderer`}
    >
      {content}
      <span className="codicon codicon-close phv-chip-dismiss" aria-hidden="true" />
    </button>
  )
}

export const variedLabel = (within: number) => `${within.toLocaleString()} varied within tolerance`
export const regeneratedLabel = (regenerated: number) => `${regenerated.toLocaleString()} regenerated`

/**
 * The count of items that varied within tolerance ("3 varied within tolerance", from `variation.within`), as a toggle
 * that shows only those items (the Noise scope); pressed again, every item returns. Neutral (VS
 * Code's description foreground and toggle colors), never a change color: these items are unchanged. Renders nothing
 * when nothing varied within tolerance.
 */
export function VariedToggle({projection: p}: {projection: ProjectionController}) {
  const within = p.variation?.within ?? 0
  if (!p.comparing || within === 0) return null
  return (
    <button
      type="button"
      className="phv-varied-toggle"
      aria-pressed={p.variedOnly}
      title={p.variedOnly ? 'Show every item' : 'Show only the items that varied within tolerance'}
      data-varied-within={within}
      data-focus-id="varied"
      onClick={() => p.setVariedOnly(!p.variedOnly)}
    >
      <span className={`codicon codicon-${uiCodicons.varied}`} aria-hidden="true" />
      <span className="phv-varied-text phv-cap">{variedLabel(within)}</span>
    </button>
  )
}

/**
 * The count of items whose generated values were regenerated from the same inputs ("4 regenerated", from
 * `variation.regenerated`), as a toggle that shows only those items, like `VariedToggle`. Renders nothing when nothing
 * was regenerated.
 */
export function RegeneratedToggle({projection: p}: {projection: ProjectionController}) {
  const regenerated = p.variation?.regenerated ?? 0
  if (!p.comparing || regenerated === 0) return null
  return (
    <button
      type="button"
      className="phv-varied-toggle phv-regenerated-toggle"
      aria-pressed={p.regeneratedOnly}
      title={p.regeneratedOnly ? 'Show every item' : 'Show only the items whose generated values were regenerated from the same inputs'}
      data-regenerated={regenerated}
      data-focus-id="regenerated"
      onClick={() => p.setRegeneratedOnly(!p.regeneratedOnly)}
    >
      <span className={`codicon codicon-${uiCodicons.generated}`} aria-hidden="true" />
      <span className="phv-varied-text phv-cap">{regeneratedLabel(regenerated)}</span>
    </button>
  )
}

/**
 * The renderer's declared `zoom` controls as action bar buttons (a range stays a compact slider). Renders nothing when
 * the renderer declares none or has stopped.
 */
export function ZoomControls({projection: p}: {projection: ProjectionController}) {
  const controls = p.controls.filter(control => control.group === zoomGroup)
  if (!controls.length || p.rendererStatus === 'failed') return null
  return (
    <div className="phv-zoom" role="group" aria-label="Zoom">
      {controls.map(control => (
        <VscodeRendererControl key={control.id} control={control} projection={p} compact />
      ))}
    </div>
  )
}

import {useContext, useId, useRef, useState} from 'react'
import type {KeyboardEvent, MouseEvent} from 'react'
import {
  Activity,
  Sparkle,
  Check,
  ChevronDown,
  Clapperboard,
  Columns2,
  Diff,
  FileText,
  Network,
  SquareSplitHorizontal,
  Table2,
  X,
} from 'lucide-react'
import {comparisonModes} from '../modes.js'
import type {ComparisonMode} from '../modes.js'
import {zoomControlGroup} from '../settings.js'
import type {ProjectionController} from '../projection.js'
import {RendererControl} from './controls.js'
import {Button} from './components/button.js'
import {SegmentedControl, SegmentedControlItem} from './components/segmented-control.js'
import {cn} from './lib/utils.js'
import type {ViewKind} from '../view-model.js'
import {rovingIndex} from '../keyboard.js'
import {ToolbarPopover} from './toolbar-popover.js'
import {closeOn, MoreContext} from './toolbar.js'

/**
 * The comparison modes' icons. None looks like a playback glyph (no triangles or paired bars): Animated is a
 * clapperboard, not a play button, so the mode switch never reads as the control that plays the comparison.
 */
export const modeIcons: Record<ComparisonMode, {icon: typeof Clapperboard; name: string}> = {
  animated: {icon: Clapperboard, name: 'clapperboard'},
  'side-by-side': {icon: Columns2, name: 'columns-2'},
  swipe: {icon: SquareSplitHorizontal, name: 'square-split-horizontal'},
  diff: {icon: Diff, name: 'diff'},
}

/** How a `ModeSwitch` draws: icons and labels, icons with the labels as tooltips, or one dropdown button. */
export type ModeForm = 'labels' | 'icons' | 'menu'

/**
 * The "Comparison mode" radio group (arrow keys select): the renderer's `availableModes`, in its order, filtered by
 * `modes`. `form` `labels` draws icons and labels; `icons` (or `compact`) icons with the labels as tooltips and
 * accessible names; `menu` (or the `menu` flag) one dropdown button ("Comparison mode: Animated", with the mode's icon) whose
 * popover holds the labeled radio group; choosing a mode closes it. Hidden unless comparing with more than one mode.
 */
export function ModeSwitch({
  projection: p,
  modes = p.availableModes,
  form,
  compact = false,
  menu = false,
}: {
  projection: ProjectionController
  modes?: readonly ComparisonMode[]
  form?: ModeForm | undefined
  compact?: boolean
  menu?: boolean
}) {
  const shape = form ?? (menu ? 'menu' : compact ? 'icons' : 'labels')
  const [open, setOpen] = useState(false)
  const arrowing = useRef(false)
  const options = p.availableModes
    .filter(value => modes.includes(value))
    .flatMap(value => comparisonModes.filter(option => option.value === value))
  if (!p.comparing || options.length < 2) return null
  const group = (vertical: boolean) => (
    <SegmentedControl
      aria-label="Comparison mode"
      value={p.mode}
      onValueChange={value => p.setMode(value as ComparisonMode)}
      // In the menu the group is the menu's list: no well of its own, so it doesn't read as a box inside the popover.
      className={cn(
        'ph-mode pj:shrink-0',
        vertical && 'pj:h-auto pj:w-full pj:flex-col pj:items-stretch pj:border-0 pj:bg-transparent pj:p-0',
      )}
    >
      {options.map(option => {
        const {icon: Icon, name} = modeIcons[option.value]
        return (
          <SegmentedControlItem
            key={option.value}
            value={option.value}
            data-mode={option.value}
            title={option.label}
            className={cn(
              'pj:gap-1.5 pj:px-2 pj:[&_svg]:size-4 pj:[&_svg]:shrink-0',
              vertical &&
                'pj:h-8 pj:justify-start pj:font-normal pj:text-foreground pj:hover:bg-accent pj:data-[state=checked]:bg-accent pj:data-[state=checked]:shadow-none',
            )}
          >
            <Icon aria-hidden="true" data-icon={name} />
            <span className={cn('ph-mode-label', shape === 'icons' && !vertical && 'pj:sr-only')}>{option.label}</span>
            {vertical && option.value === p.mode && <Check aria-hidden="true" className="pj:ml-auto pj:text-muted-foreground" />}
          </SegmentedControlItem>
        )
      })}
    </SegmentedControl>
  )
  if (shape !== 'menu') return group(false)
  const current = options.find(option => option.value === p.mode) ?? options[0]!
  const {icon: Icon, name: iconName} = modeIcons[current.value]
  const name = `Comparison mode: ${current.label}`
  // Arrow keys select as they move, by clicking the radio they focus; only a pointer click, Space or Enter closes the menu.
  const close = (event: MouseEvent<HTMLDivElement>) => {
    if (arrowing.current) return
    closeOn('radio', () => setOpen(false))(event)
  }
  return (
    <ToolbarPopover
      label={name}
      title="Comparison mode"
      className="ph-mode-menu"
      contentClassName="pj:w-48 pj:p-1"
      open={open}
      onOpenChange={setOpen}
      // Folded into a menu, the switch is a button among the toolbar's: their fill, and the segmented controls' height,
      // corners and edge.
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={name}
          title={name}
          className="ph-mode-button pj:h-8 pj:shrink-0 pj:gap-0.5 pj:rounded-md pj:border pj:border-input pj:bg-background pj:pr-1 pj:pl-2 pj:shadow-xs pj:dark:bg-input/30 pj:hover:bg-accent pj:dark:hover:bg-accent pj:aria-expanded:bg-accent pj:data-[state=open]:bg-accent pj:[&_svg]:size-4"
        >
          <Icon aria-hidden="true" data-icon={iconName} />
          <ChevronDown aria-hidden="true" className="pj:size-3.5! pj:text-muted-foreground" />
        </Button>
      }
    >
      <div
        onClick={close}
        onPointerDown={() => {
          arrowing.current = false
        }}
        onKeyDownCapture={event => {
          arrowing.current = /^(Arrow|Home$|End$)/.test(event.key)
        }}
      >
        {group(true)}
      </div>
    </ToolbarPopover>
  )
}

/** The control group a toolbar draws as `ZoomControls` (the kit's `graphCanvasControls`: zoom out, fit, zoom in). */
export const zoomGroup = zoomControlGroup

/**
 * The renderer's declared `zoom` controls as small toolbar buttons named by their labels (a range stays a compact
 * slider). Renders nothing when the renderer declares none or has stopped.
 */
export function ZoomControls({projection: p}: {projection: ProjectionController}) {
  const controls = p.controls.filter(control => control.group === zoomGroup)
  if (!controls.length || p.rendererStatus === 'failed') return null
  return (
    <div className="ph-zoom pj:flex pj:shrink-0 pj:items-center" role="group" aria-label="Zoom">
      {controls.map(control => (
        <RendererControl key={control.id} projection={p} control={control} compact />
      ))}
    </div>
  )
}

export const viewIcons = {renderer: Network, table: Table2, text: FileText}

const viewName = (kind: ViewKind, rendererTitle: string | undefined) =>
  kind === 'renderer' ? (rendererTitle ?? 'Renderer') : kind === 'table' ? 'Table' : 'Text'

/** What `SettingsMenu`'s "Show as" group offers: the shown view, the views to choose among, and how to choose one. */
export interface ShowAsOptions {
  view: ViewKind
  views: readonly ViewKind[]
  onViewChange: (view: ViewKind) => void
  /** The renderer's title, which names its choice; default "Renderer". */
  rendererTitle?: string | undefined
}

/**
 * The "Show as" radio group (arrow keys select): the renderer (by its title), Table and Text, among `views`. The
 * prebuilt views put it at the top of Settings, so the escape-hatch table and text views take no room in the row.
 * `labelledBy` names the group by a visible label; otherwise it is named "Show as". Renders nothing with fewer than
 * two views.
 */
export function ShowAs({
  view,
  views,
  onViewChange,
  rendererTitle,
  labelledBy,
  className,
}: ShowAsOptions & {labelledBy?: string; className?: string}) {
  if (views.length < 2) return null
  return (
    <SegmentedControl
      {...(labelledBy ? {'aria-labelledby': labelledBy} : {'aria-label': 'Show as'})}
      value={view}
      onValueChange={value => onViewChange(value as ViewKind)}
      className={cn('ph-show-as pj:min-w-0 pj:max-w-full', className)}
    >
      {views.map(kind => {
        const Icon = viewIcons[kind]
        return (
          <SegmentedControlItem
            key={kind}
            value={kind}
            data-view={kind}
            title={viewName(kind, rendererTitle)}
            className="pj:min-w-0 pj:gap-1.5 pj:px-2 pj:[&_svg]:size-3.5 pj:[&_svg]:shrink-0"
          >
            <Icon aria-hidden="true" />
            <span className="pj:truncate">{viewName(kind, rendererTitle)}</span>
          </SegmentedControlItem>
        )
      })}
    </SegmentedControl>
  )
}

/**
 * A small chip in the toolbar row while the table or text view is shown in place of the renderer ("Table ×"). With
 * `onDismiss` it is a button named "Showing table; show the <renderer> renderer" that returns to the renderer in one
 * click; without (no renderer to return to) it only says what is shown. Renders nothing for the renderer view.
 */
export function ShowAsChip({
  view,
  rendererTitle,
  onDismiss,
  className,
}: {
  view: ViewKind
  rendererTitle?: string | undefined
  onDismiss?: (() => void) | undefined
  className?: string
}) {
  if (view === 'renderer') return null
  const Icon = viewIcons[view]
  const label = viewName(view, undefined)
  const chip =
    'ph-show-as-chip pj:inline-flex pj:h-8 pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-1 pj:rounded-md pj:border pj:bg-background pj:pl-2 pj:text-xs pj:font-medium pj:text-foreground pj:shadow-xs pj:[&_svg]:size-3.5 pj:[&_svg]:shrink-0'
  if (!onDismiss) {
    return (
      <span className={cn(chip, 'pj:pr-2', className)} data-view={view}>
        <Icon aria-hidden="true" className="pj:text-muted-foreground" />
        <span>
          <span className="pj:sr-only">Showing </span>
          {label}
        </span>
      </span>
    )
  }
  const name = `Showing ${label.toLowerCase()}; show the ${rendererTitle ?? 'renderer'}${rendererTitle ? ' renderer' : ''}`
  return (
    <button
      type="button"
      className={cn(
        chip,
        'pj:pr-1 pj:transition-colors pj:hover:bg-accent pj:focus-visible:outline-hidden pj:focus-visible:ring-2 pj:focus-visible:ring-ring/50',
        className,
      )}
      data-view={view}
      aria-label={name}
      title={name}
      onClick={onDismiss}
    >
      <Icon aria-hidden="true" className="pj:text-muted-foreground" />
      <span>{label}</span>
      <X aria-hidden="true" className="pj:ml-0.5 pj:text-muted-foreground" />
    </button>
  )
}

const variationToggle =
  'pj:inline-flex pj:h-8 pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-1.5 pj:rounded-md pj:border pj:border-border pj:bg-transparent pj:px-2 pj:text-xs pj:font-normal pj:whitespace-nowrap pj:text-muted-foreground pj:transition-colors pj:hover:bg-accent pj:hover:text-foreground pj:focus-visible:outline-hidden pj:focus-visible:ring-2 pj:focus-visible:ring-ring/50 pj:aria-pressed:border-foreground/40 pj:aria-pressed:bg-background pj:aria-pressed:text-foreground pj:aria-pressed:shadow-xs pj:[&_svg]:size-3.5 pj:[&_svg]:shrink-0'

/**
 * The count of items that varied within tolerance ("3 varied within tolerance", from `variation.within`), as a toggle
 * that shows only those items (the Noise scope); pressed again, every item returns. Neutral and
 * muted, never a change color: these items are unchanged. Renders nothing when nothing varied within tolerance.
 * `inline` draws it full width, for the More menu.
 */
export function VariedToggle({
  projection: p,
  inline = false,
  className,
}: {
  projection: ProjectionController
  inline?: boolean
  className?: string
}) {
  const within = p.variation?.within ?? 0
  if (!p.comparing || within === 0) return null
  const label = `${within.toLocaleString()} varied within tolerance`
  const hint = p.variedOnly ? 'Show every item' : 'Show only the items that varied within tolerance'
  return (
    <button
      type="button"
      className={cn('ph-varied-toggle', variationToggle, inline && 'pj:w-full', className)}
      aria-pressed={p.variedOnly}
      title={hint}
      data-varied-within={within}
      onClick={() => p.setVariedOnly(!p.variedOnly)}
    >
      <Activity aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

/**
 * The count of items whose generated values were regenerated from the same inputs ("4 regenerated", from
 * `variation.regenerated`), as a toggle that shows only those items, like `VariedToggle`. Neutral and muted: these
 * items are unchanged. Renders nothing when nothing was regenerated.
 */
export function RegeneratedToggle({
  projection: p,
  inline = false,
  className,
}: {
  projection: ProjectionController
  inline?: boolean
  className?: string
}) {
  const regenerated = p.variation?.regenerated ?? 0
  if (!p.comparing || regenerated === 0) return null
  const hint = p.regeneratedOnly ? 'Show every item' : 'Show only the items whose generated values were regenerated from the same inputs'
  return (
    <button
      type="button"
      className={cn('ph-regenerated-toggle', variationToggle, inline && 'pj:w-full', className)}
      aria-pressed={p.regeneratedOnly}
      title={hint}
      data-regenerated={regenerated}
      onClick={() => p.setRegeneratedOnly(!p.regeneratedOnly)}
    >
      <Sparkle aria-hidden="true" />
      <span>{`${regenerated.toLocaleString()} regenerated`}</span>
    </button>
  )
}

/**
 * The renderer, table and text tabs, for custom hosts (the prebuilt views offer these as `ShowAs` in Settings). Arrow
 * keys, Home and End move between and select them. Pass `idPrefix` to label a panel: tabs are
 * `<idPrefix>-tab-<view>` and control `<idPrefix>-panel`. `compact` shows icons; names stay.
 */
export function ViewSwitch({
  view,
  onViewChange,
  views,
  rendererTitle,
  idPrefix,
  compact = false,
}: {
  view: ViewKind
  onViewChange: (view: ViewKind) => void
  views: readonly ViewKind[]
  rendererTitle?: string | undefined
  idPrefix?: string
  compact?: boolean
}) {
  const generated = useId()
  const prefix = idPrefix ?? generated
  const list = useRef<HTMLDivElement>(null)
  const close = useContext(MoreContext)
  const label = (kind: ViewKind) => viewName(kind, rendererTitle)
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const next = rovingIndex(event.key, views.indexOf(view), views.length, 'horizontal')
    if (next === undefined) return
    event.preventDefault()
    onViewChange(views[next]!)
    list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
  }
  const icons = viewIcons
  // The shadcn Tabs hooks (`data-slot`), so the theme's segment styles apply. In a `MoreMenu`, choosing closes it.
  return (
    <div
      ref={list}
      role="tablist"
      aria-label="Presentation"
      onKeyDown={keys}
      onClick={closeOn('tab', close)}
      data-slot="tabs-list"
      data-variant="default"
      className="ph-tabs pj:inline-flex pj:h-8 pj:max-w-full pj:shrink-0 pj:items-center pj:gap-0.5 pj:overflow-x-auto pj:rounded-md pj:bg-muted pj:p-0.5 pj:text-muted-foreground"
    >
      {views.map(kind => {
        const Icon = icons[kind]
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            id={`${prefix}-tab-${kind}`}
            aria-controls={`${prefix}-panel`}
            aria-selected={view === kind}
            tabIndex={view === kind ? 0 : -1}
            onClick={() => onViewChange(kind)}
            data-slot="tabs-trigger"
            data-state={view === kind ? 'active' : 'inactive'}
            data-view={kind}
            title={label(kind)}
            className={cn(
              'pj:inline-flex pj:h-full pj:max-w-[10rem] pj:items-center pj:justify-center pj:gap-1.5 pj:whitespace-nowrap pj:rounded-sm pj:text-sm pj:font-medium pj:transition-colors pj:hover:text-foreground pj:[&_svg]:size-4 pj:[&_svg]:shrink-0',
              compact ? 'pj:px-2' : 'pj:px-2.5',
            )}
          >
            {compact && <Icon aria-hidden="true" />}
            <span className={cn('pj:truncate', compact && 'pj:sr-only')}>{label(kind)}</span>
          </button>
        )
      })}
    </div>
  )
}

import {useId, type ReactNode} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Funnel,
  RotateCcw,
  Scan,
  Search,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type {ControlIcon} from '@githubnext/projections-renderer-sdk/protocol'
import {comparisonModes, type ComparisonMode} from '../modes.js'
import type {ProjectionController} from '../projection.js'
import {Button} from './components/button.js'
import {Checkbox} from './components/checkbox.js'
import {Label} from './components/label.js'
import {NativeSelect} from './components/native-select.js'
import {Range} from './components/range.js'
import {SegmentedControl, SegmentedControlItem} from './components/segmented-control.js'
import {cn} from './lib/utils.js'

/** The icons hosts draw for declared actions' `icon`s. */
export const rendererControlIcons: Record<ControlIcon, ReactNode> = {
  'zoom-in': <ZoomIn />,
  'zoom-out': <ZoomOut />,
  fit: <Scan />,
  reset: <RotateCcw />,
  expand: <ChevronsUpDown />,
  collapse: <ChevronsDownUp />,
  previous: <ChevronLeft />,
  next: <ChevronRight />,
  download: <Download />,
  filter: <Funnel />,
  search: <Search />,
  settings: <Settings />,
}

type Control = ProjectionController['controls'][number]

/** A labeled field: a short label beside its control (`stack` puts them at either end of a menu row). */
export function Field({
  label,
  htmlFor,
  children,
  className,
  title,
  stack = false,
}: {
  label: ReactNode
  htmlFor: string
  children: ReactNode
  className?: string
  title?: string | undefined
  stack?: boolean
}) {
  return (
    <div className={cn('pj:flex pj:min-w-0 pj:items-center pj:gap-2', stack && 'pj:justify-between pj:gap-3', className)} title={title}>
      <Label
        htmlFor={htmlFor}
        className={cn('pj:shrink-0', stack ? 'pj:text-sm pj:font-normal' : 'pj:text-xs pj:font-medium pj:text-muted-foreground')}
      >
        {label}
      </Label>
      {children}
    </div>
  )
}

const everyMode = comparisonModes.map(option => option.value)

/** A segmented radio group choosing the comparison mode; arrow keys select, as with native radios. */
export function ComparisonModeControl({
  mode,
  onChange,
  modes = everyMode,
}: {
  mode: ComparisonMode
  onChange: (mode: ComparisonMode) => void
  /** The modes to offer, in order (default all; pass the controller's `availableModes`). */
  modes?: readonly ComparisonMode[]
}) {
  return (
    <SegmentedControl
      aria-label="Comparison mode"
      value={mode}
      onValueChange={value => onChange(value as ComparisonMode)}
      className="ph-mode"
    >
      {modes
        .flatMap(value => comparisonModes.filter(option => option.value === value))
        .map(option => (
          <SegmentedControlItem key={option.value} value={option.value} data-mode={option.value}>
            {option.label}
          </SegmentedControlItem>
        ))}
    </SegmentedControl>
  )
}

/**
 * One control a renderer declared, drawn by the host. `compact` draws it for a toolbar: an action with an icon is an
 * icon button named by its label; `stack` draws it as a menu row.
 */
export function RendererControl({
  projection: p,
  control,
  compact = false,
  stack = false,
}: {
  projection: ProjectionController
  control: Control
  compact?: boolean
  stack?: boolean
}) {
  const id = useId()
  const field = `${id}-${control.id}`
  const value = p.controlValues[control.id]
  switch (control.type) {
    case 'choice':
      return (
        <Field label={control.label} htmlFor={field} title={control.description} stack={stack}>
          <NativeSelect
            id={field}
            size="sm"
            className={stack ? 'pj:w-48' : undefined}
            value={String(value)}
            onChange={event => p.setControl(control.id, event.target.value)}
          >
            {control.choices.map(choice => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )
    case 'toggle':
      return (
        <div className="pj:flex pj:items-center pj:gap-2" title={control.description}>
          <Checkbox id={field} checked={value === true} onCheckedChange={checked => p.setControl(control.id, checked === true)} />
          <Label htmlFor={field} className="pj:text-sm pj:font-normal">
            {control.label}
          </Label>
        </div>
      )
    case 'range':
      return (
        <Field label={control.label} htmlFor={field} title={control.description} stack={stack}>
          <span className="pj:flex pj:items-center pj:gap-2">
            <Range
              id={field}
              className={compact ? 'pj:w-20' : stack ? 'pj:w-32' : 'pj:w-28'}
              min={control.min}
              max={control.max}
              step={control.step}
              value={Number(value)}
              onChange={event => p.setControl(control.id, event.target.valueAsNumber)}
            />
            <output htmlFor={field} className="pj:min-w-[3ch] pj:text-xs pj:tabular-nums pj:text-muted-foreground">
              {String(value)}
              {control.unit ?? ''}
            </output>
          </span>
        </Field>
      )
    case 'action':
      return compact && control.icon ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={control.label}
          title={control.description ?? control.label}
          data-icon={control.icon}
          onClick={() => p.runAction(control.id)}
        >
          {rendererControlIcons[control.icon]}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={control.description}
          data-icon={control.icon}
          onClick={() => p.runAction(control.id)}
        >
          {control.icon && rendererControlIcons[control.icon]}
          {control.label}
        </Button>
      )
  }
}

/**
 * The controls the renderer declared (or `controls`, a subset of them), drawn by the host in the "Renderer controls"
 * group: in a wrapping row, or stacked as menu rows (actions together at the end).
 */
export function RendererControls({
  projection: p,
  controls = p.controls,
  layout = 'row',
}: {
  projection: ProjectionController
  controls?: readonly Control[]
  layout?: 'row' | 'stack'
}) {
  if (!controls.length) return null
  const stack = layout === 'stack'
  const actions = stack ? controls.filter(control => control.type === 'action') : []
  return (
    <div
      className={cn(
        'ph-renderer-controls pj:flex pj:min-w-0',
        stack ? 'pj:flex-col pj:gap-2.5' : 'pj:flex-wrap pj:items-center pj:gap-x-4 pj:gap-y-2',
      )}
      role="group"
      aria-label="Renderer controls"
    >
      {controls
        .filter(control => !stack || control.type !== 'action')
        .map(control => (
          <RendererControl key={control.id} projection={p} control={control} stack={stack} />
        ))}
      {actions.length > 0 && (
        <div className="pj:flex pj:flex-wrap pj:gap-2">
          {actions.map(control => (
            <RendererControl key={control.id} projection={p} control={control} />
          ))}
        </div>
      )}
    </div>
  )
}

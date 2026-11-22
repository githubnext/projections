import {useId, type CSSProperties, type KeyboardEvent} from 'react'
import type {ProjectionController, RendererControl} from '@githubnext/projections-host'
import {ActionButton, VscButton, VscCheckbox, VscOption, Radio, VscRadioGroup, VscSingleSelect} from './elements.js'
import {vscodeControlIcons} from './codicons.js'

/** The default for an optional list prop: one array, so a default never changes between renders. */
const none: readonly never[] = []

export {vscodeControlIcons}

/** A labeled single choice: VSCode Elements' `vscode-single-select`, VS Code's dropdown. */
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  hideLabel = false,
}: {
  label: string
  value: T
  options: readonly {value: T; label: string}[]
  onChange: (value: T) => void
  className?: string
  /** Name the dropdown without showing the label. */
  hideLabel?: boolean
}) {
  const id = useId()
  return (
    <div className={`phv-field ${className ?? ''}`}>
      <label id={`${id}-label`} className={hideLabel ? 'phv-visually-hidden' : 'phv-field-label'}>
        {label}
      </label>
      <VscSingleSelect
        label={label}
        aria-labelledby={`${id}-label`}
        value={value}
        onChange={event => onChange((event.target as HTMLInputElement).value as T)}
      >
        {options.map(option => (
          <VscOption key={option.value} value={option.value} selected={option.value === value}>
            {option.label}
          </VscOption>
        ))}
      </VscSingleSelect>
    </div>
  )
}

/**
 * A native range input drawn like VS Code's sliders (the track in `--vscode-scrollbarSlider-*`, the filled part and
 * thumb in `--vscode-progressBar-background`, the focus outline in `--vscode-focusBorder`). VSCode Elements has no
 * slider.
 */
export function RangeInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onKeyDown,
  valueText,
  id,
  className,
  title,
}: {
  label: string
  value: number
  min: number
  max: number
  /** `any` for a continuous value. */
  step: number | 'any'
  onChange: (value: number) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  valueText?: string
  id?: string
  className?: string
  title?: string
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      id={id}
      type="range"
      className={`phv-range ${className ?? ''}`}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{'--phv-fill': `${fill}%`} as CSSProperties}
      onChange={event => onChange(event.target.valueAsNumber)}
      {...(onKeyDown ? {onKeyDown} : {})}
      {...(valueText ? {'aria-valuetext': valueText} : {})}
      {...(title ? {title} : {})}
    />
  )
}

/**
 * One declared control in VS Code's controls: a few choices as radios (more as a dropdown), a toggle as a checkbox, a
 * range as a slider, an action as an action bar button (with its codicon) or a secondary button. `compact` hides a
 * range's visible label, for toolbars.
 */
export function VscodeRendererControl({
  control,
  projection: p,
  compact = false,
}: {
  control: RendererControl
  projection: ProjectionController
  compact?: boolean
}) {
  const id = useId()
  const value = p.controlValues[control.id]
  const description = control.description ? {'aria-describedby': `${id}-description`} : {}
  const hint = control.description ? (
    <span id={`${id}-description`} className="phv-visually-hidden">
      {control.description}
    </span>
  ) : null
  if (control.type === 'choice') {
    return (
      <div className="phv-control" data-control={control.id} title={control.description}>
        {control.choices.length <= 4 ? (
          <>
            <span id={`${id}-label`} className="phv-control-label">
              {control.label}
            </span>
            <VscRadioGroup variant="horizontal" role="radiogroup" aria-labelledby={`${id}-label`} {...description}>
              {control.choices.map(choice => (
                <Radio
                  key={choice.value}
                  name={`${id}-choice`}
                  value={choice.value}
                  label={choice.label}
                  checked={value === choice.value}
                  onChange={() => p.setControl(control.id, choice.value)}
                />
              ))}
            </VscRadioGroup>
          </>
        ) : (
          <SelectMenu
            label={control.label}
            value={String(value)}
            options={control.choices}
            onChange={next => p.setControl(control.id, next)}
          />
        )}
        {hint}
      </div>
    )
  }
  if (control.type === 'toggle') {
    return (
      <div className="phv-control" data-control={control.id} title={control.description}>
        <VscCheckbox
          toggle
          label={control.label}
          checked={value === true}
          onChange={event => p.setControl(control.id, (event.target as HTMLInputElement).checked)}
          {...description}
        />
        {hint}
      </div>
    )
  }
  if (control.type === 'range') {
    return (
      <div className="phv-control phv-control-ranged" data-control={control.id} title={control.description}>
        <label htmlFor={`${id}-range`} className={compact ? 'phv-visually-hidden' : 'phv-control-label'}>
          {control.label}
        </label>
        <RangeInput
          id={`${id}-range`}
          label={control.label}
          min={control.min}
          max={control.max}
          step={control.step}
          value={Number(value)}
          onChange={next => p.setControl(control.id, next)}
          valueText={`${String(value)}${control.unit ?? ''}`}
          className="phv-control-range"
        />
        <output htmlFor={`${id}-range`} className="phv-output">
          {String(value)}
          {control.unit ?? ''}
        </output>
        {hint}
      </div>
    )
  }
  return (
    <div className="phv-control phv-control-action" data-control={control.id}>
      {control.icon ? (
        <ActionButton
          icon={vscodeControlIcons[control.icon]}
          label={control.label}
          title={control.description ? `${control.label}: ${control.description}` : control.label}
          data-icon={control.icon}
          onClick={() => p.runAction(control.id)}
        />
      ) : (
        <VscButton secondary onClick={() => p.runAction(control.id)} title={control.description}>
          {control.label}
        </VscButton>
      )}
    </div>
  )
}

/** The controls the renderer declared, grouped as declared. `exclude` leaves out groups drawn elsewhere, such as `zoom`. */
export function VscodeRendererControls({projection: p, exclude = none}: {projection: ProjectionController; exclude?: readonly string[]}) {
  const shown = p.controls.filter(control => control.group === undefined || !exclude.includes(control.group))
  if (!shown.length) return null
  const groups: {key: string; controls: RendererControl[]}[] = []
  for (const control of shown) {
    const last = groups.at(-1)
    if (control.group !== undefined && last?.key === control.group) last.controls.push(control)
    else groups.push({key: control.group ?? `control-${control.id}`, controls: [control]})
  }
  return (
    <div className="phv-renderer-controls" role="group" aria-label="Renderer controls">
      {groups.map(group => (
        <div key={group.key} className="phv-control-group" data-group={group.key}>
          {group.controls.map(control => (
            <VscodeRendererControl key={control.id} control={control} projection={p} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Playback speed choices for a select, slowest first: `value` is the option's string value, `label` its text and
 * `factor` the multiplier `ProjectionController.setSpeed` takes (2 plays twice as fast).
 */
export const speeds = [
  {value: '0.5', label: '0.5×', factor: 0.5},
  {value: '1', label: '1×', factor: 1},
  {value: '2', label: '2×', factor: 2},
] as const

// The values of the controls a renderer declares.
import {finite} from '../validation.js'
import type {RendererOptions} from '../messages.js'
import type {RendererControl} from './declaration.js'

/** A control's value: a choice's `value`, a toggle's boolean or a range's number. */
export type ControlValue = string | boolean | number

/** Whether a value is valid for a control; actions have no value. */
export function isControlValue(control: RendererControl, value: unknown): value is ControlValue {
  switch (control.type) {
    case 'choice':
      return typeof value === 'string' && control.choices.some(choice => choice.value === value)
    case 'toggle':
      return typeof value === 'boolean'
    case 'range':
      return finite(value) && value >= control.min && value <= control.max
    case 'action':
      return false
  }
  return false
}

/** Each control's value from `options`, or its default when absent or invalid. */
export function controlValues(controls: readonly RendererControl[], options: RendererOptions = {}): Record<string, ControlValue> {
  const values: Record<string, ControlValue> = {}
  for (const control of controls) {
    if (control.type === 'action') continue
    const value = options[control.id]
    values[control.id] = isControlValue(control, value) ? value : control.default
  }
  return values
}

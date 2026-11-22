// The controls a renderer asks the host to draw: their declarations and how they are validated.
import {rendererLimits} from '../frame.js'
import {record, finite, keys, controlIdPattern, label} from '../validation.js'

/** Icons hosts map to their design system for action controls. */
export const controlIcons = [
  'zoom-in',
  'zoom-out',
  'fit',
  'reset',
  'expand',
  'collapse',
  'previous',
  'next',
  'download',
  'filter',
  'search',
  'settings',
] as const
/** One of `controlIcons`, an action control's optional icon. */
export type ControlIcon = (typeof controlIcons)[number]

interface ControlBase {
  /** Stable identifier, also the key in `options`. */
  id: string
  /** Short visible label. */
  label: string
  /** Longer accessible description. */
  description?: string
  /** Groups controls that belong together, for example `zoom`. */
  group?: string
  /**
   * Names the control's group where a host draws groups as menus, for example "Packages". One control of a group
   * declaring it is enough. Without it, hosts name a group by its lone control's label, else by its `group` ID.
   */
  groupLabel?: string
}
/**
 * A setting the host draws for the renderer. By `type`:
 *
 * - `choice`: one of `choices` (distinct non-empty `value`s of at most 64 characters, each labelled), `default` among
 *   them; its value is the chosen `value`.
 * - `toggle`: a boolean, `default` on or off.
 * - `range`: a number from `min` to `max` (`min < max`) in `step` increments (`step > 0`), `default` within them,
 *   with an optional short `unit` such as `%`.
 * - `action`: a button with an optional `icon`; it has no value, and activating it sends `action` with its `id`.
 *
 * `parseControls` validates a list strictly and `controlValues` reads the values.
 */
export type RendererControl = ControlBase &
  (
    | {type: 'choice'; choices: {value: string; label: string}[]; default: string}
    | {type: 'toggle'; default: boolean}
    | {type: 'range'; min: number; max: number; step: number; default: number; unit?: string}
    | {type: 'action'; icon?: ControlIcon}
  )
type Fields = Record<string, unknown>

/** The fields every control has besides its type's. */
const common = ['id', 'label', 'description', 'group', 'groupLabel', 'type']

/** Validates the fields every control shares: a new ID, a label, and optional description, group and group label. */
function parseBase(item: Fields, ids: ReadonlySet<string>): ControlBase | undefined {
  if (typeof item.id !== 'string' || !controlIdPattern.test(item.id) || ids.has(item.id) || !label(item.label)) return undefined
  if (item.description !== undefined && !label(item.description, 300)) return undefined
  if (item.group !== undefined && (typeof item.group !== 'string' || !controlIdPattern.test(item.group))) return undefined
  if (item.groupLabel !== undefined && !label(item.groupLabel)) return undefined
  return {
    id: item.id,
    label: item.label,
    ...(item.description === undefined ? {} : {description: item.description as string}),
    ...(item.group === undefined ? {} : {group: item.group as string}),
    ...(item.groupLabel === undefined ? {} : {groupLabel: item.groupLabel as string}),
  }
}

/** Validates a choice control's choices: distinct non-empty values of at most 64 characters, each labelled. */
function parseChoices(value: unknown[]): {value: string; label: string}[] | undefined {
  const values = new Set<string>()
  const choices: {value: string; label: string}[] = []
  for (const choice of value) {
    if (
      !record(choice) ||
      !keys(choice, ['value', 'label']) ||
      typeof choice.value !== 'string' ||
      !choice.value ||
      choice.value.length > 64 ||
      values.has(choice.value) ||
      !label(choice.label)
    ) {
      return undefined
    }
    values.add(choice.value)
    choices.push({value: choice.value, label: choice.label})
  }
  return choices
}

/** The parser of each control type's own fields, given the shared ones. */
const parsers: Record<string, (item: Fields, base: ControlBase) => RendererControl | undefined> = {
  choice(item, base) {
    if (
      !keys(item, [...common, 'choices', 'default']) ||
      !Array.isArray(item.choices) ||
      !item.choices.length ||
      item.choices.length > rendererLimits.choices
    ) {
      return undefined
    }
    const choices = parseChoices(item.choices)
    if (!choices) return undefined
    if (typeof item.default !== 'string' || !choices.some(choice => choice.value === item.default)) return undefined
    return {...base, type: 'choice', choices, default: item.default}
  },
  toggle(item, base) {
    if (!keys(item, [...common, 'default']) || typeof item.default !== 'boolean') return undefined
    return {...base, type: 'toggle', default: item.default}
  },
  range(item, base) {
    const {min, max, step} = item
    if (
      !keys(item, [...common, 'min', 'max', 'step', 'default', 'unit']) ||
      !finite(min) ||
      !finite(max) ||
      !finite(step) ||
      !finite(item.default)
    ) {
      return undefined
    }
    if (!(min < max) || !(step > 0) || item.default < min || item.default > max) return undefined
    if (item.unit !== undefined && !label(item.unit, 16)) return undefined
    return {...base, type: 'range', min, max, step, default: item.default, ...(item.unit === undefined ? {} : {unit: item.unit as string})}
  },
  action(item, base) {
    if (!keys(item, [...common, 'icon']) || (item.icon !== undefined && !controlIcons.includes(item.icon as ControlIcon))) return undefined
    return {...base, type: 'action', ...(item.icon === undefined ? {} : {icon: item.icon as ControlIcon})}
  },
}

/**
 * Validates control declarations strictly: unique IDs, at most
 * `rendererLimits.controls` controls and `rendererLimits.choices` choices each,
 * known types and icons, defaults that are valid values.
 */
export function parseControls(value: unknown): RendererControl[] | undefined {
  if (!Array.isArray(value) || value.length > rendererLimits.controls) return undefined
  const ids = new Set<string>()
  const controls: RendererControl[] = []
  for (const item of value) {
    const base = record(item) ? parseBase(item, ids) : undefined
    if (!base) return undefined
    ids.add(base.id)
    const parse = typeof item.type === 'string' && Object.hasOwn(parsers, item.type) ? parsers[item.type] : undefined
    const control = parse?.(item, base)
    if (!control) return undefined
    controls.push(control)
  }
  return controls
}

/** Validates control declarations up front, typed for `capabilities.controls`. Throws when any is invalid. */
export function defineControls<const T extends readonly RendererControl[]>(controls: T): T {
  if (!parseControls(controls)) throw new Error('Invalid control declarations')
  return controls
}

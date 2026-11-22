import {controlValues, isControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import type {ControlValue, RendererCapabilities, RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {clampMode, defaultComparisonModes, orderComparisonModes, twoPaneMode} from '../modes.js'
import type {ComparisonMode} from '../modes.js'
import type {PaneState} from '../pane.js'
import type {RendererEntry} from '../registry.js'
import type {Memos} from './memo.js'
import type {PaneKey, PresentationDefaults, RendererStatus} from './types.js'

/** The modes each renderer declared when it connected, by bundle URL; they outlive the panes that reported them. */
export type DeclaredModes = Readonly<Record<string, readonly ComparisonMode[]>>

export interface ComparisonModesInput {
  comparing: boolean
  renderer: RendererEntry | undefined
  chosenMode: ComparisonMode | undefined
  declaredModes: DeclaredModes
}

/**
 * The comparison modes the renderer supports, in canonical order, the mode shown (the chosen one when supported) and
 * the panes it shows, falling back to a supported mode when the chosen one isn't.
 */
export function createComparisonModes({memo}: Memos) {
  const orderedOf = memo((key: string) => orderComparisonModes(key.split(',').filter(Boolean) as ComparisonMode[]))
  return ({comparing, renderer, chosenMode, declaredModes}: ComparisonModesInput) => {
    // Shown in canonical order, whatever order the renderer declares them in.
    const declared = (renderer ? (declaredModes[renderer.url] ?? renderer.comparisonModes) : undefined) ?? defaultComparisonModes
    const availableModes = orderedOf(declared.join())
    // Until a renderer is resolved and says which modes it supports (its manifest or its ready message), a chosen mode
    // is trusted and kept pending: a host mounted before its renderer catalog loads must not clamp `initialMode: 'diff'`
    // to the defaults (which have no diff) and lose it.
    const modesKnown = Boolean(renderer && (declaredModes[renderer.url] ?? renderer.comparisonModes))
    const mode: ComparisonMode = !comparing
      ? 'animated'
      : modesKnown
        ? clampMode(chosenMode, availableModes)
        : (chosenMode ?? clampMode(undefined, availableModes))
    const paneKeys: PaneKey[] = twoPaneMode(mode) ? ['before', 'after'] : ['main']
    return {availableModes, modesKnown, mode, paneKeys}
  }
}

/** The modes a ready renderer declares, recorded by its bundle URL: the same record when they are already known. */
export function declaredModesWith(
  declared: DeclaredModes,
  renderer: RendererEntry | undefined,
  capabilities: RendererCapabilities | undefined,
): DeclaredModes {
  if (!renderer || !capabilities) return declared
  const modes = capabilities.comparisonModes ?? defaultComparisonModes
  return JSON.stringify(declared[renderer.url]) === JSON.stringify(modes) ? declared : {...declared, [renderer.url]: modes}
}

/** Whether the shown panes' renderer is loading, ready or failed (`none` without a renderer), and its errors. */
export function rendererState(renderer: RendererEntry | undefined, panes: Record<PaneKey, PaneState>, paneKeys: PaneKey[]) {
  const statuses = paneKeys.map(key => panes[key].status)
  const status: RendererStatus = !renderer
    ? 'none'
    : statuses.includes('failed')
      ? 'failed'
      : statuses.includes('loading')
        ? 'loading'
        : 'ready'
  const errors = paneKeys.flatMap(key => [
    ...panes[key].rendererErrors,
    ...(panes[key].status === 'failed' && panes[key].message ? [panes[key].message] : []),
  ])
  return {status, errors}
}

/** The definition's defaults applied for one declaration of controls (its JSON, `key`), and their notices. */
export interface SeededControls {
  readonly notices: readonly string[]
  readonly key: string
}

export const unseeded: SeededControls = {notices: [], key: ''}

/**
 * Definition defaults for renderer controls apply once the renderer declares them; unknown or invalid ones get a
 * notice. The values to seed and the record of it, or `undefined` when this declaration was seeded already.
 */
export function seedControls(
  seeded: SeededControls,
  controls: readonly RendererControl[],
  presentation: PresentationDefaults | undefined,
  renderer: RendererEntry | undefined,
): {seeded: SeededControls; values: Record<string, ControlValue>} | undefined {
  const key = JSON.stringify(controls)
  if (key === seeded.key || !controls.length || !presentation?.rendererOptions) return undefined
  const notices: string[] = []
  const values: Record<string, ControlValue> = {}
  for (const [id, raw] of Object.entries(presentation.rendererOptions)) {
    const control = controls.find(item => item.id === id)
    if (!control) {
      notices.push(`The projection definition sets "${id}", which the ${renderer?.title ?? ''} renderer doesn't offer; it was ignored.`)
    } else if (!isControlValue(control, raw)) {
      notices.push(`The projection definition's value for "${control.label}" isn't valid for this renderer; its default is used.`)
    } else values[id] = raw
  }
  return {seeded: {notices, key}, values}
}

/** The declared controls' values: the embedder's when it controls them, else the core's; compared by value. */
export function createControlValues({byValue}: Memos) {
  const valuesOf = byValue<Record<string, ControlValue>>()
  return (
    controls: RendererControl[],
    controlled: Record<string, ControlValue> | undefined,
    own: Record<string, ControlValue>,
  ): Record<string, ControlValue> => valuesOf(controlValues(controls, controlled ?? own))
}

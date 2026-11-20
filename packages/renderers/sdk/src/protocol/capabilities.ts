// A renderer's capabilities, as its `ready` message declares them.
import {parseComparisonModes} from './comparison-modes.js'
import {parseControls} from './controls/declaration.js'
import {rendererLimits} from './frame.js'
import type {RendererCapabilities, RendererPace} from './messages.js'
import {keys, record} from './validation.js'

/** The capabilities that are plain flags. */
const flags = [
  'toggleableRelationships',
  'drawsRelationships',
  'ownTimeline',
  'hover',
  'anchors',
  'scrollSync',
  'filter',
  'context',
  'annotations',
  'properties',
] as const

/** Validates a `pace` declaration: exactly `{stepMs}`, an integer within `rendererLimits.paceStepMs`. */
export function parsePace(value: unknown): RendererPace | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.keys(value)
  if (entries.length !== 1 || entries[0] !== 'stepMs') return undefined
  const stepMs = (value as {stepMs: unknown}).stepMs
  if (
    typeof stepMs !== 'number' ||
    !Number.isInteger(stepMs) ||
    stepMs < rendererLimits.paceStepMs.min ||
    stepMs > rendererLimits.paceStepMs.max
  )
    return undefined
  return {stepMs}
}

/** Validates a `ready` message's capabilities strictly: known names only, each of its type. */
export function parseCapabilities(capabilities: unknown): RendererCapabilities | undefined {
  if (!record(capabilities)) return undefined
  if (!keys(capabilities, ['changeHighlighting', 'controls', 'comparisonModes', 'pace', ...flags])) return undefined
  if (capabilities.changeHighlighting !== 'supported' && capabilities.changeHighlighting !== 'none') return undefined
  const parsed: RendererCapabilities = {changeHighlighting: capabilities.changeHighlighting}
  for (const name of flags) {
    const value = capabilities[name]
    if (value === undefined) continue
    if (typeof value !== 'boolean') return undefined
    parsed[name] = value
  }
  if (capabilities.comparisonModes !== undefined) {
    const modes = parseComparisonModes(capabilities.comparisonModes)
    if (!modes) return undefined
    parsed.comparisonModes = modes
  }
  if (capabilities.pace !== undefined) {
    const pace = parsePace(capabilities.pace)
    if (!pace) return undefined
    parsed.pace = pace
  }
  if (capabilities.controls !== undefined) {
    const controls = parseControls(capabilities.controls)
    if (!controls) return undefined
    parsed.controls = controls
  }
  return parsed
}

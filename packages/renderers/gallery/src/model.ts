// What the gallery presents: documents of scenarios, and for each scenario what its own renderer is given.
import type {Comparison, Entity, Extraction} from '@githubnext/projections-schemas'
import {
  comparisonModes,
  supportedComparisonModes,
  type ComparisonMode,
  type InitPayload,
  type ProgressPayload,
  type RendererCapabilities,
  type RendererEnvironment,
  type RendererKind,
  type RendererOptions,
} from '@githubnext/projections-renderer-sdk/protocol'

/** One scenario, as the `scenarios/v0` vocabulary describes it (docs/models/scenarios-model.md). */
export interface Scenario {
  /** The built-in renderer that draws it, or a custom bundle's manifest name. */
  renderer: string
  /** A custom bundle's directory: such a scenario is named, never drawn. */
  bundle: string | undefined
  group: string | undefined
  description: string | undefined
  /** `default`, or the comparator file's path. */
  comparator: string | undefined
  presentation: Presentation | undefined
  subject:
    | {mode: 'extraction'; extraction: Extraction}
    | {mode: 'comparison'; before: Extraction; after: Extraction; comparison: Comparison}
    | undefined
}

/** The parts of a definition `presentation` a nested renderer is given. */
export interface Presentation {
  mode?: string
  rendererOptions?: RendererOptions
  /** How the scenario presents its kinds, as a definition's `presentation.kinds` does; the nested renderer validates it. */
  kinds?: Record<string, RendererKind>
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)
const records = (value: unknown) => Array.isArray(value) && value.every(record)
/** A comparison whose changes and steps a renderer can read; anything less reads as no subject. */
const comparisonOf = (value: unknown): Comparison | undefined =>
  record(value) && records(value.steps) && records(value.changes) && value.changes.every(change => typeof change.status === 'string')
    ? (value as unknown as Comparison)
    : undefined

/** The scenario a `scenario` entity describes; a field of the wrong shape reads as absent. */
export function scenarioOf(entity: Entity): Scenario {
  const data = (entity.data ?? {}) as Record<string, unknown>
  const extraction = (value: unknown) => (record(value) && Array.isArray(value.entities) ? (value as unknown as Extraction) : undefined)
  const subject = (): Scenario['subject'] => {
    if (data.mode === 'extraction') {
      const shown = extraction(data.extraction)
      return shown && {mode: 'extraction', extraction: shown}
    }
    const before = extraction(data.before)
    const after = extraction(data.after)
    const comparison = comparisonOf(data.comparison)
    if (data.mode !== 'comparison' || !before || !after || !comparison) return undefined
    return {mode: 'comparison', before, after, comparison}
  }
  const presentation = record(data.presentation) ? (data.presentation as Presentation) : undefined
  return {
    renderer: text(data.renderer) ?? 'unknown',
    bundle: text(data.bundle),
    group: text(data.group),
    description: text(data.description),
    comparator: text(data.comparator),
    presentation,
    subject: subject(),
  }
}

/** A `scenarios` document's scenario IDs in the document's order, as its data lists them. */
export function documentOrder(entity: Entity): string[] {
  const listed = (entity.data as Record<string, unknown> | undefined)?.scenarios
  return Array.isArray(listed) ? listed.filter((id): id is string => typeof id === 'string') : []
}

/** In a comparison, the mode a nested renderer opens in: the scenario's own when it supports it, else diff, else animated. */
export function nestedMode(capabilities: RendererCapabilities, preferred?: string): ComparisonMode {
  const supported = supportedComparisonModes(capabilities)
  // Two panes are the host's: a nested renderer is one frame, so it can only animate or draw its diff.
  const single: ComparisonMode[] = supported.filter(mode => mode === 'diff' || mode === 'animated')
  const wanted = comparisonModes.find(mode => mode === preferred)
  if (wanted && single.includes(wanted)) return wanted
  return single.includes('diff') ? 'diff' : 'animated'
}

/** The resting position of an animated nested comparison: the after revision, its changes emphasized. */
export const restingProgress: ProgressPayload = {progress: 1, highlighting: 1, direction: 1}

/**
 * What a scenario's renderer is given: its `init` (the scenario's own extraction or comparison, in the gallery's
 * environment, filling its frame), the position for an animated comparison and the scenario's renderer settings.
 */
export function nestedPresentation(
  id: string,
  title: string,
  scenario: Scenario,
  environment: RendererEnvironment,
  capabilities: RendererCapabilities,
): {init: InitPayload; progress?: ProgressPayload; options?: RendererOptions} | undefined {
  const subject = scenario.subject
  if (!subject) return undefined
  // A held pane of the gallery is the gallery's revision, not the scenario's: the nested frame shows its whole scenario.
  const {pane: _pane, ...shared} = environment
  const kinds = record(scenario.presentation?.kinds) ? {kinds: scenario.presentation.kinds} : {}
  const base = {...shared, sizing: 'fill' as const, projection: {id, title, renderer: scenario.renderer, ...kinds}}
  const options = record(scenario.presentation?.rendererOptions) ? {options: scenario.presentation.rendererOptions} : {}
  if (subject.mode === 'extraction') return {init: {...base, mode: 'extraction', extraction: subject.extraction}, ...options}
  const comparisonMode = nestedMode(capabilities, scenario.presentation?.mode)
  return {
    init: {...base, mode: 'comparison', before: subject.before, after: subject.after, comparison: subject.comparison, comparisonMode},
    ...(comparisonMode === 'diff' ? {} : {progress: restingProgress}),
    ...options,
  }
}

/** Words for a scenario's subject: `One revision`, or the comparison and the comparator that made it. */
export function subjectWords(scenario: Scenario): string {
  if (!scenario.subject) return 'No subject'
  if (scenario.subject.mode === 'extraction') return 'One revision'
  const changes = scenario.subject.comparison.changes.filter(change => change.status !== 'unchanged').length
  return `${changes.toLocaleString()} ${changes === 1 ? 'change' : 'changes'}`
}

import {rowTargets, subjectRows} from '@githubnext/projections-host'
import type {TargetAnnotation, ViewSubject} from '@githubnext/projections-host'
import type {Diagnostic} from '@githubnext/projections-schemas'
import {Monitor, Smartphone, Tablet} from 'lucide-react'
import type {FixtureCatalog, FixtureScenario} from '../../types.js'

export type Viewport = 'desktop' | 'tablet' | 'phone'
export const viewports: Record<Viewport, {label: string; width?: number; icon: typeof Monitor}> = {
  desktop: {label: 'Desktop', icon: Monitor},
  tablet: {label: 'Tablet', width: 820, icon: Tablet},
  phone: {label: 'Phone', width: 390, icon: Smartphone},
}

/** `?annotate` marks every presented item, cycling through the marker tones, to check how badges sit on renderers. */
export function annotationsFor(subject: ViewSubject): TargetAnnotation[] {
  const tones = ['attention', 'neutral', 'done', 'subtle'] as const
  return subjectRows(subject).flatMap((row, index) =>
    rowTargets(row, subject)
      .slice(0, 1)
      .map(target => ({target, count: (index % 3) + 1, tone: tones[index % 4]!})),
  )
}

/** What failed to load: scenario files, renderer bundles and scenarios. */
export function catalogDiagnostics(catalog: FixtureCatalog): Diagnostic[] {
  return [
    ...catalog.sources
      .filter(item => item.error)
      .map(item => ({severity: 'error' as const, code: 'SCENARIOS_INVALID', path: item.path, message: item.error!})),
    ...catalog.renderers
      .filter(item => item.error)
      .map(item => ({severity: 'error' as const, code: 'RENDERER_UNAVAILABLE', path: item.path, message: item.error!})),
    ...catalog.scenarios
      .filter(item => item.error)
      .map(item => ({severity: 'error' as const, code: 'SCENARIO_UNAVAILABLE', path: item.key, message: item.error!})),
  ]
}

/** A scenario's extractions, as the Extraction panel shows them. */
export function extractionChoices(scenario: FixtureScenario | undefined) {
  if (!scenario || scenario.error) return []
  return scenario.subject.mode === 'comparison'
    ? [
        {key: 'before', label: 'Before', extraction: scenario.subject.before},
        {key: 'after', label: 'After', extraction: scenario.subject.after},
      ]
    : [{key: 'extraction', label: 'Extraction', extraction: scenario.subject.extraction}]
}

import {ComparisonError, compareExtractions, customRenderer, resolveRenderer} from '@githubnext/projections-host'
import type {ComputedComparison, RendererEntry, RendererResolution, RulesRuntime, ViewSubject} from '@githubnext/projections-host'
import type {ProjectionEngine} from '@githubnext/projections-schemas'
import type {FixtureCatalog, FixtureRenderer, FixtureScenario} from '../types.js'

/** Renderer bundles served in fixtures mode, before the built-in ones, so a bundle under development wins over a built-in of the same name. */
export function fixtureEntries(catalog: FixtureCatalog): RendererEntry[] {
  return catalog.renderers
    .filter(
      (item): item is FixtureRenderer & Required<Pick<FixtureRenderer, 'manifest' | 'url'>> => !item.error && !!item.manifest && !!item.url,
    )
    .map(item => customRenderer(item.manifest, item.url))
}

/** The bundle a scenario names, among the fixture bundles and then the built-in ones. */
export function scenarioRenderer(
  scenario: FixtureScenario,
  catalog: FixtureCatalog,
  builtins: readonly RendererEntry[],
): RendererResolution {
  if (typeof scenario.renderer !== 'string') {
    const bundle = scenario.renderer.bundle
    const served = catalog.renderers.find(item => item.key === bundle)
    if (served?.manifest && served.url && !served.error) return {renderer: customRenderer(served.manifest, served.url)}
    return {
      notice: `The renderer bundle ${served?.path ?? bundle} is unavailable${served?.error ? `: ${served.error}` : ''}. Showing the built-in table view.`,
    }
  }
  return resolveRenderer(scenario.renderer, [...fixtureEntries(catalog), ...builtins])
}

/** Every bundle that could present a scenario: the resolved one, then others named for or handling its renderer or schema family. */
export function scenarioRenderers(
  scenario: FixtureScenario,
  catalog: FixtureCatalog,
  builtins: readonly RendererEntry[],
  resolved?: RendererEntry,
): RendererEntry[] {
  const extraction = scenario.subject.mode === 'extraction' ? scenario.subject.extraction : scenario.subject.after
  const names = new Set(
    [typeof scenario.renderer === 'string' ? scenario.renderer : '', extraction.schema.split('/')[0] ?? ''].filter(Boolean),
  )
  const list = resolved ? [resolved] : []
  for (const entry of [...fixtureEntries(catalog), ...builtins]) {
    if ((names.has(entry.name) || entry.handles.some(name => names.has(name))) && !list.some(item => item.url === entry.url))
      list.push(entry)
  }
  return list
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Compares a scenario's extractions in this browser with its comparator: the default one with options, or its comparator file. */
export async function compareScenario(
  scenario: FixtureScenario,
  engine: ProjectionEngine,
  rules?: RulesRuntime,
): Promise<ComputedComparison> {
  if (scenario.subject.mode !== 'comparison') throw new Error('Single extractions are not compared')
  const {before, after} = scenario.subject
  const comparator = scenario.comparator
  if (!comparator || 'default' in comparator)
    return compareExtractions({engine, before, after, comparator: {kind: 'default', options: comparator?.options ?? {}}})
  let bytes: Uint8Array
  try {
    bytes = decode(comparator.rules)
  } catch {
    throw new ComparisonError('comparator-unavailable', `The comparator ${comparator.id} could not be decoded.`)
  }
  return compareExtractions({
    engine,
    before,
    after,
    rules,
    comparator: {kind: 'rules', id: comparator.id, bytes, options: comparator.options ?? {}},
  })
}

/** What a scenario presents, once compared. */
export function scenarioSubject(scenario: FixtureScenario, computed: ComputedComparison | undefined): ViewSubject | undefined {
  if (scenario.subject.mode === 'extraction') return {mode: 'extraction', extraction: scenario.subject.extraction}
  return computed
    ? {mode: 'comparison', before: scenario.subject.before, after: scenario.subject.after, comparison: computed.comparison}
    : undefined
}

/** Finds a scenario by key (`<source>/<id>`), or by ID when exactly one scenario has it. */
export function findScenario(catalog: FixtureCatalog, name: string): FixtureScenario | undefined {
  const exact = catalog.scenarios.find(item => item.key === name)
  if (exact) return exact
  const matches = catalog.scenarios.filter(item => item.id === name)
  return matches.length === 1 ? matches[0] : undefined
}

// Story fixtures: the renderer packages' authored scenarios (scenarios.json), as saved extractions and view subjects.
import scenarios from 'virtual:projections-scenarios'
import type {Definition, Extraction, ExtractionDocument, PresentationSettings} from '@githubnext/projections-schemas'
import {computeComparison, resolveRenderer} from '@githubnext/projections-host'
import type {ExtractionChoice, RendererResolution, ViewSubject} from '@githubnext/projections-host'
import {loadComparator, rules} from './runtime.js'
import type {Runtime} from './runtime.js'

/**
 * A renderer package's authored scenario, as `scripts/scenarios.mjs` reads it: one `extraction`, or a `before` and an
 * `after` to compare, with the definition's renderer, comparator and presentation defaults.
 */
export interface Fixture {
  /** `<renderer package directory>/<scenario id>`, for example `graph/service-platform`. */
  key: string
  package: string
  id: string
  title: string
  group: string
  description?: string
  renderer: Definition['renderer']
  presentation?: PresentationSettings
  comparator?: Definition['comparator']
  extraction?: Extraction
  before?: Extraction
  after?: Extraction
}

/** Every scenario of every renderer package, by package directory, then in authored order. */
export const fixtures: readonly Fixture[] = scenarios

/** The scenario with `key` (`<renderer package directory>/<scenario id>`); throws for an unknown key. */
export function fixture(key: string): Fixture {
  const found = fixtures.find(item => item.key === key)
  if (!found) throw new Error(`No scenario ${key}; see the renderer packages' scenarios.json`)
  return found
}

/** A renderer package's scenarios, in authored order. */
export const fixturesOf = (name: string) => fixtures.filter(item => item.package === name)

/** Renderer packages with scenarios, in directory order. */
export const fixturePackages = [...new Set(fixtures.map(item => item.package))]

/** The projection definition a scenario stands for: its ID, title, renderer, comparator and presentation defaults. */
export function definitionOf(item: Fixture): Definition {
  return {
    id: item.id,
    title: item.title,
    extractor: 'scenario',
    renderer: item.renderer,
    ...(item.comparator ? {comparator: item.comparator} : {}),
    ...(item.presentation ? {presentation: item.presentation} : {}),
  }
}

function document(item: Fixture, extraction: Extraction, side: 'before' | 'after'): ExtractionDocument {
  return {
    format: 'projections.extraction',
    version: 0,
    projection: {id: item.id, title: item.title, renderer: item.renderer},
    extraction,
    provenance: {
      revision: {kind: 'commit', ref: side, commit: (side === 'before' ? 'b' : 'a').repeat(40), dirty: false},
      extractor: {id: 'scenario', version: '0'},
      definition: definitionOf(item),
      definitionDigest: `sha256:${'0'.repeat(64)}`,
      reproducibility: 'hermetic',
      limitations: [`Authored renderer scenario (${item.package}/scenarios.json); no extractor ran.`],
    },
    // Saved-document digests are placeholders; the explorer does not verify them.
    digest: '0'.repeat(64),
  }
}

/** The scenario as saved extractions for the pair picker: `before` and `after`, or the one `extraction`. */
export function extractionChoices(item: Fixture): ExtractionChoice[] {
  if (item.extraction) return [{key: 'extraction', label: item.title, document: document(item, item.extraction, 'after')}]
  return [
    {key: 'before', label: 'Before', document: document(item, item.before!, 'before')},
    {key: 'after', label: 'After', document: document(item, item.after!, 'after')},
  ]
}

/**
 * A scenario ready to present (`prepareFixture`): its view subject, comparison computed, its projection, the renderer
 * `resolveRenderer` chose for it (with any notice) and its presentation defaults.
 */
export interface PreparedFixture {
  subject: ViewSubject
  projection: {id: string; title: string; renderer?: string}
  resolution: RendererResolution
  presentation: PresentationSettings | undefined
}

/** The scenario's view subject, compared in the browser with its comparator, and the renderer for it. */
export async function prepareFixture(item: Fixture, {engine, renderers}: Runtime): Promise<PreparedFixture> {
  const [first, second] = extractionChoices(item)
  let subject: ViewSubject
  if (!second) subject = {mode: 'extraction', extraction: first!.document.extraction}
  else {
    const {comparison} = await computeComparison({
      engine,
      before: first!.document,
      after: second.document,
      comparator: await loadComparator(first!.document),
      rules,
    })
    subject = {mode: 'comparison', before: first!.document.extraction, after: second.document.extraction, comparison}
  }
  const extraction = item.extraction ?? item.after!
  return {
    subject,
    presentation: item.presentation,
    projection: {id: item.id, title: item.title, renderer: typeof item.renderer === 'string' ? item.renderer : item.renderer.bundle},
    resolution: resolveRenderer(item.renderer, renderers, undefined, extraction),
  }
}

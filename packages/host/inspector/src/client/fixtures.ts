import type {FixtureCatalog} from '../types.js'
import {isDevServerUrl, optionalText, record} from './guards.js'

/**
 * Validates a `GET /api/fixtures` response; renderer bundle URLs must be
 * same-origin custom renderer paths, or loopback development servers.
 */
export function parseFixtureCatalog(value: unknown, origin: string): FixtureCatalog {
  const invalid = (what: string) => new Error(`The local runner returned an invalid fixtures ${what}`)
  if (
    !record(value) ||
    !Number.isSafeInteger(value.generation) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.renderers) ||
    !Array.isArray(value.scenarios)
  ) {
    throw invalid('catalog')
  }
  for (const source of value.sources) {
    if (
      !record(source) ||
      typeof source.key !== 'string' ||
      typeof source.path !== 'string' ||
      !optionalText(source.title) ||
      !optionalText(source.error)
    ) {
      throw invalid('source')
    }
  }
  for (const renderer of value.renderers) {
    if (
      !record(renderer) ||
      typeof renderer.key !== 'string' ||
      typeof renderer.path !== 'string' ||
      !optionalText(renderer.error) ||
      !optionalText(renderer.withheld) ||
      !optionalText(renderer.url)
    ) {
      throw invalid('renderer')
    }
    // Withheld for trust: never served, so it has no URL to present.
    if (renderer.withheld !== undefined && renderer.url !== undefined) throw invalid('renderer')
    if (renderer.url !== undefined && renderer.development === true) {
      // A package's development server, on loopback.
      if (!isDevServerUrl(renderer.url)) throw invalid('renderer URL')
    } else if (renderer.url !== undefined) {
      const url = new URL(renderer.url, origin)
      if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/custom-renderers/')) throw invalid('renderer URL')
      renderer.url = url.href
    }
    if (renderer.error === undefined && renderer.withheld === undefined && (!record(renderer.manifest) || renderer.url === undefined)) {
      throw invalid('renderer')
    }
  }
  for (const scenario of value.scenarios) {
    if (
      !record(scenario) ||
      ['key', 'source', 'id', 'title', 'group'].some(key => typeof scenario[key] !== 'string') ||
      !optionalText(scenario.description) ||
      !optionalText(scenario.error)
    ) {
      throw invalid('scenario')
    }
    if (scenario.error !== undefined) continue
    const subject = scenario.subject
    if (typeof scenario.renderer !== 'string' && !(record(scenario.renderer) && typeof scenario.renderer.bundle === 'string')) {
      throw invalid('scenario renderer')
    }
    if (
      !record(subject) ||
      !(subject.mode === 'extraction'
        ? record(subject.extraction)
        : subject.mode === 'comparison' && record(subject.before) && record(subject.after))
    ) {
      throw invalid('scenario subject')
    }
    const comparator = scenario.comparator
    if (
      comparator !== undefined &&
      !(record(comparator) && (comparator.default === true || (typeof comparator.rules === 'string' && typeof comparator.id === 'string')))
    ) {
      throw invalid('scenario comparator')
    }
  }
  return value as unknown as FixtureCatalog
}

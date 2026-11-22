// The Inspector's client of its local runner: the API it calls, the validation of each response and the client (here).

import type {OnboardingWrite} from '../types.js'
import {InspectorRequestError} from '../transport.js'
import type {InspectorChangeChannel, InspectorTransport} from '../transport.js'
import type {InspectorApi} from './api.js'
import {parseComparatorResponse} from './comparator.js'
import {assertDefinitionList} from './definitions.js'
import {assertJob, assertRevisionList, assertScenarioList} from './documents.js'
import {parseFixtureCatalog} from './fixtures.js'
import {parseRendererList} from './renderers.js'
import {
  parseChanges,
  parseDefinitionSave,
  parseDocumentResponse,
  parseExplore,
  parseFixturesGeneration,
  parsePairs,
  parseSweep,
  parseSweepStart,
  parseThumbnail,
  parseWrite,
} from './responses.js'

/** Whether the runner doesn't serve an endpoint (an older runner, or another mode). */
function notFound(error: unknown): boolean {
  return error instanceof InspectorRequestError && error.status === 404
}

/**
 * The Inspector's client of its local runner, over any `InspectorTransport`, such as an editor webview's message
 * channel to `projections serve --stdio`.
 */
export function createInspectorClient({transport}: {transport: InspectorTransport}): InspectorApi {
  function request(path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
    return transport.request({
      method: body === undefined ? 'GET' : 'POST',
      path,
      ...(body !== undefined ? {body} : {}),
      ...(signal ? {signal} : {}),
    })
  }
  function next(channel: InspectorChangeChannel, since: number, signal?: AbortSignal): Promise<unknown> {
    if (transport.next) return transport.next(channel, since, signal)
    return request(`${channel === 'fixtures' ? '/api/fixtures/changes' : '/api/changes'}?since=${since}`, signal)
  }
  async function onboarding(path: string, body: unknown, signal?: AbortSignal): Promise<OnboardingWrite> {
    return parseWrite(await request(path, signal, body))
  }
  async function jobRequest(path: string, signal?: AbortSignal, body?: unknown) {
    const value = await request(path, signal, body)
    assertJob(value)
    return value
  }
  return {
    async definitions(ref, signal) {
      const value = await request(`/api/definitions?ref=${encodeURIComponent(ref)}`, signal)
      assertDefinitionList(value)
      return value
    },
    async revisions(signal, limit) {
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
        throw new RangeError('limit must be an integer from 1 to 100')
      }
      const value = await request(`/api/revisions${limit === undefined ? '' : `?limit=${limit}`}`, signal)
      assertRevisionList(value)
      return value
    },
    async comparator(projectionId, ref, signal) {
      const query = new URLSearchParams({projection: projectionId, ...(ref ? {ref} : {})})
      return parseComparatorResponse(await request(`/api/comparator?${query}`, signal))
    },
    async rulesFile(path, ref, signal) {
      const query = new URLSearchParams({rules: path, ...(ref ? {ref} : {})})
      const comparator = parseComparatorResponse(await request(`/api/comparator?${query}`, signal))
      if (comparator.kind !== 'rules') throw new Error(`The local runner did not return ${path} as a comparator file`)
      return comparator
    },
    async renderers(signal) {
      try {
        return parseRendererList(await request('/api/renderers', signal), transport.origin)
      } catch (error) {
        if (notFound(error)) return null
        throw error
      }
    },
    run: (body, signal) => jobRequest('/api/jobs', signal, body),
    job: (id, signal) => jobRequest(`/api/jobs/${encodeURIComponent(id)}`, signal),
    cancel: (id, signal) => jobRequest(`/api/jobs/${encodeURIComponent(id)}/cancel`, signal, {}),
    async fixtures(signal) {
      try {
        return parseFixtureCatalog(await request('/api/fixtures', signal), transport.origin)
      } catch (error) {
        if (notFound(error)) return null
        throw error
      }
    },
    async fixtureChanges(since, signal) {
      return parseFixturesGeneration(await next('fixtures', since, signal))
    },
    async explore(signal) {
      return parseExplore(await request('/api/explore', signal))
    },
    adopt: (body, signal) => onboarding('/api/adopt', body, signal),
    async startSweep(body, signal) {
      return parseSweepStart(await request('/api/sweep', signal, body))
    },
    async cancelSweep(signal) {
      await request('/api/sweep', signal, {cancel: true})
    },
    async sweep(signal) {
      return parseSweep(await request('/api/sweep', signal))
    },
    async sweepThumbnail(cell, signal) {
      const blob = await transport.request({
        method: 'GET',
        path: `/api/sweep/thumbnail?${new URLSearchParams(cell)}`,
        responseType: 'blob',
        ...(signal ? {signal} : {}),
      })
      return parseThumbnail(blob)
    },
    async pairs(projectionId, signal) {
      return parsePairs(await request(`/api/pairs${projectionId ? `?${new URLSearchParams({projection: projectionId})}` : ''}`, signal))
    },
    async saveDefinition(body, signal) {
      return parseDefinitionSave(await request('/api/definition', signal, body))
    },
    async scenarios(projectionId, signal) {
      const value = await request(`/api/scenarios?${new URLSearchParams({projection: projectionId})}`, signal)
      assertScenarioList(value)
      return value
    },
    async changes(since, signal) {
      let value
      try {
        value = await next('changes', since, signal)
      } catch (error) {
        if (notFound(error)) return null
        throw error
      }
      return parseChanges(value)
    },
    async document(signal) {
      return parseDocumentResponse(await request('/api/document', signal))
    },
  }
}

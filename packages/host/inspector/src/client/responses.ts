// The runner responses with schemas (`@githubnext/projections-schemas/runner`): each is decoded whole, nested entries
// included, and a mismatch is a `RunnerResponseError` naming the request and the JSON pointer of what doesn't match.
import type {ComparisonDocument, ExtractionDocument} from '@githubnext/projections-schemas'
import {decodeRunnerResponse} from '@githubnext/projections-schemas/runner'
import type {
  ExploreCandidates,
  InspectorDefinitionSave,
  InspectorPairs,
  InspectorWorkspaceChanges,
  OnboardingWrite,
  Sweep,
} from '../types.js'

/** An onboarding (`/api/adopt`) write preview or result. */
export function parseWrite(value: unknown): OnboardingWrite {
  return decodeRunnerResponse('adopt', value)
}

export function parseFixturesGeneration(value: unknown): number {
  return decodeRunnerResponse('fixturesChanges', value).generation
}

export function parseExplore(value: unknown): ExploreCandidates {
  return decodeRunnerResponse('explore', value)
}

export function parseSweepStart(value: unknown): {id: string} {
  return {id: decodeRunnerResponse('sweepStart', value).id}
}

export function parseSweep(value: unknown): Sweep | null {
  return decodeRunnerResponse('sweep', value).sweep
}

export function parseThumbnail(blob: unknown): Blob {
  if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('The local runner returned an invalid thumbnail')
  return blob
}

export function parsePairs(value: unknown): InspectorPairs {
  return decodeRunnerResponse('pairs', value)
}

export function parseDefinitionSave(value: unknown): InspectorDefinitionSave {
  return decodeRunnerResponse('definitionSave', value)
}

export function parseChanges(value: unknown): InspectorWorkspaceChanges {
  return decodeRunnerResponse('changes', value)
}

/** The saved document, whose envelope only is checked here: the runner validated the document when it loaded it. */
export function parseDocumentResponse(value: unknown): ExtractionDocument | ComparisonDocument | null {
  return decodeRunnerResponse('document', value).document
}

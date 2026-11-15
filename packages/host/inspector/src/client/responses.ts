import type {ComparisonDocument, ExtractionDocument} from '@githubnext/projections-schemas'
import type {
  ExploreCandidates,
  InspectorDefinitionSave,
  InspectorPairs,
  InspectorWorkspaceChanges,
  OnboardingWrite,
  Sweep,
} from '../types.js'
import {assertDocument} from './documents.js'
import {record} from './guards.js'

/** Validates an onboarding (`/api/adopt`) write preview. */
export function parseWrite(value: unknown): OnboardingWrite {
  if (!record(value) || !Array.isArray(value.files) || typeof value.digest !== 'string' || typeof value.written !== 'boolean')
    throw new Error('The local runner returned an invalid write preview')
  return value as unknown as OnboardingWrite
}

export function parseFixturesGeneration(value: unknown): number {
  if (!record(value) || !Number.isSafeInteger(value.generation)) throw new Error('The local runner returned an invalid fixtures generation')
  return value.generation as number
}

export function parseExplore(value: unknown): ExploreCandidates {
  if (!record(value) || typeof value.session !== 'boolean' || !Array.isArray(value.candidates))
    throw new Error('The local runner returned invalid explore candidates')
  return value as unknown as ExploreCandidates
}

export function parseSweepStart(value: unknown): {id: string} {
  if (!record(value) || typeof value.id !== 'string') throw new Error('The local runner returned an invalid sweep')
  return {id: value.id}
}

export function parseSweep(value: unknown): Sweep | null {
  if (!record(value)) throw new Error('The local runner returned an invalid sweep')
  const sweep = value.sweep
  if (sweep === null) return null
  if (!record(sweep) || typeof sweep.id !== 'string' || !Array.isArray(sweep.cells) || !Array.isArray(sweep.changes))
    throw new Error('The local runner returned an invalid sweep')
  return sweep as unknown as Sweep
}

export function parseThumbnail(blob: unknown): Blob {
  if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('The local runner returned an invalid thumbnail')
  return blob
}

export function parsePairs(value: unknown): InspectorPairs {
  if (!record(value) || !Array.isArray(value.suggestions) || !record(value.default) || typeof value.default.after !== 'string')
    throw new Error('The local runner returned invalid pairs')
  return value as unknown as InspectorPairs
}

export function parseDefinitionSave(value: unknown): InspectorDefinitionSave {
  if (!record(value) || typeof value.path !== 'string' || typeof value.after !== 'string' || typeof value.digest !== 'string')
    throw new Error('The local runner returned an invalid definition save')
  return value as unknown as InspectorDefinitionSave
}

export function parseChanges(value: unknown): InspectorWorkspaceChanges {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.generation) ||
    typeof value.complete !== 'boolean' ||
    !Array.isArray(value.changes) ||
    value.changes.some(change => typeof change !== 'string')
  )
    throw new Error('The local runner returned invalid working-tree changes')
  return {generation: value.generation as number, changes: value.changes as string[], complete: value.complete}
}

export function parseDocumentResponse(value: unknown): ExtractionDocument | ComparisonDocument | null {
  if (!record(value) || !('document' in value)) throw new Error('The local runner returned an invalid document response')
  if (value.document === null) return null
  assertDocument(value.document)
  return value.document
}

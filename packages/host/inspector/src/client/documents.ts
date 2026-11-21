import type {InspectorJob, InspectorRevisionList, InspectorScenarioList} from '../types.js'
import {record} from './guards.js'

export function assertJob(value: unknown): asserts value is InspectorJob {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !['running', 'completed', 'failed', 'cancelled'].includes(String(value.status)) ||
    !Array.isArray(value.outputs) ||
    !Array.isArray(value.diagnostics)
  )
    throw new Error('The local runner returned an invalid job response')
}
function extractionDocument(value: unknown): boolean {
  return record(value) && value.format === 'projections.extraction' && record(value.projection) && record(value.extraction)
}
export function assertScenarioList(value: unknown): asserts value is InspectorScenarioList {
  if (
    !record(value) ||
    (value.file !== null && typeof value.file !== 'string') ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.some(
      scenario =>
        !record(scenario) ||
        typeof scenario.id !== 'string' ||
        typeof scenario.title !== 'string' ||
        (scenario.description !== undefined && typeof scenario.description !== 'string') ||
        (scenario.error === undefined
          ? !extractionDocument(scenario.after) || (scenario.before !== undefined && !extractionDocument(scenario.before))
          : typeof scenario.error !== 'string'),
    )
  ) {
    throw new Error('The local runner returned invalid scenarios')
  }
}
export function assertRevisionList(value: unknown): asserts value is InspectorRevisionList {
  if (
    !record(value) ||
    !Array.isArray(value.revisions) ||
    value.revisions.some(
      revision =>
        !record(revision) ||
        typeof revision.ref !== 'string' ||
        typeof revision.commit !== 'string' ||
        typeof revision.title !== 'string' ||
        (revision.kind !== undefined && revision.kind !== 'working-tree' && revision.kind !== 'commit') ||
        (revision.dirty !== undefined && typeof revision.dirty !== 'boolean') ||
        (revision.date !== undefined && typeof revision.date !== 'string'),
    )
  ) {
    throw new Error('The local runner returned an invalid revision list')
  }
}

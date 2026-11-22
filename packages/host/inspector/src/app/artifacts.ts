import type {ExtractionChoice} from '@githubnext/projections-host'
import type {InspectorScenario} from '../types.js'
import type {InspectorDocument} from './props.js'
import {revisionKey, revisionLabel} from './revisions.js'

export interface Artifact {
  name: string
  choices: ExtractionChoice[]
  before?: string | undefined
  after: string
  notices?: string[] | undefined
  /** The renderer package scenario it presents, by ID. */
  scenario?: string | undefined
}

/** Extractions from a saved artifact: one extraction, or both sides of a comparison with that pair preselected and its notices. */
export function artifactChoices(document: InspectorDocument): {
  choices: ExtractionChoice[]
  before?: string
  after: string
  notices?: string[]
} {
  if (document.format === 'projections.extraction') {
    return {choices: [{key: revisionKey(document), label: revisionLabel(document), document}], after: revisionKey(document)}
  }
  return {
    choices: [
      {key: 'before', label: `Before · ${revisionLabel(document.before)}`, document: document.before},
      {key: 'after', label: `After · ${revisionLabel(document.after)}`, document: document.after},
    ],
    before: 'before',
    after: 'after',
    ...(document.notices?.length !== undefined && document.notices.length > 0 ? {notices: document.notices} : {}),
  }
}

/** A renderer package scenario presented like a saved artifact: its extraction, or its pair. */
export function scenarioArtifact(scenario: InspectorScenario): Artifact | undefined {
  if (!scenario.after) return undefined
  const choices: ExtractionChoice[] = [
    ...(scenario.before ? [{key: 'scenario-before', label: 'Before', document: scenario.before}] : []),
    {key: 'scenario-after', label: scenario.before ? 'After' : scenario.title, document: scenario.after},
  ]
  return {
    name: scenario.title,
    choices,
    before: scenario.before ? 'scenario-before' : undefined,
    after: 'scenario-after',
    scenario: scenario.id,
  }
}

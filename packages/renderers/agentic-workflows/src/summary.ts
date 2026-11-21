import type {SummaryFactContext, SummaryFactItem, SummaryNouns} from '@githubnext/projections-renderer-kit'
import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import {findingsOf} from './model.js'

const noun = (singular: string, plural: string = singular) => ({singular, plural})

/** The summary bar's words: workflows and groups, and the workflows one dispatches; membership is structure. */
export const agenticWorkflowsNouns: SummaryNouns = {
  workflow: noun('workflow', 'workflows'),
  group: noun('group', 'groups'),
  'relationships:dispatches': noun('dispatch', 'dispatches'),
  contains: false,
}

/** The comparator's warnings the summary counts, most severe first, with their icons and words (`1 gate removed`). */
export const warningLabels = [
  {id: 'gate-removed', noun: noun('gate removed', 'gates removed')},
  {id: 'repos-widened', noun: noun('repository scope widened', 'repository scopes widened')},
  {id: 'permissions-widened', noun: noun('permissions widened')},
  {id: 'bash-widened', noun: noun('bash widened')},
  {id: 'network-widened', noun: noun('network widened')},
  {id: 'outputs-widened', noun: noun('outputs widened')},
  {id: 'tools-widened', noun: noun('tools widened')},
  {id: 'secrets-added', noun: noun('more secrets')},
  {id: 'strict-disabled', noun: noun('strict mode off')},
  {id: 'triggers-widened', noun: noun('more triggers')},
  {id: 'budget-raised', noun: noun('budget raised', 'budgets raised')},
] as const

/** The view control: workflow cards, or the matrix of workflows against capabilities. */
export const agenticWorkflowsControls = defineControls([
  {
    id: 'view',
    label: 'View',
    description: 'A card per workflow, or a matrix of workflows against what they load, use, write and reach',
    type: 'choice',
    default: 'cards',
    choices: [
      {value: 'cards', label: 'Cards'},
      {value: 'matrix', label: 'Matrix'},
    ],
  },
])

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/**
 * The summary bar's facts: how many lock files are stale or missing (in every view, each filtering to its
 * workflows), then what the agentic-workflows comparator found widened, most severe first (`1 gate removed`,
 * `2 network widened`).
 */
export function agenticWorkflowsFacts({init, model}: SummaryFactContext): SummaryFactItem[] {
  const stale = model.entities.filter(row => {
    const status = record(record(row.after?.data).lock).status
    return row.after?.kind === 'workflow' && (status === 'stale' || status === 'missing')
  })
  const facts: SummaryFactItem[] = []
  if (stale.length) {
    facts.push({
      type: 'fact',
      id: 'lock-stale',
      icon: 'warning',
      count: stale.length,
      noun: noun('lock file out of date', 'lock files out of date'),
      ids: stale.map(row => row.id),
    })
  }
  const findings = init.mode === 'comparison' ? findingsOf(init.comparison.metadata) : undefined
  for (const label of warningLabels) {
    const ids = [...(findings ?? [])].filter(([, found]) => found.some(finding => finding.name === label.id)).map(([id]) => id)
    if (ids.length) facts.push({type: 'fact', id: label.id, icon: 'warning', count: ids.length, noun: label.noun, ids})
  }
  return facts
}

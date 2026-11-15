import {summaryChange} from '@githubnext/projections-renderer-kit'
import type {SummaryFactContext, SummaryFactItem, SummaryNouns} from '@githubnext/projections-renderer-kit'
import {findingLabels, interpretationsOf, isEnforcing} from './model.js'

const noun = (singular: string, plural: string) => ({singular, plural})

/**
 * The summary bar's words: policies, hooks and their rules (`selector`s), with the deployment's workloads, kernel
 * profiles and agent configuration. A probe is a policy's attachment to a hook, drawn as the policy's row in the hook's
 * lane, and a subject is a chip inside a rule; the relationships that place them are structure, not figures.
 */
export const runtimePolicyNouns: SummaryNouns = {
  policy: noun('policy', 'policies'),
  hook: noun('hook', 'hooks'),
  selector: noun('rule', 'rules'),
  workload: noun('workload', 'workloads'),
  kernel: noun('kernel profile', 'kernel profiles'),
  agent: noun('agent configuration', 'agent configurations'),
  probe: false,
  subject: false,
  attaches: false,
  covers: false,
  declares: false,
  filters: false,
  'applies-to': false,
  matches: false,
  excludes: false,
}

/**
 * The summary bar's security facts: how many rules enforce (in every view, with the change since Before in a
 * comparison), then what the runtime policy comparator found, most severe first, each filtering to the changes it
 * names (`1 newly enforced`, `1 scope broadened`, `1 hook no longer covered`).
 */
export function runtimePolicyFacts({init, model}: SummaryFactContext): SummaryFactItem[] {
  const enforcing = model.entities.filter(row => isEnforcing(row.after))
  const was = init.mode === 'comparison' ? model.entities.filter(row => isEnforcing(row.before)).length : undefined
  const facts: SummaryFactItem[] = [
    {
      type: 'fact',
      id: 'enforcing',
      count: enforcing.length,
      noun: noun('enforcing rule', 'enforcing rules'),
      ...(enforcing.length ? {ids: enforcing.map(row => row.id)} : {}),
      ...summaryChange(was, enforcing.length),
    },
  ]
  const interpretations = init.mode === 'comparison' ? interpretationsOf(init.comparison.metadata) : undefined
  for (const label of findingLabels) {
    const ids = [...(interpretations ?? [])].filter(([, names]) => names.includes(label.id)).map(([id]) => id)
    if (ids.length) facts.push({type: 'fact', id: label.id, icon: label.icon, count: ids.length, noun: label.noun, ids})
  }
  return facts
}

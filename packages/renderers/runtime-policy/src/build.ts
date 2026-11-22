import type {Entity} from '@githubnext/projections-schemas'
import {compareIds, type ComparisonModel} from '@githubnext/projections-renderer-kit'
import {attachProbes, chipsOf} from './placement.js'
import {itemsOf, links, type Context} from './links.js'
import {
  categories,
  interpretationsOf,
  isEnforcing,
  byLabel,
  collator,
  text,
  type CategoryView,
  type HookItem,
  type Item,
  type PolicyItem,
  type Revision,
  type RuntimePolicyModel,
  type Side,
  type Tally,
  type WorkloadItem,
} from './model.js'

const known = (hook: Item) => categories.some(category => category.id === text(hook.entity.data?.category))

/** Hooks grouped by category, in the categories' order; empty categories are left out. */
function groupHooks(hooks: Map<string, HookItem>): CategoryView[] {
  return categories
    .map(category => ({
      ...category,
      hooks: [...hooks.values()]
        .filter(hook => (text(hook.entity.data?.category) ?? 'other') === category.id || (category.id === 'other' && !known(hook)))
        .sort(byLabel),
    }))
    .filter(category => category.hooks.length > 0)
}

/** The counts the summary states, in the presented revision and, in a comparison, the before one. */
function countsOf(model: ComparisonModel, side: Side): RuntimePolicyModel['counts'] {
  const tally = (test: (entity: Entity) => boolean): Tally => {
    const count = (revision: Revision) => model.entities.filter(row => row[revision] && test(row[revision])).length
    const now = count(side === 'before' ? 'before' : 'after')
    return {now, was: side === 'diff' ? count('before') : now}
  }
  return {
    policies: tally(entity => entity.kind === 'policy'),
    hooks: tally(entity => entity.kind === 'hook'),
    rules: tally(entity => entity.kind === 'selector'),
    enforcing: tally(entity => entity.kind === 'selector' && isEnforcing(entity)),
  }
}

/**
 * The comparison (or extraction) as policies and hook lanes. Hooks are grouped
 * by category; each holds the probes that attach to it, by policy, and each
 * probe its selectors in order. Identity comes only from the comparison.
 */
export function buildModel(model: ComparisonModel, side: Side, metadata?: unknown): RuntimePolicyModel {
  const interpretations = interpretationsOf(metadata)
  const context: Context = {
    model,
    side,
    sides: {before: links(model, 'before'), after: links(model, 'after')},
    items: itemsOf(model, side, interpretations),
  }
  const hooks = new Map<string, HookItem>()
  const policies: PolicyItem[] = []
  const deployment: Item[] = []
  const workloads: WorkloadItem[] = []
  for (const item of context.items.values()) {
    const kind = item.entity.kind
    if (kind === 'hook') hooks.set(item.row.id, {...item, probes: []})
    else if (kind === 'policy') policies.push({...item, scope: chipsOf(context, item)})
    else if (kind === 'agent' || kind === 'kernel') deployment.push(item)
    else if (kind === 'workload') workloads.push({...item, coveredBy: chipsOf(context, item, 'coveredBy')})
  }
  deployment.sort((a, b) => Number(a.entity.kind === 'kernel') - Number(b.entity.kind === 'kernel') || byLabel(a, b))
  const place = (item: Item) => `${text(item.entity.data?.namespace) ?? ''}/${item.entity.label}`
  workloads.sort((a, b) => collator.compare(place(a), place(b)) || compareIds(a.row.id, b.row.id))
  attachProbes(context, hooks)
  const grouped = groupHooks(hooks)
  policies.sort(byLabel)

  const findings = new Map<string, number>()
  for (const names of interpretations?.values() ?? []) for (const name of names) findings.set(name, (findings.get(name) ?? 0) + 1)
  return {
    side,
    policies,
    deployment,
    workloads,
    categories: grouped,
    counts: countsOf(model, side),
    findings,
    interpreted: interpretations !== undefined,
  }
}

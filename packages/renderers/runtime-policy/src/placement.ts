import {compareIds} from '@githubnext/projections-renderer-kit'
import {placed} from './links.js'
import type {Context} from './links.js'
import {collator} from './model.js'
import type {Chip, ChipChange, HookItem, Item, ProbeItem, Revision} from './model.js'

/** An item's chips: the subjects its relationships reach, each arriving, leaving or staying. */
export function chipsOf({model, side, sides, items}: Context, item: Item, source: 'chips' | 'coveredBy' = 'chips'): Chip[] {
  const revisions: Revision[] = side === 'diff' ? ['before', 'after'] : [side]
  const chips = new Map<string, Chip>()
  // A chip's subject is at the relationship's far end: `to` for chips, `from` for covering policies.
  const end = source === 'chips' ? 'to' : 'from'
  for (const revision of revisions) {
    if (!item.row[revision]) continue
    for (const {row, relationship, to} of sides[revision][source].get(item.row.id) ?? []) {
      const subject = items.get(to)
      if (!subject) continue
      const other: Revision = revision === 'before' ? 'after' : 'before'
      const counterpart = row[other]
      const kept = side !== 'diff' || (counterpart && model.entityRow[other].get(counterpart[end]) === to && item.row[other] !== undefined)
      const change: ChipChange = kept ? 'unchanged' : revision === 'before' ? 'removed' : 'added'
      const key = `${row.id}|${to}`
      if (!chips.has(key)) chips.set(key, {key, subject, kind: relationship.kind, data: relationship.data, change})
    }
  }
  return [...chips.values()].toSorted(
    (a, b) =>
      Number(a.change === 'added') - Number(b.change === 'added') ||
      collator.compare(a.subject.entity.label, b.subject.entity.label) ||
      compareIds(a.key, b.key),
  )
}

/** Places probes on their hooks and selectors in their probes, each in order. */
export function attachProbes(context: Context, hooks: Map<string, HookItem>) {
  const probes = new Map<string, ProbeItem>()
  for (const item of context.items.values()) {
    if (item.entity.kind !== 'probe') continue
    const links = placed(context, item)
    const probe: ProbeItem = {...item, policy: context.items.get(links.policyOf.get(item.row.id) ?? ''), selectors: []}
    probes.set(item.row.id, probe)
    hooks.get(links.hookOf.get(item.row.id) ?? '')?.probes.push(probe)
  }
  for (const item of context.items.values()) {
    if (item.entity.kind !== 'selector') continue
    probes.get(placed(context, item).probeOf.get(item.row.id) ?? '')?.selectors.push({...item, chips: chipsOf(context, item)})
  }
  const ordinal = (item: Item) => (typeof item.entity.data?.ordinal === 'number' ? item.entity.data.ordinal : 0)
  for (const probe of probes.values()) probe.selectors.sort((a, b) => ordinal(a) - ordinal(b) || compareIds(a.row.id, b.row.id))
  for (const hook of hooks.values()) {
    hook.probes.sort(
      (a, b) => collator.compare(a.policy?.entity.label ?? '', b.policy?.entity.label ?? '') || compareIds(a.row.id, b.row.id),
    )
  }
}

import type {ComparisonModel, StatusPart, SummaryFactItem} from '@githubnext/projections-renderer-kit'
import {actionPart, infrastructureStatus, plannedAction} from './resources.js'

/** The words of a plan summary for each planned action, in Terraform's plan order. */
const planWords: {label: string; words: string}[] = [
  {label: 'Import', words: 'to import'},
  {label: 'Create', words: 'to add'},
  {label: 'Update in place', words: 'to change'},
  {label: 'Redeploy', words: 'to redeploy'},
  {label: 'Replace', words: 'to replace'},
  {label: 'Replace, create first', words: 'to replace'},
  {label: 'Read', words: 'to read'},
  {label: 'Destroy', words: 'to destroy'},
  {label: 'Forget', words: 'to forget'},
  {label: 'Moved', words: 'to move'},
]

/**
 * The summary bar's plan facts: how many resources each planned action touches, in Terraform's plan order and words
 * (`2 to add`, `3 to change`, `1 to replace`, `1 to destroy`), each with its action's icon and filtering to its
 * resources. In a comparison a row's action is its change worded as the cards word it (`infrastructureStatus`); in
 * one revision, the action each resource is planned with (`data.action`), as a plan's own summary line counts them.
 * Modules and resource groups are boundaries, not resources, so they are not counted.
 */
export function planFacts(model: ComparisonModel): SummaryFactItem[] {
  const counts = new Map<string, {icon: StatusPart['icon']; ids: string[]}>()
  for (const row of model.entities) {
    const entity = (row.after ?? row.before)!
    if (entity.kind === 'module' || entity.kind === 'resource-group') continue
    const parts =
      model.mode === 'comparison'
        ? infrastructureStatus(row)
        : [actionPart(plannedAction(row.after) ?? '', row.after)].filter(part => part !== undefined)
    for (const part of parts) {
      const words = planWords.find(item => item.label === part.label)?.words ?? part.label.toLowerCase()
      const entry = counts.get(words) ?? {icon: part.icon, ids: []}
      entry.ids.push(row.id)
      counts.set(words, entry)
    }
  }
  const order = [...new Set(planWords.map(item => item.words))]
  return [...counts]
    .toSorted(([a], [b]) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1) || a.localeCompare(b))
    .map(([words, {icon, ids}]) => ({
      type: 'fact' as const,
      id: words.replaceAll(' ', '-'),
      icon,
      count: ids.length,
      noun: {singular: words, plural: words},
      ids,
    }))
}

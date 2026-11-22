// The summary bar's warning about card icons the graph renderer doesn't draw.
import {isCardIconName, type ComparisonModel, type SummaryFactItem} from '@githubnext/projections-renderer-kit'
import type {ControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import {pointerField} from './fields.js'

/**
 * The summary bar's warning when the **Icon** control's field names an icon outside `cardIconNames` on some cards:
 * how many, filtering to them, and which names, as its description. Those cards draw no icon; nothing else changes.
 * Nothing when every name is known, or no field is chosen.
 */
export function unknownIconFacts(model: ComparisonModel, icon: ControlValue | undefined): SummaryFactItem[] {
  const field = typeof icon === 'string' ? pointerField(icon) : undefined
  if (field === undefined) return []
  const ids: string[] = []
  const names = new Set<string>()
  for (const row of model.entities) {
    const unknown = [row.before, row.after]
      .map(entity => entity?.data?.[field])
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '' && !isCardIconName(value))
    if (!unknown.length) continue
    ids.push(row.id)
    for (const name of unknown) names.add(name)
  }
  if (!ids.length) return []
  const listed = [...names].toSorted().map(name => JSON.stringify(name.slice(0, 40)))
  const shown = listed.length > 5 ? [...listed.slice(0, 5), `${listed.length - 5} more`] : listed
  return [
    {
      type: 'fact',
      id: 'unknown-icons',
      icon: 'warning',
      count: ids.length,
      noun: {singular: 'unknown icon', plural: 'unknown icons'},
      ids,
      description: `No icon is drawn for ${shown.join(', ')}: ${field} must name one of the graph renderer's card icons.`,
    },
  ]
}

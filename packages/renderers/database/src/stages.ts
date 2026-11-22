import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel, StagedTimeline, StepWindows} from '@githubnext/projections-renderer-kit'
import {buildModel} from './schema-model.js'
import type {SchemaLayout, SchemaModel, SchemaState} from './schema.js'
import {fader} from './fading.js'

/** Each stage's state and model, and every row: enum values are rows of their enum's card, added, removed or kept. */
export function stagedModels(model: ComparisonModel, timeline: StagedTimeline) {
  const rows = new Map<string, EntityChange<Entity>>(model.entities.map(row => [row.id, row]))
  const states: SchemaState[] = timeline.stages.map(stage => ({
    entities: new Map([...stage.active].map(id => [id, timeline.version(rows.get(id)!, stage)])),
    relationships: timeline.relationships(stage).map(({row, from, to}) => {
      const side = timeline.version(row, stage)
      return {id: row.id, kind: side.kind, from, to, data: side.data}
    }),
  }))
  const models = states.map(buildModel)
  // Enum values are rows of their enum's card, not entities: each is added, removed or kept across the comparison.
  const owner = new Map<string, string>()
  for (const stage of models) for (const [card, ids] of stage.columns) for (const id of ids) if (stage.values.has(id)) owner.set(id, card)
  for (const id of owner.keys()) {
    const value = models.map(stage => stage.values.get(id)).find(Boolean)!
    const entity: Entity = {id, kind: 'enum-value', label: value}
    const first = models[0]!.values.has(id),
      final = models.at(-1)!.values.has(id)
    rows.set(id, {
      id,
      status: first && final ? 'unchanged' : first ? 'removed' : final ? 'added' : 'unchanged',
      ...(first || !final ? {before: entity} : {}),
      ...(final || !first ? {after: entity} : {}),
    })
  }
  return {rows, states, models, owner}
}

export const columnKey = (table: string, column: string) => `${table}\u0000${column}`

/** How each card, row and link fades in and out over the comparison's steps. */
export function fades(
  models: readonly SchemaModel[],
  layouts: readonly SchemaLayout[],
  windows: readonly StepWindows[],
  showLinks: boolean,
) {
  const last = layouts.length - 1
  const tableIds = [...new Set([...layouts[last]!.tables.keys(), ...layouts.flatMap(layout => [...layout.tables.keys()])])]
  const tableFade = new Map(
    tableIds.map(id => [
      id,
      fader(
        layouts.map(layout => layout.tables.has(id)),
        windows,
      ),
    ]),
  )
  const tableExists = new Map(tableIds.map(id => [id, layouts.map(layout => layout.tables.has(id))]))
  const columnFade = new Map<string, (t: number) => number>()
  for (const table of tableIds) {
    const exists = tableExists.get(table)!
    const columns = new Set(models.flatMap(stage => stage.columns.get(table) ?? []))
    // Rows of an entering or leaving card follow the card itself.
    for (const column of columns) {
      columnFade.set(
        columnKey(table, column),
        fader(
          models.map(stage => stage.columns.get(table)?.includes(column) ?? false),
          windows,
          step => !exists[step] || !exists[step + 1],
          exists.indexOf(true),
        ),
      )
    }
  }
  const linkKeys = showLinks ? [...new Set(models.flatMap(stage => stage.links.map(link => link.key)))].toSorted(compareIds) : []
  const linkFade = new Map(
    linkKeys.map(key => [
      key,
      fader(
        models.map(stage => stage.links.some(link => link.key === key)),
        windows,
      ),
    ]),
  )
  return {tableIds, tableFade, columnFade, linkKeys, linkFade}
}

/** Tag rows (keys, indexes, other entities) in presentation order for each stage, and every tag any stage shows. */
export function tagOrder(states: readonly SchemaState[], models: readonly SchemaModel[]) {
  const last = models.length - 1
  const tagLabel = (id: string, stage: number) => states[stage]!.entities.get(id)!.label
  const tagStages = models.map((stage, index) =>
    stage.others
      .toSorted(
        (a, b) =>
          compareIds(states[index]!.entities.get(a)!.kind, states[index]!.entities.get(b)!.kind) ||
          compareIds(tagLabel(a, index), tagLabel(b, index)) ||
          compareIds(a, b),
      )
      .map(id => ({id, label: tagLabel(id, index)})),
  )
  const tagIds = [...new Set([...tagStages[last]!, ...tagStages.flat()].map(tag => tag.id))]
  return {tagStages, tagIds}
}

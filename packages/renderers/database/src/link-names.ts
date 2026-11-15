import type {FrameLink, SchemaFrame} from './frame.js'

/** Each link's accessible name, from the labels of the cards and columns it joins in this frame. */
export function linkNamer(frame: SchemaFrame) {
  const labels = new Map(
    frame.tables.flatMap(table => [
      [table.change.id, table.entity.label] as const,
      ...table.columns.map(column => [column.change.id, `${table.entity.label}.${column.entity.label}`] as const),
    ]),
  )
  const name = (id: string) => labels.get(id) ?? id
  return (link: FrameLink) =>
    link.type === 'enum'
      ? `Column ${name(link.dependentColumn ?? link.dependent)} uses enum ${name(link.principal)}`
      : link.type === 'many-to-many'
        ? `Many-to-many relationship between ${name(link.dependent)} and ${name(link.principal)}`
        : `Relationship from ${labels.get(link.dependentColumn ?? link.dependent) ?? labels.get(link.dependent) ?? link.dependent}` +
          ` to ${labels.get(link.principalColumn ?? link.principal) ?? labels.get(link.principal) ?? link.principal}`
}

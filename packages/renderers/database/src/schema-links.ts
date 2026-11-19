import {compareIds, isFold} from '@githubnext/projections-renderer-kit'
import type {SchemaColumnRole, SchemaLink, SchemaMarker, SchemaState} from './schema.js'
import {isEnum, names} from './vocabulary.js'
import type {Cards} from './schema-model.js'

/** Foreign-key, enum and many-to-many links between cards, in key order, and the columns that are foreign keys. */
export function linksOf(state: SchemaState, {nodes, tableSet, tableOf, columnNamed}: Cards) {
  const links = new Map<string, SchemaLink>()
  const foreign = new Set<string>()
  const addLink = (
    relationship: string,
    dependent: string,
    principal: string,
    dependentColumn?: string,
    principalColumn?: string,
    type?: SchemaLink['type'],
  ) => {
    if (!tableSet.has(dependent) || !tableSet.has(principal)) return
    if (dependentColumn && !type) foreign.add(dependentColumn)
    const link: SchemaLink = {
      // Two tables can share several many-to-many relations (Prisma names each), so each is its own link.
      key:
        type === 'many-to-many'
          ? `${dependent}<->${principal}:${relationship}`
          : `${dependentColumn ?? dependent}->${principalColumn ?? principal}`,
      relationship,
      dependent,
      principal,
      ...(type ? {type} : {}),
      ...(dependentColumn ? {dependentColumn} : {}),
      ...(principalColumn ? {principalColumn} : {}),
    }
    links.set(link.key, link)
  }
  for (const edge of state.relationships) {
    if (isEnum(nodes.get(edge.to)) && (tableOf.has(edge.from) || tableSet.has(edge.from))) {
      // A column typed by an enum links to the enum's card.
      if (tableOf.has(edge.from)) addLink(edge.id, tableOf.get(edge.from)!, edge.to, edge.from, undefined, 'enum')
      continue
    }
    if (edge.kind === 'many-to-many') {
      addLink(edge.id, edge.from, edge.to, undefined, undefined, 'many-to-many')
      continue
    }
    if (edge.kind !== 'foreign-key' && edge.kind !== 'relation') continue
    if (tableOf.has(edge.from) && tableOf.has(edge.to)) addLink(edge.id, tableOf.get(edge.from)!, tableOf.get(edge.to)!, edge.from, edge.to)
    else if (tableSet.has(edge.from) && tableSet.has(edge.to)) {
      const local = names(edge.data?.columns)
      const remote = names(edge.data?.principalColumns)
      if (!local.length) addLink(edge.id, edge.from, edge.to)
      local.forEach((name, index) =>
        addLink(
          edge.id,
          edge.from,
          edge.to,
          columnNamed(edge.from, name),
          remote[index] === undefined ? undefined : columnNamed(edge.to, remote[index]!),
        ),
      )
    }
  }
  return {links: [...links.values()].sort((a, b) => compareIds(a.key, b.key)), foreign}
}

/** Each table's columns, keys first, and each key column's role and marker. */
export function columnMarkers(
  {nodes, tables, columnsOf}: Cards,
  primary: ReadonlySet<string>,
  singlePrimary: ReadonlySet<string>,
  foreign: ReadonlySet<string>,
) {
  const roles = new Map<string, SchemaColumnRole>()
  const markers = new Map<string, SchemaMarker>()
  const ordered = new Map<string, string[]>()
  for (const table of tables) {
    // Keys first, then the other columns, and last the fold of those the Changes scope leaves out.
    const rank = (id: string) => (isFold(id) ? 3 : primary.has(id) ? 0 : foreign.has(id) ? 1 : 2)
    const columns = [...columnsOf.get(table)!].sort(
      (a, b) => rank(a) - rank(b) || compareIds(nodes.get(a)!.label, nodes.get(b)!.label) || compareIds(a, b),
    )
    ordered.set(table, columns)
    for (const id of columns) {
      const role = primary.has(id) ? (foreign.has(id) ? 'pk-fk' : 'pk') : foreign.has(id) ? 'fk' : undefined
      if (!role) continue
      roles.set(id, role)
      // A column in a composite primary key that is also a foreign key reads as FK: the composite key has its own row.
      const label = role === 'pk' || (role === 'pk-fk' && singlePrimary.has(id)) ? 'PK' : 'FK'
      markers.set(id, {label, title: role === 'pk-fk' ? 'Primary and foreign key' : role === 'pk' ? 'Primary key' : 'Foreign key'})
    }
  }
  return {roles, markers, ordered}
}

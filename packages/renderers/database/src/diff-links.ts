// Diff mode's links: every relationship of either revision, linked on the union's layout with its change status.
import {classifyChange, type ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {SchemaLayout} from './schema.js'
import {linkEnds, linkPortOffsets, linkTracks} from './links.js'
import type {FrameLink} from './frame.js'
import type {Analysis} from './diff-states.js'

/** Every link of either revision, with its status, spread over its rows' ports and drafted on its own track. */
export function diffLinks(model: ComparisonModel, {before, after, union}: Analysis, layout: SchemaLayout, showLinks: boolean): FrameLink[] {
  const mode = layout.mode
  const beforeKeys = new Set(before.links.map(link => link.key)),
    afterKeys = new Set(after.links.map(link => link.key))
  const relationships = new Map(model.relationships.map(row => [row.id, row]))
  const links: FrameLink[] = (showLinks ? union.links : []).map(link => {
    const ends = linkEnds(
      link,
      layout.tables.get(link.dependent)!,
      layout.tables.get(link.principal)!,
      link.dependentColumn === undefined ? undefined : layout.offsets.get(link.dependentColumn),
      link.principalColumn === undefined ? undefined : layout.offsets.get(link.principalColumn),
      mode,
      layout.headers.get(link.dependent)!,
      layout.headers.get(link.principal)!,
    )
    const was = beforeKeys.has(link.key),
      now = afterKeys.has(link.key)
    const relationship = relationships.get(link.relationship)
    const status: FrameLink['status'] =
      was && now ? (relationship && classifyChange(relationship) === 'modified' ? 'modified' : 'unchanged') : was ? 'removed' : 'added'
    return {
      ...link,
      shape: ends.shape,
      points: [ends.start, ...(ends.loop ?? layout.routes.get(link.key) ?? []), ends.end],
      sides: ends.sides,
      tracks: [] as number[],
      opacity: 1,
      status,
    }
  })
  // Links meeting one row on one side spread over it, in the order they come from (see `linkPortOffsets`).
  const room = (table: string, column: string | undefined, y: number) => {
    const box = layout.tables.get(table)!
    return 2 * (y - (column === undefined ? box.y : box.y + (layout.offsets.get(column) ?? 0)))
  }
  const ports = linkPortOffsets(
    links.flatMap(link => {
      const first = link.points[0]!,
        last = link.points.at(-1)!
      return [
        {
          key: link.key,
          end: 'from' as const,
          group: `${link.dependent}\u0000${link.dependentColumn ?? ''}\u0000${link.sides[0]}`,
          approach: link.points[1]!.y,
          room: room(link.dependent, link.dependentColumn, first.y),
        },
        {
          key: link.key,
          end: 'to' as const,
          group: `${link.principal}\u0000${link.principalColumn ?? ''}\u0000${link.sides[1]}`,
          approach: link.points.at(-2)!.y,
          room: room(link.principal, link.principalColumn, last.y),
        },
      ]
    }),
  )
  for (const link of links) {
    const offsets = ports.get(link.key)
    if (!offsets) continue
    const [first, last] = [link.points[0]!.y, link.points.at(-1)!.y]
    // Ends move to their ports; a self link's loop or a gutter lane runs between them, wherever they are.
    const lane = link.points.length === 4 && (link.shape === 'orthogonal' || link.dependent === link.principal)
    link.points = link.points.map((point, index) =>
      index === 0 || (lane && index === 1 && point.y === first)
        ? {x: point.x, y: point.y + offsets.from}
        : index === link.points.length - 1 || (lane && index === 2 && point.y === last)
          ? {x: point.x, y: point.y + offsets.to}
          : point,
    )
  }
  // The union's links between ranks share gaps as a revision's do: the same drafted S's, on separate tracks.
  const tracks = linkTracks(
    links
      .filter(link => link.shape === 'curved')
      .map(link => ({key: link.key, points: link.points, axis: {x: link.sides[0] === 'left' ? -1 : 1, y: 0}})),
  )
  for (const link of links) link.tracks = tracks.get(link.key) ?? []
  return links
}

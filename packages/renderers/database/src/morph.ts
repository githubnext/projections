import {lerp, lerpBox, smooth} from './fading.js'
import type {FrameColumn, FrameLink, FrameTable, SchemaFrame} from './frame.js'
import {sideX} from './links.js'
import type {SchemaBox, SchemaPoint} from './schema.js'

/** How present something only one frame has is: what leaves fades out as the move starts, what arrives fades in as it settles. */
const leaving = (mix: number) => 1 - smooth(mix * 2)
const arriving = (mix: number) => smooth(mix * 2 - 1)

const lerpPoint = (a: SchemaPoint, b: SchemaPoint, mix: number): SchemaPoint => ({x: lerp(a.x, b.x, mix), y: lerp(a.y, b.y, mix)})

/** Each card's box and its rows' tops: where a link's ends are attached. */
type Places = Map<string, {box: SchemaBox; tops: Map<string, number>}>

function places(tables: readonly FrameTable[]): Places {
  return new Map(
    tables.map(table => [table.change.id, {box: table.box, tops: new Map(table.columns.map(row => [row.change.id, row.top]))}]),
  )
}

/** A card's rows between two layouts: rows both have move, rows only one has fade, never more present than the card has room. */
function morphColumns(from: readonly FrameColumn[], to: readonly FrameColumn[], mix: number, height: number): FrameColumn[] {
  const before = new Map(from.map(row => [row.change.id, row]))
  const after = new Set(to.map(row => row.change.id))
  const room = (row: FrameColumn) => Math.max(0, Math.min(1, (height - row.top) / row.height))
  return [
    ...to.map(row => {
      const old = before.get(row.change.id)
      if (!old) return {...row, opacity: row.opacity * arriving(mix) * room(row)}
      return {
        ...row,
        top: lerp(old.top, row.top, mix),
        height: lerp(old.height, row.height, mix),
        opacity: lerp(old.opacity, row.opacity, mix),
      }
    }),
    ...from.filter(row => !after.has(row.change.id)).map(row => ({...row, opacity: row.opacity * leaving(mix) * room(row)})),
  ]
}

/**
 * A schema frame between two layouts of it (before and after a change of scope or a fold opening): cards and rows move
 * from their old places to their new ones, and every link stays attached to the rows it joins while they move. Only
 * what one layout has fades: a card, row or link the change adds or removes. `mix` runs from 0 (`from`) to 1 (`to`).
 */
export function morphSchemaFrame(from: SchemaFrame, to: SchemaFrame, mix: number): SchemaFrame {
  if (mix >= 1) return to
  const before = new Map(from.tables.map(table => [table.change.id, table]))
  const after = new Set(to.tables.map(table => table.change.id))
  const tables: FrameTable[] = [
    ...to.tables.map(table => {
      const old = before.get(table.change.id)
      if (!old) return {...table, opacity: table.opacity * arriving(mix)}
      const box = lerpBox(old.box, table.box, mix)
      return {
        ...table,
        box,
        header: lerp(old.header, table.header, mix),
        opacity: lerp(old.opacity, table.opacity, mix),
        columns: morphColumns(old.columns, table.columns, mix, box.height),
      }
    }),
    ...from.tables.filter(table => !after.has(table.change.id)).map(table => ({...table, opacity: table.opacity * leaving(mix)})),
  ]
  const placed = {from: places(from.tables), to: places(to.tables), now: places(tables)}
  // A link's end where it is in its own layout, carried along with its card and row to where they are now.
  const attach = (point: SchemaPoint, side: 'left' | 'right', table: string, row: string | undefined, own: Places): SchemaPoint => {
    const then = own.get(table),
      now = placed.now.get(table)
    if (!then || !now) return point
    const top = (place: NonNullable<typeof then>) => place.box.y + (row === undefined ? 0 : (place.tops.get(row) ?? 0))
    return {x: point.x + sideX(now.box, side) - sideX(then.box, side), y: point.y + top(now) - top(then)}
  }
  const ends = (link: FrameLink, own: Places) => [
    attach(link.points[0]!, link.sides[0], link.dependent, link.dependentColumn, own),
    attach(link.points.at(-1)!, link.sides[1], link.principal, link.principalColumn, own),
  ]
  // A route's waypoints carried along with its ends: each by its ends' shifts, weighted by how near it is to each.
  const carried = (link: FrameLink, start: SchemaPoint, end: SchemaPoint): SchemaPoint[] => {
    const points = link.points
    const first = points[0]!,
      last = points.at(-1)!
    const interior = points.slice(1, -1).map((point, index) => {
      const share = (index + 1) / (points.length - 1)
      return {
        x: point.x + (start.x - first.x) * (1 - share) + (end.x - last.x) * share,
        y: point.y + (start.y - first.y) * (1 - share) + (end.y - last.y) * share,
      }
    })
    return [start, ...interior, end]
  }
  const old = new Map(from.links.map(link => [link.key, link]))
  const kept = new Set(to.links.map(link => link.key))
  const links: FrameLink[] = [
    ...to.links.map(link => {
      const was = old.get(link.key)
      const [startTo, endTo] = ends(link, placed.to)
      if (!was) return {...link, points: carried(link, startTo!, endTo!), opacity: link.opacity * arriving(mix)}
      const [startFrom, endFrom] = ends(was, placed.from)
      // Each end between where it was and where it goes on its moving row, unless it changes sides: then on its new side.
      const start = was.sides[0] === link.sides[0] ? lerpPoint(startFrom!, startTo!, mix) : startTo!
      const end = was.sides[1] === link.sides[1] ? lerpPoint(endFrom!, endTo!, mix) : endTo!
      const alike =
        was.shape === link.shape &&
        was.points.length === link.points.length &&
        was.sides[0] === link.sides[0] &&
        was.sides[1] === link.sides[1]
      const points = alike
        ? [start, ...link.points.slice(1, -1).map((point, index) => lerpPoint(was.points[index + 1]!, point, mix)), end]
        : carried(link, start, end)
      const tracks =
        alike && was.tracks.length === link.tracks.length
          ? link.tracks.map((track, index) => lerp(was.tracks[index]!, track, mix))
          : link.tracks
      return {...link, points, tracks, opacity: lerp(was.opacity, link.opacity, mix)}
    }),
    ...from.links
      .filter(link => !kept.has(link.key))
      .map(link => {
        const [start, end] = ends(link, placed.from)
        return {...link, points: carried(link, start!, end!), opacity: link.opacity * leaving(mix)}
      }),
  ]
  return {...to, width: lerp(from.width, to.width, mix), height: lerp(from.height, to.height, mix), tables, links}
}

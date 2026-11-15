import {compareIds, portSpacing, routeTracks, spreadPorts} from '@githubnext/projections-renderer-kit'
import {anchorY} from './geometry.js'
import {schemaMetrics} from './schema.js'
import type {SchemaBox, SchemaLayout, SchemaLayoutMode, SchemaLink, SchemaModel, SchemaPoint} from './schema.js'
import type {FrameLink} from './frame.js'

export const selfLoop = 20
/** Room along a gap below which a link's S fades (fully gone at half of it): a table moving into a gap never bends a link backwards. */
export const turnRoom = 32

/**
 * Where a link leaves its dependent row and enters its principal row (or a
 * card's header, without a row offset), on which sides, and its shape. A
 * self-link in columns loops out to the card's right; `loop` is its route.
 */
export function linkEnds(
  link: SchemaLink,
  source: SchemaBox,
  target: SchemaBox,
  fromTop: number | undefined,
  toTop: number | undefined,
  mode: SchemaLayoutMode,
  fromHeader: number,
  toHeader: number,
): {start: SchemaPoint; end: SchemaPoint; sides: FrameLink['sides']; shape: FrameLink['shape']; loop?: SchemaPoint[]} {
  // A link meets a row's (or header's) first line, however tall the row grows.
  const fromY = anchorY(source, fromTop, fromHeader)
  const toY = anchorY(target, toTop, toHeader)
  const self = link.dependent === link.principal
  const sides: FrameLink['sides'] =
    mode === 'stack'
      ? ['left', 'left']
      : self
        ? ['right', 'right']
        : target.x + target.width / 2 <= source.x + source.width / 2
          ? ['left', 'right']
          : ['right', 'left']
  const edge = (box: SchemaBox, side: 'left' | 'right') => (side === 'left' ? box.x : box.x + box.width)
  const start = {x: edge(source, sides[0]), y: fromY}
  const end = {x: edge(target, sides[1]), y: toY}
  const shape = mode === 'stack' || self ? 'orthogonal' : 'curved'
  if (!self || mode !== 'columns') return {start, end, sides, shape}
  return {
    start,
    end,
    sides,
    shape,
    loop: [
      {x: start.x + selfLoop, y: fromY},
      {x: start.x + selfLoop, y: toY},
    ],
  }
}

/** Least distance from a link's port to its row's top or bottom, when several links meet one row on one side. */
const rowPortInset = 6

/** One end of a link, for `linkPortOffsets`. */
export interface LinkEnd {
  key: string
  end: 'from' | 'to'
  /** The row (or header) and side it meets: ends sharing one are spread together. */
  group: string
  /** Where the link comes from at this end (its next point's y), to order the ends so they never cross. */
  approach: number
  /** The room about its anchor, within its row. */
  room: number
}

/**
 * How far each link's ends sit from their row's anchor: links meeting one row
 * on one side are spread evenly over a band centred on the anchor, ordered by
 * where they come from (see the kit's `spreadPorts`); a lone link meets the
 * anchor itself.
 */
export function linkPortOffsets(ends: readonly LinkEnd[]): Map<string, {from: number; to: number}> {
  const groups = new Map<string, LinkEnd[]>()
  for (const end of ends) groups.set(end.group, [...(groups.get(end.group) ?? []), end])
  const result = new Map<string, {from: number; to: number}>()
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.approach - b.approach || compareIds(a.key, b.key) || (a.end < b.end ? -1 : 1))
    const offsets = spreadPorts(ordered.length, Math.min(...ordered.map(end => end.room)), portSpacing, rowPortInset)
    ordered.forEach((end, index) => {
      const entry = result.get(end.key) ?? {from: 0, to: 0}
      entry[end.end] = offsets[index]!
      result.set(end.key, entry)
    })
  }
  return result
}

/**
 * Tracks for links drawn together between ranks (anchors and interior
 * waypoints in `points`, travelling along `axis`): links whose S's cross the
 * same gap at the same place take separate tracks there (see the kit's
 * `routeTracks`). One track per S, in order from the dependent.
 */
export function linkTracks(links: readonly {key: string; points: readonly SchemaPoint[]; axis: SchemaPoint}[]): Map<string, number[]> {
  const runs = links.flatMap(({key, points, axis}) =>
    Array.from({length: points.length / 2}, (_, index) => ({
      key,
      index,
      start: points[2 * index]!,
      end: points[2 * index + 1]!,
      axis,
      lead: 2 * index + 2 === points.length,
    })),
  )
  const tracks = routeTracks(runs)
  const result = new Map(links.map(link => [link.key, Array.from({length: link.points.length / 2}, () => 0)]))
  runs.forEach((run, index) => (result.get(run.key)![run.index] = tracks[index]!))
  return result
}

/** Extra width a self-link's loop takes to the right of its card, in columns. */
export const selfLoopRoom = selfLoop + 4

/*
 * Each stage's own drawing of each link, from its own layout: the sides it
 * leaves and enters, the waypoints where it crosses ranks between, and each
 * S's track in the gap it shares with other links. A frame between two
 * stages that draw a link the same way moves those together with the
 * cards; a link drawn differently (another side, other ranks crossed)
 * fades out on the old drawing and in on the new one, so no frame
 * blends two drawings into one that is valid in neither.
 */
type Sides = FrameLink['sides']
export interface LinkShape {
  sides: Sides
  route: SchemaPoint[]
  tracks: number[]
  /** Each end's offset from its row's anchor (see `linkPortOffsets`). */
  ports: {from: number; to: number}
  signature: string
}
const sidesOf = (source: SchemaBox, target: SchemaBox, self: boolean, layoutMode: SchemaLayoutMode): Sides =>
  layoutMode === 'stack'
    ? ['left', 'left']
    : self
      ? ['right', 'right']
      : target.x + target.width / 2 <= source.x + source.width / 2
        ? ['left', 'right']
        : ['right', 'left']
export const sideX = (box: SchemaBox, side: 'left' | 'right') => (side === 'left' ? box.x : box.x + box.width)

/** One stage's links as drawn from its own layout: sides, anchors, start and route. */
function drawnLinks(links: readonly SchemaLink[], layout: SchemaLayout) {
  const anchor = (box: SchemaBox, table: string, column: string | undefined) =>
    anchorY(box, column === undefined ? undefined : layout.offsets.get(column), layout.headers.get(table) ?? schemaMetrics.header)
  return links.flatMap(link => {
    const source = layout.tables.get(link.dependent),
      target = layout.tables.get(link.principal)
    if (!source || !target) return []
    const self = link.dependent === link.principal
    const sides = sidesOf(source, target, self, layout.mode)
    const fromY = anchor(source, link.dependent, link.dependentColumn)
    const toY = anchor(target, link.principal, link.principalColumn)
    const start = {x: sideX(source, sides[0]), y: fromY}
    const route =
      self && layout.mode === 'columns'
        ? [
            {x: start.x + selfLoop, y: fromY},
            {x: start.x + selfLoop, y: toY},
          ]
        : (layout.routes.get(link.key) ?? [])
    return [{link, source, target, self, sides, fromY, toY, start, route}]
  })
}

/** Every link's drawing in each stage (undefined where a stage doesn't draw it). */
export function stageLinkShapes(models: readonly SchemaModel[], layouts: readonly SchemaLayout[], showLinks: boolean) {
  const shapes = new Map<string, (LinkShape | undefined)[]>()
  for (const [stage, layout] of layouts.entries()) {
    const curved: {key: string; points: SchemaPoint[]; axis: SchemaPoint}[] = []
    // Room about a row's anchor within the row (a header's within the header).
    const room = (box: SchemaBox, table: string, column: string | undefined, y: number) =>
      2 * (y - (column === undefined ? box.y : box.y + (layout.offsets.get(column) ?? 0)))
    const drawn = drawnLinks(showLinks ? models[stage]!.links : [], layout)
    // Links meeting one row on one side spread over it, in the order they come from.
    const ports = linkPortOffsets(
      drawn.flatMap(({link, source, target, sides, fromY, toY, route}) => [
        {
          key: link.key,
          end: 'from' as const,
          group: `${link.dependent}\u0000${link.dependentColumn ?? ''}\u0000${sides[0]}`,
          approach: route[0]?.y ?? toY,
          room: room(source, link.dependent, link.dependentColumn, fromY),
        },
        {
          key: link.key,
          end: 'to' as const,
          group: `${link.principal}\u0000${link.principalColumn ?? ''}\u0000${sides[1]}`,
          approach: route.at(-1)?.y ?? fromY,
          room: room(target, link.principal, link.principalColumn, toY),
        },
      ]),
    )
    for (const {link, target, self, sides, toY, start, route} of drawn) {
      const offsets = ports.get(link.key) ?? {from: 0, to: 0}
      const list = shapes.get(link.key) ?? Array.from({length: layouts.length}, () => undefined)
      list[stage] = {
        sides,
        route,
        tracks: [],
        ports: offsets,
        signature: `${layout.mode}:${sides.join('/')}:${route.map(point => Math.round(point.x)).join(',')}`,
      }
      shapes.set(link.key, list)
      if (layout.mode === 'columns' && !self)
        curved.push({
          key: link.key,
          points: [{x: start.x, y: start.y + offsets.from}, ...route, {x: sideX(target, sides[1]), y: toY + offsets.to}],
          axis: {x: sides[0] === 'left' ? -1 : 1, y: 0},
        })
    }
    for (const [key, tracks] of linkTracks(curved)) shapes.get(key)![stage]!.tracks = tracks
  }
  return shapes
}

import {arrowHeadReach} from '@githubnext/projections-renderer-kit'
import {anchorY} from './geometry.js'
import {lerp, redrawPresence, smooth, VISIBLE} from './fading.js'
import type {FrameLink, FrameTable} from './frame.js'
import {selfLoop, sideX, turnRoom} from './links.js'
import type {LinkShape} from './links.js'
import {nearest} from './interpolate.js'
import type {Placed, Stage, Staged} from './interpolate.js'

/** A link's drawing at this frame: moving with the cards, or redrawn, with how present the drawing is. */
function linkShapeAt(staged: Staged, key: string, {from, to, mix}: Stage): {shape: LinkShape | undefined; presence: number} {
  const a = staged.shapes.get(key)?.[from],
    b = staged.shapes.get(key)?.[to]
  if (a && a.signature === b?.signature) {
    // Drawn the same way in both stages: waypoints and tracks move with the cards.
    return {
      shape: {
        sides: a.sides,
        route: a.route.map((point, index) => ({x: lerp(point.x, b.route[index]!.x, mix), y: lerp(point.y, b.route[index]!.y, mix)})),
        tracks: a.tracks.map((track, index) => lerp(track, b.tracks[index] ?? track, mix)),
        ports: {from: lerp(a.ports.from, b.ports.from, mix), to: lerp(a.ports.to, b.ports.to, mix)},
        signature: a.signature,
      },
      presence: 1,
    }
  }
  // Drawn another way: the old drawing fades out as the cards start to move and the new one fades in as they settle.
  if (a && b) return {shape: mix < 0.5 ? a : b, presence: redrawPresence(mix)}
  return {shape: a ?? b ?? nearest(staged, from, index => staged.shapes.get(key)?.[index]), presence: 1}
}

/** A drawing is only as present as its turns have room: it fades before a moving table closes a gap it turns in. */
function turnFit(points: readonly {x: number}[], sides: FrameLink['sides']): number {
  const axis = sides[0] === 'left' ? -1 : 1
  let room = Infinity
  for (let index = 0; index + 1 < points.length; index += 2) {
    room = Math.min(room, (points[index + 1]!.x - points[index]!.x) * axis - (index + 2 === points.length ? arrowHeadReach : 0))
  }
  return smooth((room - turnRoom / 2) / (turnRoom / 2))
}

/** Every visible link at this frame, between its rows' places, on its drawing. */
export function frameLinks(staged: Staged, t: number, stage: Stage, tables: readonly FrameTable[], placed: Placed): FrameLink[] {
  const {models, last, mode, linkKeys, linkFade} = staged
  const {from, to} = stage
  const {boxes, tops, headers, columnOpacity} = placed
  const linkOf = (index: number, key: string) => models[index]!.links.find(link => link.key === key)
  const tableOpacity = new Map(tables.map(table => [table.change.id, table.opacity]))
  const links: FrameLink[] = []
  for (const key of linkKeys) {
    const link = linkOf(to, key) ?? linkOf(from, key) ?? nearest(staged, from, index => linkOf(index, key))!
    const endpoints = [
      tableOpacity.get(link.dependent) ?? 0,
      tableOpacity.get(link.principal) ?? 0,
      link.dependentColumn === undefined ? 1 : (columnOpacity.get(link.dependentColumn) ?? 0),
      link.principalColumn === undefined ? 1 : (columnOpacity.get(link.principalColumn) ?? 0),
    ]
    const opacity = Math.min(linkFade.get(key)!(t), ...endpoints)
    if (opacity <= VISIBLE) continue
    const source = boxes.get(link.dependent)!,
      target = boxes.get(link.principal)!
    // A link meets a row's (or header's) first line, however tall the row grows.
    const fromY = anchorY(
      source,
      link.dependentColumn === undefined ? undefined : tops.get(link.dependentColumn),
      headers.get(link.dependent)!,
    )
    const toY = anchorY(
      target,
      link.principalColumn === undefined ? undefined : tops.get(link.principalColumn),
      headers.get(link.principal)!,
    )
    const self = link.dependent === link.principal
    const {shape, presence} = linkShapeAt(staged, key, stage)
    let linkOpacity = opacity * presence
    if (!shape || linkOpacity <= VISIBLE) continue
    const sides = shape.sides
    // Each end at its place in its row's spread of ports (see `linkPortOffsets`).
    const fromPort = fromY + shape.ports.from,
      toPort = toY + shape.ports.to
    const start = {x: sideX(source, sides[0]), y: fromPort}
    const end = {x: sideX(target, sides[1]), y: toPort}
    // A self link loops out from its card's side by a fixed distance wherever the card is; a gutter lane runs between its rows.
    const route =
      self && mode === 'columns'
        ? [
            {x: start.x + selfLoop, y: fromPort},
            {x: start.x + selfLoop, y: toPort},
          ]
        : mode === 'stack' && shape.route.length === 2
          ? [
              {x: shape.route[0]!.x, y: fromPort},
              {x: shape.route[0]!.x, y: toPort},
            ]
          : shape.route
    const points = [start, ...route, end]
    if (!(self && mode === 'columns') && mode === 'columns') {
      const fit = turnFit(points, sides)
      if (linkOpacity * fit <= VISIBLE) continue
      linkOpacity *= fit
    }
    const first = models[0]!.links.some(item => item.key === key),
      final = models[last]!.links.some(item => item.key === key)
    links.push({
      ...link,
      shape: mode === 'stack' || self ? 'orthogonal' : 'curved',
      points,
      sides,
      tracks: shape.tracks,
      opacity: linkOpacity,
      status: first && final ? 'unchanged' : first ? 'removed' : final ? 'added' : 'unchanged',
    })
  }
  return links
}

import type {Entity} from '@githubnext/projections-schemas'
import {isChanged, statusParts} from '@githubnext/projections-renderer-kit'
import type {Circle} from './transition.js'

/** Truncates text to `room` characters with an ellipsis, or nothing when fewer than three fit. */
export function fitText(text: string, room: number): string | undefined {
  if (room >= text.length) return text
  if (room < 3) return undefined
  return `${text.slice(0, room - 1)}…`
}

export const nameOf = (entity: Entity, path: string | undefined) => {
  const base = (path ?? entity.label).split('/').filter(Boolean).at(-1)
  return base ?? entity.label
}

/** Width of a status line in CSS px, estimated from the label size (sans, about 0.56 em per character). */
export function statusWidth(row: Circle['row'], font: number): number {
  const parts = statusParts(row)
  return parts.reduce((sum, part) => sum + (part.label.length + 2) * font * 0.56, 0) + (parts.length - 1) * 8
}

/** Chord length of a circle of radius `r` at distance `y` from its centre. */
export const chord = (r: number, y: number) => (Math.abs(y) >= r ? 0 : 2 * Math.sqrt(r * r - y * y))

/** Where a circle's name and change status are drawn, relative to its centre. */
export interface Decoration {
  text?: string
  labelY: number
  /**
   * Where a folder's name goes: along the top of its outline; along the bottom when the top is taken; or, when both
   * are, straight across just inside its top or bottom edge (`inside`, at `labelY`).
   */
  arc?: 'top' | 'bottom' | 'inside'
  status?: 'line' | 'glyph'
  statusY: number
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** A filled circle's name as drawn: whole when it fits, truncated, or nothing on small circles. */
function nameText(circle: Circle, name: string, entity: Entity, charWidth: number, font: number): string | undefined {
  const {r} = circle
  if (r >= 20) return fitText(entity.kind === 'directory' ? `${name}/` : name, Math.floor((chord(r, font * 0.6) - 6) / charWidth))
  return undefined
}

/** Fewest characters an abbreviated folder name keeps, ellipsis included; its tooltip has the whole path. */
const shortestFolderName = 4

/**
 * A folder's name as it may be drawn along its outline (a 110° arc): whole when it fits, else abbreviated, never
 * below `shortestFolderName` characters. Folders too small for any are left unnamed.
 */
export function folderText(r: number, name: string, charWidth: number): string | undefined {
  if (r < 24) return undefined
  const room = Math.floor((r * 1.92) / charWidth)
  if (name.length <= room) return name
  return room >= shortestFolderName ? fitText(name, room) : undefined
}

/** The box a name takes: across a filled circle's middle, or along the top or bottom of a folder's outline. */
function nameBox(circle: Circle, width: number, labelY: number, font: number, arc: 'top' | 'bottom' = 'top'): Box {
  const {r} = circle
  if (circle.filled) {
    return {
      left: circle.x - width / 2,
      right: circle.x + width / 2,
      top: circle.y + labelY - font * 0.7,
      bottom: circle.y + labelY + font * 0.7,
    }
  }
  // Along the arc: the text spans an angle of width / r, and its ends turn in from the top (or bottom) of the circle.
  const half = Math.min(Math.PI / 2, width / r / 2)
  const reach = r * Math.sin(half) + font * 0.5
  const inner = r * Math.cos(half) - font * 0.7,
    outer = r + font * 0.7
  return {
    left: circle.x - reach,
    right: circle.x + reach,
    top: arc === 'top' ? circle.y - outer : circle.y + inner,
    bottom: arc === 'top' ? circle.y - inner : circle.y + outer,
  }
}

/** Where a changed circle's status may go, in order of preference: its status line, else its glyph. */
function statusCandidates(circle: Circle, named: boolean, font: number): {status: 'line' | 'glyph'; y: number; width: number}[] {
  const {r} = circle
  const line = statusWidth(circle.row, font) + 6,
    glyph = statusParts(circle.row).length * font * 0.7 + 4
  return circle.filled
    ? [
        ...(r >= 30 && chord(r, font * 1.3) >= line ? [{status: 'line' as const, y: font * 0.85, width: line}] : []),
        ...(named && r >= 26 ? [{status: 'glyph' as const, y: -font * 1.25, width: glyph}] : []),
        ...(!named && r >= 7 ? [{status: 'glyph' as const, y: 0, width: glyph}] : []),
      ]
    : [
        ...(r >= 40 && chord(r, r - font) >= line + 2 ? [{status: 'line' as const, y: r - font, width: line}] : []),
        ...(r >= 12 ? [{status: 'glyph' as const, y: r - font * 0.85, width: glyph}] : []),
      ]
}

/**
 * Which circles are labelled, and where change status goes. A file's name
 * goes across its middle when it fits, a folder's along the top of its
 * outline when it fits a 110° arc (abbreviated when it doesn't). Status
 * goes in a band reserved inside the circle (`+ Added` below a file's name, at
 * the bottom of a folder), or as its glyph alone where the band doesn't fit.
 * Names are placed first (shallow folders, then larger files), then status;
 * anything that would overlap text already placed is left out or falls back
 * to the glyph, so nothing prints over anything else. A folder whose top is
 * taken (a crowded parent's name runs along it) is named along the bottom of
 * its outline instead, once every status is placed, or failing that straight
 * across inside it (just inside its top or bottom edge, else as near them as an
 * abbreviated name fits, else across its middle), so a group is named wherever
 * there is room. All of it depends on the circles alone, never on
 * emphasis, so nothing moves when status appears; each circle's accessible
 * name always carries its name and status.
 */
export function placeLabels(
  circles: readonly Circle[],
  paths: ReadonlyMap<string, string>,
  charWidth: number,
  font: number,
): Map<string, Decoration> {
  const result = new Map<string, Decoration>()
  const placed: Box[] = []
  const free = (box: Box) =>
    !placed.some(other => other.left < box.right && box.left < other.right && other.top < box.bottom && box.top < other.bottom)
  const order = [...circles].sort(
    (a, b) => Number(a.filled) - Number(b.filled) || (a.filled ? b.r - a.r : a.depth - b.depth || b.r - a.r) || (a.id < b.id ? -1 : 1),
  )
  const bottomNames: {circle: Circle; text: string; name: string}[] = []
  for (const circle of order) {
    const {row, r} = circle
    const entity = (circle.local >= 0.5 ? (row.after ?? row.before) : (row.before ?? row.after))!
    const name = nameOf(entity, paths.get(circle.id))
    const text = circle.filled ? nameText(circle, name, entity, charWidth, font) : folderText(r, name, charWidth)
    const labelY = circle.filled && text && r >= 30 ? -font * 0.55 : 0
    if (!text) {
      result.set(circle.id, {labelY, statusY: 0})
      continue
    }
    const box = nameBox(circle, text.length * charWidth + 4, labelY, font)
    if (free(box)) {
      placed.push(box)
      result.set(circle.id, {text, labelY, ...(circle.filled ? {} : {arc: 'top' as const}), statusY: 0})
    } else {
      result.set(circle.id, {labelY: 0, statusY: 0})
      if (!circle.filled) bottomNames.push({circle, text, name})
    }
  }
  for (const circle of order) {
    if (!isChanged(circle.row)) continue
    const decoration = result.get(circle.id)!
    const candidates = statusCandidates(circle, decoration.text !== undefined, font)
    for (const candidate of candidates) {
      const box = {
        left: circle.x - candidate.width / 2,
        right: circle.x + candidate.width / 2,
        top: circle.y + candidate.y - font * 0.65,
        bottom: circle.y + candidate.y + font * 0.65,
      }
      if (!free(box)) continue
      placed.push(box)
      result.set(circle.id, {...decoration, status: candidate.status, statusY: candidate.y})
      break
    }
  }
  for (const {circle, text, name} of bottomNames) {
    const width = text.length * charWidth + 4
    const inside = (labelY: number, wide: number) => ({
      left: circle.x - wide / 2,
      right: circle.x + wide / 2,
      top: circle.y + labelY - font * 0.7,
      bottom: circle.y + labelY + font * 0.7,
    })
    // Straight across inside the circle: just inside its top, then bottom, edge, then halfway in; abbreviated to the
    // chord there, never under `shortestFolderName` characters. A small folder (a phone's) whose chord there is too
    // short tries the line nearest its top, then bottom, edge where that many fit, then its middle.
    const reach = Math.sqrt(Math.max(0, circle.r ** 2 - ((shortestFolderName * charWidth + 4) / 2) ** 2)) - font * 0.7 - 1e-6
    const insides = [circle.r - font * 1.1, circle.r * 0.5, ...(reach > 0 ? [reach] : [])].flatMap(offset => [-offset, offset])
    insides.push(0)
    const candidates = [
      {arc: 'bottom' as const, labelY: 0, text, box: nameBox(circle, width, 0, font, 'bottom')},
      ...insides.flatMap(labelY => {
        const room = Math.floor((chord(circle.r, Math.abs(labelY) + font * 0.7) - 4) / charWidth)
        const fitted = room >= shortestFolderName ? fitText(name, room) : undefined
        return fitted ? [{arc: 'inside' as const, labelY, text: fitted, box: inside(labelY, fitted.length * charWidth + 4)}] : []
      }),
    ]
    const found = candidates.find(candidate => free(candidate.box))
    if (!found) continue
    placed.push(found.box)
    result.set(circle.id, {...result.get(circle.id)!, text: found.text, arc: found.arc, labelY: found.labelY})
  }
  return result
}

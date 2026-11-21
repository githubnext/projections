// A minimal icon font writer, plain Node: filled SVG paths on a 16px grid in, a WOFF (1.0) font out. It writes the
// TrueType tables browsers' font sanitizer needs (cmap, glyf, head, hhea, hmtx, loca, maxp, name, OS/2, post), with
// the em as the 16px box (ascent = em, no descent, as codicons do), so a glyph drawn at 16px fills its icon box.
// Tables are stored uncompressed, so the output is byte-for-byte reproducible.
//
//   import {iconFont} from './icon-font.mjs'
//   const woff = iconFont({family: 'projections-icons', glyphs: [{codepoint: 0xe001, path: 'M…Z'}]})

/** Font units per 16px icon box: 64 per pixel, so half-pixel coordinates land on whole units. */
const unitsPerEm = 1024
const unit = unitsPerEm / 16

/** Splits an SVG path into commands and their numbers. Arc flags may be written without separators (`a.5.5 0 011 1`). */
function tokenize(d) {
  const commands = []
  let index = 0
  const space = () => {
    while (index < d.length && /[\s,]/.test(d[index])) index++
  }
  const number = () => {
    space()
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(index))
    if (!match) throw new Error(`Expected a number at ${index} in ${d}`)
    index += match[0].length
    return Number(match[0])
  }
  const flag = () => {
    space()
    const value = d[index++]
    if (value !== '0' && value !== '1') throw new Error(`Expected an arc flag at ${index - 1} in ${d}`)
    return Number(value)
  }
  const arity = {M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0}
  while ((space(), index < d.length)) {
    const letter = d[index++]
    const upper = letter.toUpperCase()
    if (!(upper in arity)) throw new Error(`Unsupported path command ${letter} in ${d}`)
    if (upper === 'Z') {
      commands.push({command: letter, values: []})
      continue
    }
    do {
      const values =
        upper === 'A' ? [number(), number(), number(), flag(), flag(), number(), number()] : Array.from({length: arity[upper]}, number)
      commands.push({command: letter, values})
      space()
    } while (index < d.length && /[\d.+-]/.test(d[index]))
  }
  return commands
}

/** An elliptical arc (SVG endpoint form) as quadratic segments of at most 45°: `[control, end]` pairs. */
function arc([x0, y0], rx, ry, rotation, large, sweep, [x, y]) {
  if (x0 === x && y0 === y) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (!rx || !ry) {
    return [
      [
        [(x0 + x) / 2, (y0 + y) / 2],
        [x, y],
      ],
    ]
  }
  const phi = (rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)]
  const dx = (x0 - x) / 2
  const dy = (y0 - y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const scale = Math.sqrt(x1 ** 2 / rx ** 2 + y1 ** 2 / ry ** 2)
  if (scale > 1) {
    rx *= scale
    ry *= scale
  }
  const sign = large === sweep ? -1 : 1
  const factor =
    sign * Math.sqrt(Math.max(0, (rx ** 2 * ry ** 2 - rx ** 2 * y1 ** 2 - ry ** 2 * x1 ** 2) / (rx ** 2 * y1 ** 2 + ry ** 2 * x1 ** 2)))
  const cx1 = (factor * rx * y1) / ry
  const cy1 = (-factor * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 4) - 1e-9)
  const step = delta / count
  const at = (theta, radius = 1) => [
    cx + cos * rx * Math.cos(theta) * radius - sin * ry * Math.sin(theta) * radius,
    cy + sin * rx * Math.cos(theta) * radius + cos * ry * Math.sin(theta) * radius,
  ]
  const segments = []
  for (let i = 0; i < count; i++) {
    const a = start + step * i
    const b = a + step
    const end = i === count - 1 ? [x, y] : at(b)
    segments.push([at((a + b) / 2, 1 / Math.cos(step / 2)), end])
  }
  return segments
}

/** A cubic Bézier as four quadratics. */
function cubic(p0, c1, c2, p3) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const point = t => {
    const a = lerp(p0, c1, t)
    const b = lerp(c1, c2, t)
    const c = lerp(c2, p3, t)
    return lerp(lerp(a, b, t), lerp(b, c, t), t)
  }
  const derivative = t => {
    const u = 1 - t
    return [0, 1].map(k => 3 * u * u * (c1[k] - p0[k]) + 6 * u * t * (c2[k] - c1[k]) + 3 * t * t * (p3[k] - c2[k]))
  }
  const segments = []
  for (let i = 0; i < 4; i++) {
    const [a, b] = [i / 4, (i + 1) / 4]
    const [pa, pb] = [point(a), point(b)]
    const [da, db] = [derivative(a), derivative(b)]
    const h = (b - a) / 2
    // The control point where the end tangents meet, averaged from both ends.
    segments.push([[(pa[0] + da[0] * h + pb[0] - db[0] * h) / 2, (pa[1] + da[1] * h + pb[1] - db[1] * h) / 2], pb])
  }
  return segments
}

/**
 * An SVG path's subpaths as TrueType contours: points `{x, y, on}` in the 16px grid (y down). Supports M, L, H, V,
 * C, Q, A and Z, absolute and relative; arcs and cubics become quadratics.
 */
export function pathContours(d) {
  const contours = []
  let contour
  let current = [0, 0]
  let start = [0, 0]
  const close = () => {
    if (!contour) return
    const first = contour[0]
    const last = contour.at(-1)
    if (contour.length > 1 && last.on && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) contour.pop()
    if (contour.length > 2) contours.push(contour)
    contour = undefined
  }
  const line = point => {
    contour.push({x: point[0], y: point[1], on: true})
    current = point
  }
  const quads = segments => {
    for (const [control, end] of segments) {
      contour.push({x: control[0], y: control[1], on: false}, {x: end[0], y: end[1], on: true})
      current = end
    }
  }
  for (const {command, values} of tokenize(d)) {
    const relative = command !== command.toUpperCase()
    const at = (x, y) => (relative ? [current[0] + x, current[1] + y] : [x, y])
    switch (command.toUpperCase()) {
      case 'M':
        close()
        current = at(values[0], values[1])
        start = current
        contour = [{x: current[0], y: current[1], on: true}]
        break
      case 'L':
        line(at(values[0], values[1]))
        break
      case 'H':
        line([relative ? current[0] + values[0] : values[0], current[1]])
        break
      case 'V':
        line([current[0], relative ? current[1] + values[0] : values[0]])
        break
      case 'Q':
        quads([[at(values[0], values[1]), at(values[2], values[3])]])
        break
      case 'C':
        quads(cubic(current, at(values[0], values[1]), at(values[2], values[3]), at(values[4], values[5])))
        break
      case 'A':
        quads(arc(current, values[0], values[1], values[2], values[3], values[4], at(values[5], values[6])))
        break
      case 'Z':
        current = start
        close()
        break
    }
  }
  close()
  return contours
}

const tag = name => Buffer.from(name.padEnd(4, ' '), 'latin1')
function checksum(buffer) {
  const padded = Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)])
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0
  return sum
}
const pad4 = buffer => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)])

/** A simple glyph's `glyf` record (no instructions), its bounding box and point count, in font units. */
function glyphRecord(contours) {
  const points = contours.flatMap(contour =>
    contour.map(point => ({x: Math.round(point.x * unit), y: Math.round(unitsPerEm - point.y * unit), on: point.on})),
  )
  if (!points.length) return {data: Buffer.alloc(0), box: undefined, points: 0, contours: 0}
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  const header = Buffer.alloc(10 + 2 * contours.length + 2)
  header.writeInt16BE(contours.length, 0)
  box.forEach((value, i) => header.writeInt16BE(value, 2 + 2 * i))
  let end = -1
  contours.forEach((contour, i) => header.writeUInt16BE((end += contour.length), 10 + 2 * i))
  header.writeUInt16BE(0, 10 + 2 * contours.length)
  const flags = Buffer.from(points.map(point => (point.on ? 1 : 0)))
  const deltas = axis => {
    const buffer = Buffer.alloc(2 * points.length)
    let previous = 0
    points.forEach((point, i) => {
      buffer.writeInt16BE(point[axis] - previous, 2 * i)
      previous = point[axis]
    })
    return buffer
  }
  return {data: pad4(Buffer.concat([header, flags, deltas('x'), deltas('y')])), box, points: points.length, contours: contours.length}
}

function nameTable(family, version) {
  const records = [
    [1, family],
    [2, 'Regular'],
    [3, `${family} ${version}`],
    [4, family],
    [5, `Version ${version}`],
    [6, family.replaceAll(/[^A-Za-z0-9-]/g, '')],
  ]
  const strings = records.map(([, text]) => Buffer.from(text, 'utf16le').swap16())
  const header = Buffer.alloc(6 + 12 * records.length)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(records.length, 2)
  header.writeUInt16BE(header.length, 4)
  let offset = 0
  records.forEach(([id], i) => {
    const at = 6 + 12 * i
    header.writeUInt16BE(3, at)
    header.writeUInt16BE(1, at + 2)
    header.writeUInt16BE(0x409, at + 4)
    header.writeUInt16BE(id, at + 6)
    header.writeUInt16BE(strings[i].length, at + 8)
    header.writeUInt16BE(offset, at + 10)
    offset += strings[i].length
  })
  return Buffer.concat([header, ...strings])
}

function cmapTable(codepoints) {
  // Format 4: one segment per code point (glyph i + 1), then the required 0xFFFF segment.
  const segments = [
    ...codepoints.map((code, i) => ({start: code, end: code, delta: (i + 1 - code) & 0xffff})),
    {start: 0xffff, end: 0xffff, delta: 1},
  ]
  const count = segments.length
  const search = 2 * 2 ** Math.floor(Math.log2(count))
  const subtable = Buffer.alloc(16 + 8 * count)
  subtable.writeUInt16BE(4, 0)
  subtable.writeUInt16BE(subtable.length, 2)
  subtable.writeUInt16BE(0, 4)
  subtable.writeUInt16BE(2 * count, 6)
  subtable.writeUInt16BE(search, 8)
  subtable.writeUInt16BE(Math.log2(search / 2), 10)
  subtable.writeUInt16BE(2 * count - search, 12)
  segments.forEach((segment, i) => {
    subtable.writeUInt16BE(segment.end, 14 + 2 * i)
    subtable.writeUInt16BE(segment.start, 16 + 2 * count + 2 * i)
    subtable.writeUInt16BE(segment.delta, 16 + 4 * count + 2 * i)
    subtable.writeUInt16BE(0, 16 + 6 * count + 2 * i)
  })
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(1, 2)
  header.writeUInt16BE(3, 4)
  header.writeUInt16BE(1, 6)
  header.writeUInt32BE(12, 8)
  return Buffer.concat([header, subtable])
}

/**
 * A WOFF font of icon glyphs: each glyph's `path` is a filled SVG path on the 16px grid (nonzero fill), mapped to
 * `codepoint` (Private Use Area). Glyph 0 is an empty `.notdef`.
 */
export function iconFont({family, version = '1.0', glyphs}) {
  const sorted = [...glyphs].sort((a, b) => a.codepoint - b.codepoint)
  const records = [glyphRecord([]), ...sorted.map(glyph => glyphRecord(pathContours(glyph.path)))]
  const boxes = records.flatMap(record => (record.box ? [record.box] : []))
  const bounds = [0, 1, 2, 3].map(i => (i < 2 ? Math.min : Math.max)(...boxes.map(box => box[i])))
  const numGlyphs = records.length

  const glyf = Buffer.concat(records.map(record => record.data))
  const loca = Buffer.alloc(4 * (numGlyphs + 1))
  records.reduce((offset, record, i) => {
    loca.writeUInt32BE(offset, 4 * i)
    loca.writeUInt32BE(offset + record.data.length, 4 * (i + 1))
    return offset + record.data.length
  }, 0)

  const head = Buffer.alloc(54)
  head.writeUInt32BE(0x00010000, 0)
  head.writeUInt32BE(Math.round(Number(version) * 65536) >>> 0, 4)
  head.writeUInt32BE(0x5f0f3cf5, 12)
  head.writeUInt16BE(0x000b, 16)
  head.writeUInt16BE(unitsPerEm, 18)
  bounds.forEach((value, i) => head.writeInt16BE(value, 36 + 2 * i))
  head.writeUInt16BE(8, 46)
  head.writeInt16BE(2, 48)
  head.writeInt16BE(1, 50)

  const hhea = Buffer.alloc(36)
  hhea.writeUInt32BE(0x00010000, 0)
  hhea.writeInt16BE(unitsPerEm, 4)
  hhea.writeUInt16BE(unitsPerEm, 10)
  hhea.writeInt16BE(Math.min(...boxes.map(box => box[0])), 12)
  hhea.writeInt16BE(Math.min(...boxes.map(box => unitsPerEm - box[2])), 14)
  hhea.writeInt16BE(bounds[2], 16)
  hhea.writeInt16BE(1, 18)
  hhea.writeUInt16BE(numGlyphs, 34)

  const hmtx = Buffer.alloc(4 * numGlyphs)
  records.forEach((record, i) => {
    hmtx.writeUInt16BE(unitsPerEm, 4 * i)
    hmtx.writeInt16BE(record.box ? record.box[0] : 0, 4 * i + 2)
  })

  const maxp = Buffer.alloc(32)
  maxp.writeUInt32BE(0x00010000, 0)
  maxp.writeUInt16BE(numGlyphs, 4)
  maxp.writeUInt16BE(Math.max(...records.map(record => record.points)), 6)
  maxp.writeUInt16BE(Math.max(...records.map(record => record.contours)), 8)
  maxp.writeUInt16BE(2, 14)

  const os2 = Buffer.alloc(96)
  os2.writeUInt16BE(4, 0)
  os2.writeInt16BE(unitsPerEm, 2)
  os2.writeUInt16BE(400, 4)
  os2.writeUInt16BE(5, 6)
  tag('PJCT').copy(os2, 58)
  os2.writeUInt16BE(0x40, 62)
  os2.writeUInt16BE(sorted[0].codepoint, 64)
  os2.writeUInt16BE(sorted.at(-1).codepoint, 66)
  os2.writeInt16BE(unitsPerEm, 68)
  os2.writeUInt16BE(unitsPerEm, 74)
  os2.writeUInt16BE(32, 92)

  const post = Buffer.alloc(32)
  post.writeUInt32BE(0x00030000, 0)

  const tables = {
    'OS/2': os2,
    cmap: cmapTable(sorted.map(glyph => glyph.codepoint)),
    glyf,
    head,
    hhea,
    hmtx,
    loca,
    maxp,
    name: nameTable(family, version),
    post,
  }
  const tags = Object.keys(tables).sort()
  // Table checksums, head's with its checksumAdjustment zero, as the sfnt and WOFF directories record them.
  const sums = Object.fromEntries(tags.map(name => [name, checksum(tables[name])]))

  // The sfnt, for head's checksumAdjustment (computed over the whole font with the field zero).
  const sfntSize = 12 + 16 * tags.length + tags.reduce((size, name) => size + pad4(tables[name]).length, 0)
  const sfnt = Buffer.alloc(sfntSize)
  sfnt.writeUInt32BE(0x00010000, 0)
  sfnt.writeUInt16BE(tags.length, 4)
  const search = 16 * 2 ** Math.floor(Math.log2(tags.length))
  sfnt.writeUInt16BE(search, 6)
  sfnt.writeUInt16BE(Math.log2(search / 16), 8)
  sfnt.writeUInt16BE(16 * tags.length - search, 10)
  let offset = 12 + 16 * tags.length
  tags.forEach((name, i) => {
    tag(name).copy(sfnt, 12 + 16 * i)
    sfnt.writeUInt32BE(sums[name], 16 + 16 * i)
    sfnt.writeUInt32BE(offset, 20 + 16 * i)
    sfnt.writeUInt32BE(tables[name].length, 24 + 16 * i)
    tables[name].copy(sfnt, offset)
    offset += pad4(tables[name]).length
  })
  head.writeUInt32BE((0xb1b0afba - checksum(sfnt)) >>> 0, 8)

  // WOFF 1.0, tables stored uncompressed.
  const header = Buffer.alloc(44 + 20 * tags.length)
  header.write('wOFF', 0, 'latin1')
  header.writeUInt32BE(0x00010000, 4)
  header.writeUInt16BE(tags.length, 12)
  header.writeUInt32BE(sfntSize, 16)
  header.writeUInt16BE(1, 20)
  let at = header.length
  const bodies = tags.map((name, i) => {
    const data = tables[name]
    const entry = 44 + 20 * i
    tag(name).copy(header, entry)
    header.writeUInt32BE(at, entry + 4)
    header.writeUInt32BE(data.length, entry + 8)
    header.writeUInt32BE(data.length, entry + 12)
    header.writeUInt32BE(sums[name], entry + 16)
    at += pad4(data).length
    return pad4(data)
  })
  header.writeUInt32BE(at, 8)
  return Buffer.concat([header, ...bodies])
}

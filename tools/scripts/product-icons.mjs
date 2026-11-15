// The product icons: the Projections mark (the projector, from brand/projections-mark.svg) and the projection parts'
// icons (extractor, comparator, renderer), drawn from one geometry on the 16px grid. Writes:
//   brand/parts/<part>.svg                       the sources, single color (currentColor), 1px strokes
//   packages/integrations/vscode/media/icons/projections-icons.woff    the VS Code product icon font (contributes.icons): the mark at
//                                                U+E000, the parts at U+E001–U+E003
//   packages/renderers/sdk/src/part-icons.generated.ts    the SDK's default icon tokens, at the default UI's icon weight
// The font writer is plain Node (tools/scripts/icon-font.mjs); no dependencies.
//
//   node tools/scripts/product-icons.mjs           write them
//   node tools/scripts/product-icons.mjs --check   fail if any is out of date
//
// The dot is the extraction. It is the same size in every icon, strokes never touch it, and each stops the same
// distance from it: the extractor's three strokes converge on the dot, the comparator is the renderer's dot and the
// extractor's dot either side of a dashed divider, and the renderer's strokes diverge from its dot.
import {readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {iconFont} from './icon-font.mjs'

/** The icons' layout: `horizontal` (left to right, as chosen), or `rotated` (each icon turned 90° clockwise). */
export const orientation = 'horizontal'

/** The geometry, in pixels on the 16px grid (stroke centres; strokes are 1px with round caps). */
export const geometry = {
  /** The dot's radius: a 4px dot, its edges on whole pixels along the icon's axis. */
  dot: 2,
  /** From a stroke's round cap to the dot's edge. */
  gap: 1.5,
  /** The outer strokes' angle from the axis, in degrees. */
  angle: 35,
  /** The outer strokes' length, and the middle stroke's (longer, so the direction reads first). */
  outer: 3.5,
  middle: 5,
  /** The comparator's divider at x = 7.5: three 2px dashes with 2px gaps, the dot's own clearance, as tall as the fans. */
  dashes: [
    [3, 4],
    [7, 8],
    [11, 12],
  ],
}

/** The font's code points: the Projections mark, then the parts. */
export const codepoints = {mark: 0xe000, extractor: 0xe001, comparator: 0xe002, renderer: 0xe003}
export const parts = /** @type {const} */ (['extractor', 'comparator', 'renderer'])

const round = value => Math.round(value * 1000) / 1000
const turn = {horizontal: ([x, y]) => [x, y], rotated: ([x, y]) => [15 - y, x]}[orientation]
const point = (x, y) => turn([x, y]).map(round)

/** A part's drawing: dots `{cx, cy, r}` and 1px round-capped strokes `{from, to}`, horizontal then turned. */
export function primitives(part, {dot, gap, angle, outer, middle, dashes} = geometry) {
  const cy = 7.5
  const right = 14 - dot
  const left = 1 + dot
  const near = dot + gap + 0.5
  const fan = (cx, direction) =>
    [
      [angle, outer],
      [0, middle],
      [-angle, outer],
    ].map(([degrees, length]) => {
      const [ux, uy] = [direction * Math.cos((degrees * Math.PI) / 180), -Math.sin((degrees * Math.PI) / 180)]
      return {from: point(cx + ux * near, cy + uy * near), to: point(cx + ux * (near + length), cy + uy * (near + length))}
    })
  const disc = cx => {
    const [x, y] = point(cx, cy)
    return {cx: x, cy: y, r: dot}
  }
  if (part === 'extractor') return {dots: [disc(right)], strokes: fan(right, -1)}
  if (part === 'renderer') return {dots: [disc(left)], strokes: fan(left, 1)}
  return {dots: [disc(left), disc(right)], strokes: dashes.map(([a, b]) => ({from: point(7.5, a), to: point(7.5, b)}))}
}

/** A part as an SVG: strokes in `color` at `width`, the dots filled. */
export function svg(part, {color = 'currentColor', width = 1, label = false} = {}) {
  const {dots, strokes} = primitives(part)
  const d = strokes.map(({from, to}) => `M${from.join(' ')}L${to.join(' ')}`).join('')
  const name = part[0].toUpperCase() + part.slice(1)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"${label ? ` width="16" height="16" role="img" aria-label="${name}"` : ''}>`,
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`,
    ...dots.map(({cx, cy, r}) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`),
    '</svg>',
  ].join('')
}

/** A part as one filled path (the strokes outlined as capsules), for the font. */
export function outline(part) {
  const {dots, strokes} = primitives(part)
  const h = 0.5
  const f = value => round(value)
  const circle = ({cx, cy, r}) => `M${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx - r)} ${f(cy)}Z`
  const capsule = ({from: [x1, y1], to: [x2, y2]}) => {
    const length = Math.hypot(x2 - x1, y2 - y1)
    const [nx, ny] = [(-(y2 - y1) / length) * h, ((x2 - x1) / length) * h]
    const p = (x, y) => `${f(x)} ${f(y)}`
    return `M${p(x1 + nx, y1 + ny)}L${p(x2 + nx, y2 + ny)}A${h} ${h} 0 0 0 ${p(x2 - nx, y2 - ny)}L${p(x1 - nx, y1 - ny)}A${h} ${h} 0 0 0 ${p(x1 + nx, y1 + ny)}Z`
  }
  return [...strokes.map(capsule), ...dots.map(circle)].join('')
}

const root = new URL('../../', import.meta.url)

/**
 * The Projections mark as one filled path, for the font: brand/projections-mark.svg's paths, then its circle (the
 * glass) as two arcs. The font fills by the nonzero rule; the mark's one even-odd path (the lens ring) already winds
 * its hole the other way, and no other shapes overlap with opposite winding.
 */
export function markOutline(source) {
  const elements = [...source.matchAll(/<(path|circle)\b([^>]*)\/>/g)]
  const attribute = (attributes, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1]
  if (!elements.length || source.replace(/<(path|circle)\b[^>]*\/>/g, '').match(/<(?!\/?svg\b)\w/))
    throw new Error('The mark must be paths and circles only')
  return elements
    .map(([, kind, attributes]) => {
      if (kind === 'path') return attribute(attributes, 'd')
      const [cx, cy, r] = ['cx', 'cy', 'r'].map(name => Number(attribute(attributes, name)))
      return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`
    })
    .join('')
}
const mark = markOutline(await readFile(new URL('brand/projections-mark.svg', root), 'utf8'))
const header =
  "// Generated by tools/scripts/product-icons.mjs from the part icons' geometry (brand/parts); run `npm run icons` to update.\n"
const outputs = {
  ...Object.fromEntries(parts.map(part => [`brand/parts/${part}.svg`, `${svg(part, {label: true})}\n`])),
  'packages/integrations/vscode/media/icons/projections-icons.woff': iconFont({
    family: 'projections-icons',
    glyphs: [{codepoint: codepoints.mark, path: mark}, ...parts.map(part => ({codepoint: codepoints[part], path: outline(part)}))],
  }),
  'packages/renderers/sdk/src/part-icons.generated.ts': `${header}
/**
 * The projection parts' icons, the defaults of the \`extractor\`, \`comparator\` and \`renderer\` icon tokens: black on
 * the 16px grid at the default UI's icon weight (Lucide's 2.25 on its 24px grid), drawn as masks.
 */
export const partIconSvgs = {
${parts.map(part => `  ${part}:\n    '${svg(part, {color: '#000', width: 1.5})}',`).join('\n')}
} as const
`,
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check')
  const stale = []
  for (const [path, content] of Object.entries(outputs)) {
    const file = new URL(path, root)
    const expected = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const current = await readFile(file).catch(() => undefined)
    if (current?.equals(expected)) continue
    if (check) stale.push(path)
    else await writeFile(file, expected)
  }
  if (stale.length) {
    console.error(`Out of date (run npm run icons): ${stale.join(', ')}`)
    process.exit(1)
  }
}

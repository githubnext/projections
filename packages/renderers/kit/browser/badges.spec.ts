import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'
import {build} from 'vite'
import type {Rollup} from 'vite'
import {badgeIconNames, defaultThemeTokens, iconToken} from '@githubnext/projections-renderer-sdk/protocol'
import type {BadgeCell} from './badge-page.js'

/**
 * Every badge icon in pixels, cut out of its disc by the kit's `Icon` (a CSS mask) and its `SvgIcon` (an SVG mask), in
 * Chromium and WebKit at 1x and 2x and at text sizes 14px and 16px:
 *
 * - centred: the bounding box of the cut-out ink, caps and joins included, is centred where the glyph's own geometry
 *   puts it, within a quarter of a CSS pixel; and that geometry's box is centred on the disc, for every glyph but
 *   `redeploy` (a ring arrow whose ring, not its box, is concentric with the disc: `icons.test.mjs` checks the ring);
 * - one stroke: the stroke each glyph's cut was drawn at agrees across the glyphs, so none is heavier or lighter than
 *   another however its strokes run, and is the stroke the SDK draws them at. The cut's area (which antialiasing keeps,
 *   at any density) is matched against the glyph's own geometry drawn at a range of stroke widths.
 */
const sizes = [14, 16]
const densities = [1, 2]
const kit = fileURLToPath(new URL('../', import.meta.url))
/** The badge's box, in its glyphs' units: a disc of radius 11 at its centre. */
const box = 24
const discRadius = 11
/** The badges placed by something other than their ink's bounding box: the ring arrow, by its ring. */
const ringCentred = new Set(['redeploy'])

const tokens = defaultThemeTokens('light')
const svgOf = (value: string) => decodeURIComponent(value.slice('url("data:image/svg+xml,'.length, -'")'.length))
/** Each badge glyph's geometry, from its token: its strokes' path data and the one stroke width it is drawn at. */
const glyphs = Object.fromEntries(
  badgeIconNames.map(name => {
    const svg = svgOf(tokens[iconToken(name)])
    return [
      name,
      {paths: [...svg.matchAll(/ d="([^"]+)"/gu)].map(match => match[1]!), stroke: Number(/stroke-width="([\d.]+)"/u.exec(svg)?.[1])},
    ]
  }),
) as Record<string, {paths: string[]; stroke: number}>

let page: Promise<string> | undefined
/** The badge page: the SDK's icons.css and default tokens, black on white, and `badge-page.ts` bundled. */
function badgePage() {
  page ??= (async () => {
    const output = (await build({
      root: kit,
      configFile: false,
      logLevel: 'warn',
      define: {'process.env.NODE_ENV': '"production"'},
      build: {
        write: false,
        minify: true,
        lib: {entry: 'browser/badge-page.ts', formats: ['iife'], name: 'badgePage', fileName: () => 'badges.js'},
      },
    })) as Rollup.RollupOutput[]
    const script = output[0]!.output[0].code
    const css = readFileSync(new URL('../../sdk/icons.css', import.meta.url), 'utf8')
    const variables = Object.entries(tokens)
      .filter(([name]) => name.startsWith('icon-'))
      .map(([name, value]) => `--projections-${name}: ${value};`)
      .join('\n')
    return `<!doctype html><html><head><style>:root{${variables}} ${css} html,body{margin:0;background:#fff;color:#000}</style></head><body><div id="root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`
  })()
  return page
}

interface Measured {
  name: string
  kind: string
  size: number
  /** The centre of the cut's bounding box from the disc's centre, in CSS pixels. */
  centre: {x: number; y: number}
  /** The centre of the glyph's own geometry's bounding box, stroke included, from the disc's centre, in units. */
  geometry: {x: number; y: number}
  /** The stroke the cut was drawn at, in CSS pixels. */
  stroke: number
}

async function measure(target: Page, cells: BadgeCell[], density: number): Promise<Measured[]> {
  // Decoded before they're drawn, so the SVG masks' images are there for the screenshot.
  await target.evaluate(
    values =>
      Promise.all(
        values.map(value => {
          const image = new Image()
          image.src = /^url\("(.*)"\)$/u.exec(value)![1]!
          return image.decode()
        }),
      ),
    Object.values(tokens).filter(value => value.startsWith('url(')),
  )
  await target.evaluate(cells => window.showBadges(cells), cells)
  await expect(target.locator('.pk-svg-icon rect')).toHaveCount(cells.filter(cell => cell.kind === 'svg-icon').length)
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const boxes = await target.evaluate(
    cells =>
      cells.map(cell => {
        const candidates =
          cell.kind === 'icon'
            ? document.querySelectorAll(`div > [data-icon="${cell.name}"]`)
            : document.querySelectorAll(`.pk-svg-icon[data-icon="${cell.name}"] rect`)
        const element = [...candidates].find(item => Math.abs(item.getBoundingClientRect().width - cell.size) < 0.01)!
        const {x, y, width} = element.getBoundingClientRect()
        return {x, y, size: width}
      }),
    cells,
  )
  const shot = await target.screenshot({scale: 'device', fullPage: true})
  return target.evaluate(
    async ([url, cells, boxes, glyphs, unit, discRadius, scale]) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', {willReadFrequently: true})!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      // Black on white: inside the disc, white is the glyph cut out of it.
      const cutAt = (x: number, y: number) => {
        const index = (y * canvas.width + x) * 4
        return (data[index]! + data[index + 1]! + data[index + 2]!) / 765
      }
      // A glyph's ink area, in square units, with its strokes drawn `width` wide: its own geometry, finely rasterised.
      const resolution = 24
      const reference = document.createElement('canvas')
      reference.width = reference.height = unit * resolution
      const drawing = reference.getContext('2d', {willReadFrequently: true})!
      const inkArea = (paths: string[], width: number) => {
        drawing.setTransform(1, 0, 0, 1, 0, 0)
        drawing.clearRect(0, 0, reference.width, reference.height)
        drawing.setTransform(resolution, 0, 0, resolution, 0, 0)
        drawing.lineWidth = width
        drawing.lineCap = 'round'
        drawing.lineJoin = 'round'
        for (const d of paths) drawing.stroke(new Path2D(d))
        const pixels = drawing.getImageData(0, 0, reference.width, reference.height).data
        let sum = 0
        for (let index = 3; index < pixels.length; index += 4) sum += pixels[index]!
        return sum / 255 / resolution / resolution
      }
      // A glyph's ink's bounding box's centre, in units from the box's centre, drawn at its own stroke.
      const inkCentre = (paths: string[], width: number) => {
        inkArea(paths, width)
        const pixels = drawing.getImageData(0, 0, reference.width, reference.height).data
        let left = Infinity
        let right = -Infinity
        let top = Infinity
        let bottom = -Infinity
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index]! < 128) continue
          const pixel = (index - 3) / 4
          const x = pixel % reference.width
          const y = Math.floor(pixel / reference.width)
          left = Math.min(left, x)
          right = Math.max(right, x + 1)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y + 1)
        }
        return {x: (left + right) / 2 / resolution - unit / 2, y: (top + bottom) / 2 / resolution - unit / 2}
      }
      // The stroke each glyph's ink area comes from, from half its drawn stroke to twice it.
      const strokeOf = new Map<string, (area: number) => number>()
      for (const [name, {paths, stroke}] of Object.entries(glyphs)) {
        const widths = Array.from({length: 31}, (_, index) => stroke * (0.5 + index * 0.05))
        const areas = widths.map(width => inkArea(paths, width))
        strokeOf.set(name, area => {
          const index = areas.findIndex(value => value >= area)
          if (index <= 0) return index === 0 ? widths[0]! : widths.at(-1)!
          const t = (area - areas[index - 1]!) / (areas[index]! - areas[index - 1]!)
          return widths[index - 1]! + t * (widths[index]! - widths[index - 1]!)
        })
      }
      return cells.map((cell, index) => {
        const {x, y, size} = boxes[index]!
        const k = (size * scale) / unit
        const left = x * scale
        const top = y * scale
        const centre = {x: left + (size * scale) / 2, y: top + (size * scale) / 2}
        // Clear of the disc's own antialiased edge.
        const inner = discRadius * k - 0.6
        let area = 0
        // The cut's darkest pixel in each column and row: an edge pixel's coverage places the edge within it.
        const columns = new Map<number, number>()
        const rows = new Map<number, number>()
        for (let row = Math.floor(top); row < Math.ceil(top + size * scale); row++) {
          for (let column = Math.floor(left); column < Math.ceil(left + size * scale); column++) {
            if (Math.hypot(column + 0.5 - centre.x, row + 0.5 - centre.y) >= inner) continue
            const cut = cutAt(column, row)
            area += cut
            // The box is taken further in, clear of the disc's edge as an SVG mask's resampled image blurs it at 1x.
            if (Math.hypot(column + 0.5 - centre.x, row + 0.5 - centre.y) >= discRadius * k - 1.5) continue
            columns.set(column, Math.max(columns.get(column) ?? 0, cut))
            rows.set(row, Math.max(rows.get(row) ?? 0, cut))
          }
        }
        const middle = (profile: Map<number, number>) => {
          const inked = [...profile].filter(([, cut]) => cut > 0.05).sort(([a], [b]) => a - b)
          if (!inked.length) return NaN
          const [first, firstCut] = inked[0]!
          const [last, lastCut] = inked.at(-1)!
          return (first + 1 - firstCut + last + lastCut) / 2
        }
        const {paths, stroke} = glyphs[cell.name]!
        return {
          name: cell.name,
          kind: cell.kind,
          size: cell.size,
          centre: {x: (middle(columns) - centre.x) / scale, y: (middle(rows) - centre.y) / scale},
          geometry: inkCentre(paths, stroke),
          stroke: (strokeOf.get(cell.name)!(area / k / k) * size) / unit,
        }
      })
    },
    [`data:image/png;base64,${shot.toString('base64')}`, cells, boxes, glyphs, box, discRadius, density] as const,
  )
}

for (const density of densities) {
  test(`badge glyphs' boxes are centred on their discs and drawn at one stroke, in pixels (${density}x)`, async ({browser}, info) => {
    test.skip(info.project.name.endsWith('-mobile'), 'the desktop projects cover both engines; each density is set here')
    const context = await browser.newContext({deviceScaleFactor: density, viewport: {width: 480, height: 160}})
    const target = await context.newPage()
    await target.setContent(await badgePage())
    const cells: BadgeCell[] = (['icon', 'svg-icon'] as const).flatMap((kind, k) =>
      sizes.flatMap((size, s) =>
        badgeIconNames.map((name, column) => ({name, kind, size, x: 8 + column * 28, y: 8 + (k * sizes.length + s) * 28})),
      ),
    )
    const measured = await measure(target, cells, density)
    await context.close()
    const failures: string[] = []
    for (const cell of measured) {
      const label = `${cell.kind} ${cell.name} at ${cell.size}px`
      if (!ringCentred.has(cell.name) && !(Math.hypot(cell.geometry.x, cell.geometry.y) <= 0.05)) {
        failures.push(
          `${label}: drawn with its ink's box centred ${cell.geometry.x.toFixed(2)}, ${cell.geometry.y.toFixed(2)} units from the disc's centre`,
        )
      }
      const expected = {x: (cell.geometry.x * cell.size) / box, y: (cell.geometry.y * cell.size) / box}
      const off = Math.hypot(cell.centre.x - expected.x, cell.centre.y - expected.y)
      if (!(off <= 0.25)) {
        failures.push(
          `${label}: cut's box centred ${cell.centre.x.toFixed(2)}, ${cell.centre.y.toFixed(2)} CSS px from the disc's centre, drawn at ${expected.x.toFixed(2)}, ${expected.y.toFixed(2)}`,
        )
      }
    }
    for (const kind of ['icon', 'svg-icon']) {
      for (const size of sizes) {
        const group = measured.filter(cell => cell.kind === kind && cell.size === size)
        const strokes = group.map(cell => cell.stroke)
        const spread = Math.max(...strokes) - Math.min(...strokes)
        // Within a device pixel at 1x, where Chromium's mask rasterisation moves a glyph's cut by up to a few tenths of a
        // pixel either way with how its strokes meet the pixel grid; within 0.2 CSS px at 2x.
        if (!(spread <= (density === 1 ? 0.35 : 0.2))) {
          failures.push(
            `${kind} at ${size}px: glyphs cut at strokes ${spread.toFixed(2)} CSS px apart (${group.map(cell => `${cell.name} ${cell.stroke.toFixed(2)}`).join(', ')})`,
          )
        }
        // As heavy as drawn: a CSS mask cuts each glyph at its stroke (an SVG mask's images are resampled, a little heavier in Chromium).
        const drawn = (glyphs.added!.stroke / box) * size
        const median = [...strokes].sort((a, b) => a - b)[Math.floor(strokes.length / 2)]!
        if (!(median >= drawn * 0.9 && median <= drawn * (kind === 'icon' ? 1.1 : 1.25))) {
          failures.push(`${kind} at ${size}px: glyphs cut at a stroke of ${median.toFixed(2)} CSS px, drawn at ${drawn.toFixed(2)}`)
        }
      }
    }
    if (process.env.BADGE_REPORT) {
      console.log(
        info.project.name,
        density,
        JSON.stringify(
          measured.map(
            cell =>
              `${cell.kind} ${cell.size} ${cell.name} ${cell.centre.x.toFixed(2)},${cell.centre.y.toFixed(2)} ${cell.stroke.toFixed(2)}`,
          ),
        ),
      )
    }
    expect(failures).toEqual([])
  })
}

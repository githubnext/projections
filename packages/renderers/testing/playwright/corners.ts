/*
 * Rounded corners, checked in pixels: a bordered box's border keeps its thickness around each curve, and nothing
 * inside it paints over the border or outside its curve. A filled band in a rounded container (a header, a footer, a
 * change row at its edge) must follow the container's inner radius (its outer radius less the border), or be clipped
 * to it; one with square corners covers the inside of the border's curve, and the border thins there.
 */
import type {Locator, Page} from '@playwright/test'
import type {CornerMeasure, CornerProbe} from './corners/analyze.js'
import {measureCorners} from './corners/analyze.js'

export type {CornerMeasure, CornerProbe, CornerRay, CornerSide} from './corners/analyze.js'

/** A bordered box with rounded corners, by its outer edge in page CSS px. */
export interface CornerBox {
  left: number
  top: number
  right: number
  bottom: number
  /** Outer radii: top-left, top-right, bottom-right, bottom-left. */
  radii: [number, number, number, number]
  /** Border widths: top, right, bottom, left. */
  borders: [number, number, number, number]
}

/** What `cornerReport` found: each corner's measures and, for a corner out of line, why. */
export interface CornerReport {
  corners: CornerMeasure[]
  failures: string[]
  /** With failures, each failing corner's picture (a PNG data URL), to attach. */
  pictures?: {[corner: string]: string}
}

/**
 * The box a locator draws, scrolled into view (`align`: its top or its bottom edge first, for a box taller than the
 * view): an element's border box, radii and solid border widths, or its solid outline where it has no border (an edge
 * drawn inside its box with a negative `outline-offset`, as database cards do), or an SVG `rect`'s stroked outline (its
 * stroke centred on its edge; none when dashed). `frame` is the width of an edge its contents draw instead, along its
 * rounded edge: a data table's scroll box, whose rows draw its lines. `null` when it has no rounded, edged corner.
 */
export async function cornerBox(
  locator: Locator,
  {align, frame}: {align?: 'start' | 'end'; frame?: number} = {},
): Promise<CornerBox | null> {
  if (align) {
    await locator.evaluate((element, block) => element.scrollIntoView({block, inline: 'nearest'}), align)
    // With room past the edge for its corners' pictures, scrolling the host page too: a sandboxed frame as tall as its
    // content can't scroll it (WebKit).
    const placed = await locator.boundingBox()
    const view = locator.page().viewportSize()
    const room = 24
    if (placed && view) {
      const by = align === 'start' ? placed.y - room : placed.y + placed.height + room - view.height
      await locator.page().evaluate(by => window.scrollBy(0, by), by)
    }
  } else await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) return null
  const drawn = await locator.evaluate((element, frame) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (element instanceof SVGRectElement) {
      const matrix = element.getScreenCTM()
      const unit = matrix ? Math.hypot(matrix.a, matrix.b) : 1
      // A dashed outline has no thickness to keep around its curve.
      const stroke = style.stroke === 'none' || style.strokeDasharray !== 'none' ? 0 : parseFloat(style.strokeWidth) * unit
      // CSS `rx` wins where it applies, `0px` included; the attribute only where it is `auto` or unset.
      const css = parseFloat(style.getPropertyValue('rx'))
      const rx = Number.isNaN(css) ? element.rx.baseVal.value : css
      return {
        svg: true,
        width: rect.width,
        height: rect.height,
        radii: [rx, rx, rx, rx].map(r => r * unit),
        borders: [stroke, stroke, stroke, stroke],
        outset: 0,
      }
    }
    const radius = (value: string) =>
      value.endsWith('%') ? (parseFloat(value) / 100) * Math.min(rect.width, rect.height) : parseFloat(value) || 0
    // Its layout width, before any transform on it or its ancestors, so the scale below takes them in.
    const laid = element instanceof HTMLElement && element.offsetWidth ? element.offsetWidth : rect.width
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(
      radius,
    )
    const borders = (['top', 'right', 'bottom', 'left'] as const).map(side =>
      style.getPropertyValue(`border-${side}-style`) === 'solid' ? parseFloat(style.getPropertyValue(`border-${side}-width`)) : 0,
    )
    if (frame !== undefined) return {svg: false, width: laid, height: rect.height, radii, borders: [frame, frame, frame, frame], outset: 0}
    const outline = style.outlineStyle === 'solid' ? parseFloat(style.outlineWidth) : 0
    if (borders.some(width => width > 0) || !outline) return {svg: false, width: laid, height: rect.height, radii, borders, outset: 0}
    // An outline's outer edge lies its offset plus its width outside the box, and its corners follow the radii there.
    const outset = parseFloat(style.outlineOffset) + outline
    return {svg: false, width: laid, height: rect.height, radii, borders: [outline, outline, outline, outline], outset}
  }, frame)
  // How much it is scaled, by a transform on it, an ancestor or the host's frame (a transformed stage): the box in the
  // page against its own layout box (an SVG rect's is already in screen units).
  const scale = drawn.width ? box.width / drawn.width : 1
  const inflate = drawn.svg ? drawn.borders[0]! / 2 : drawn.outset
  const left = box.x - inflate * scale,
    top = box.y - inflate * scale
  const width = box.width + 2 * inflate * scale,
    height = box.height + 2 * inflate * scale
  let radii = drawn.radii.map(r => (r > 0 ? Math.max(0, r + inflate) : 0) * scale) as CornerBox['radii']
  // As a browser does, scale every radius down when two on a side overlap.
  const fit = Math.min(
    1,
    width / (radii[0] + radii[1] || 1),
    width / (radii[3] + radii[2] || 1),
    height / (radii[0] + radii[3] || 1),
    height / (radii[1] + radii[2] || 1),
  )
  radii = radii.map(r => r * fit) as CornerBox['radii']
  const borders = drawn.borders.map(b => b * scale) as CornerBox['borders']
  if (!radii.some(r => r >= 2) || !borders.some(b => b > 0)) return null
  return {left, top, right: left + width, bottom: top + height, radii, borders}
}

const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

/** Where to picture each of a box's corners, and how to measure it there. */
function cornerProbes(
  box: CornerBox,
  corners: number[],
  viewport: {width: number; height: number} | null,
): {clip: {x: number; y: number; width: number; height: number}; probe: Omit<CornerProbe, 'url'>}[] {
  const probes: {clip: {x: number; y: number; width: number; height: number}; probe: Omit<CornerProbe, 'url'>}[] = []
  for (const index of corners) {
    const name = names[index]!
    const radius = box.radii[index]!
    const vertical = box.borders[index === 0 || index === 3 ? 3 : 1],
      horizontal = box.borders[index < 2 ? 0 : 2]
    if (!vertical || vertical !== horizontal || radius < vertical + 1) continue
    const width = vertical
    const out = {x: index === 0 || index === 3 ? -1 : 1, y: index < 2 ? -1 : 1}
    const cornerX = out.x < 0 ? box.left : box.right,
      cornerY = out.y < 0 ? box.top : box.bottom
    // On each side, a point past the curve (or the side's middle on a short side), with the inward normal there.
    const alongY = Math.min(radius + 3, (box.bottom - box.top) / 2),
      alongX = Math.min(radius + 3, (box.right - box.left) / 2)
    const sides: CornerProbe['sides'] = [
      {x: cornerX, y: cornerY - out.y * alongY, nx: -out.x, ny: 0},
      {x: cornerX - out.x * alongX, y: cornerY, nx: 0, ny: -out.y},
    ]
    const reach = Math.max(radius, alongX, alongY) + width + 4
    const x = Math.floor(out.x < 0 ? cornerX - 5 : cornerX - reach),
      y = Math.floor(out.y < 0 ? cornerY - 5 : cornerY - reach)
    const clip = {x, y, width: Math.ceil(reach + 5), height: Math.ceil(reach + 5)}
    if (viewport && (clip.x < 0 || clip.y < 0 || clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height)) continue
    probes.push({
      clip,
      probe: {
        name,
        origin: {x: clip.x, y: clip.y},
        centre: {x: cornerX - out.x * radius, y: cornerY - out.y * radius},
        out,
        radius,
        width,
        sides,
      },
    })
  }
  return probes
}

/**
 * Measures a box's rounded corners in pixels and returns what is wrong with them: a border that thins or thickens
 * around a curve against its own sides, a third colour inside it (a fill that isn't concentric with it) or paint
 * outside the curve. Corners need the same border on both their sides and a radius larger than it; others are skipped. Take the page at a device scale of 2 or more for a precise measure.
 */
export async function cornerReport(
  page: Page,
  target: Locator | CornerBox,
  {label = 'box', frame}: {label?: string; frame?: number} = {},
): Promise<CornerReport> {
  const scale = await page.evaluate(() => devicePixelRatio)
  const probes: CornerProbe[] = []
  // A locator's top corners, then its bottom ones, each pair in view in turn, so a box taller than the view is measured.
  const passes: [() => Promise<CornerBox | null>, number[]][] =
    'left' in target
      ? [[async () => target, [0, 1, 2, 3]]]
      : [
          [() => cornerBox(target, {align: 'start', ...(frame === undefined ? {} : {frame})}), [0, 1]],
          [() => cornerBox(target, {align: 'end', ...(frame === undefined ? {} : {frame})}), [2, 3]],
        ]
  for (const [find, corners] of passes) {
    const box = await find()
    if (!box) continue
    for (const {clip, probe} of cornerProbes(box, corners, page.viewportSize())) {
      const buffer = await page.screenshot({clip, animations: 'disabled', caret: 'hide', scale: 'device'})
      probes.push({...probe, url: `data:image/png;base64,${buffer.toString('base64')}`})
    }
  }
  const corners = await page.evaluate(measureCorners, [probes, scale] as [CornerProbe[], number])
  const failing = corners.map(corner => cornerFailures(corner, scale, label))
  const failures = failing.flat()
  if (!failures.length) return {corners, failures}
  const pictures = Object.fromEntries(probes.filter((_, index) => failing[index]!.length).map(probe => [probe.name, probe.url]))
  return {corners, failures, pictures}
}

/**
 * Within a quarter CSS pixel, plus half a device pixel of antialiasing, of its sides; between them where they differ
 * (a change run's strong side edge turning into a plain bottom border).
 */
function cornerFailures(corner: CornerMeasure, scale: number, label: string): string[] {
  const tolerance = 0.25 + 0.5 / scale
  // A colour this far from every blend of outside, border and inside, or from the outside past the curve.
  const stray = 60
  const sides = corner.sides.filter((side): side is number => side !== null)
  const failures: string[] = []
  for (const ray of corner.rays) {
    const at = `${label} ${corner.name} corner at ${ray.angle}°`
    if (ray.thickness !== null && sides.length) {
      const low = Math.min(...sides) - tolerance,
        high = Math.max(...sides) + tolerance
      if (ray.thickness < low || ray.thickness > high)
        failures.push(
          `${at}: the border is ${ray.thickness.toFixed(2)} px around the curve but ${sides.map(side => side.toFixed(2)).join(' and ')} px on its sides`,
        )
    }
    if (ray.foreign > stray)
      failures.push(`${at}: a colour that is neither the border nor what it edges shows in the border (a fill not concentric with it)`)
    if (ray.outside > stray) failures.push(`${at}: paint shows outside the curve`)
  }
  return failures
}

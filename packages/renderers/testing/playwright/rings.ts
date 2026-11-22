import type {Frame, Page} from '@playwright/test'
import {analyze} from './rings/analyze.js'
import type {Line} from './rings/analyze.js'
import {dropFarRings, markOccludedEdges, sideFailures} from './rings/judge.js'

/**
 * Pixel checks of item rings: whether the ring painted over an item replaces
 * the item's own painted edge. Each sample line runs from outside the item,
 * across its edge, inwards (through the middle of each side and the middle
 * of each corner's arc). Along it, the item's edge is where the neutral
 * picture departs from what is outside, and the ring is where the ringed
 * picture departs from the neutral one. They must start at the same place
 * (the ring has the item's outer rectangle and radii), the ring must cover
 * the whole edge band (no second edge inside it, none left outside), and it
 * must be painted on every line (not clipped). Pictures are compared in
 * device pixels; positions are reported in CSS pixels.
 *
 * Only what departs where the item's geometry puts its edge is that edge:
 * further out it is a neighbor (another item's outline or label), and more
 * than a pixel inside the box it is the item's inside (a sub-pixel border on
 * a zoomed-out item doesn't show). Such lines aren't measured. A line with no
 * ring where the item's edge is hidden in the neutral picture too (its own
 * label drawn over its outline: other content just outside it, no edge where
 * its geometry puts it, or a color unlike its edge elsewhere) is occluded, not
 * missing: the ring replaces the edge, gaps included; a side where the edge
 * is hidden at every line, with only a sliver of ring showing past what covers
 * it, isn't measured. A change further out
 * than the ring's stroke reaches (a focus tooltip, a label rings restyle)
 * isn't the ring. A dashed ring need only show on one line of each side, the
 * others may be gaps; an item smaller than `tinyRingItem` across, packed among
 * neighbors, is checked only for being ringed.
 */
export interface RingGeometry {
  /** Outer rectangle, in the frame's CSS pixels. */
  left: number
  top: number
  right: number
  bottom: number
  /** Corner radii (top-left, top-right, bottom-right, bottom-left), each horizontal then vertical. */
  radii: [number, number][]
  /** `box`: an HTML unit's outline; `inside`: a closed SVG edge's stroke; `halo`: an open SVG edge (a line), checked only by the `rings` check. */
  mode: 'box' | 'inside' | 'halo'
  /** The item paints an edge of its own; when it doesn't, only the ring's presence is checked. */
  edge?: boolean
  /**
   * How far the ring may start outside the item's edge: an SVG ring is its edge's own stroke, centered on the
   * shape, so a heavier ring reaches half its extra width further out.
   */
  outward?: number
  /** Per side (top, right, bottom, left): how far inside the item's edge it may start, where it is flush in an edged group whose edge stays. */
  inward?: [number, number, number, number]
  /** The ring is dashed (a keyboard focus ring can be): a sample line may fall in a gap. */
  dashed?: boolean
}

/**
 * What one sample line across an item's edge measured (`ringPixelReport`): positions are CSS px along the line from its
 * outer end, and `null` where nothing was found.
 */
export interface RingLineResult {
  line: string
  /** The item's edge is hidden here in the neutral picture too: drawn over, or not where its geometry puts it. */
  hidden: boolean
  /** The neutral picture's color at the item's edge, where it shows. */
  edgeColor: [number, number, number] | null
  /** Where the item's own edge starts along the line, or null when the item draws no edge there. */
  edge: number | null
  /** Where the item's edge band ends (where the picture settles to the item's inside). */
  edgeEnd: number | null
  /** Where the ring starts and ends along the line, or null when no ring is painted there. */
  ring: number | null
  ringEnd: number | null
  /** Outside the item, the picture along the line is one color, so its edge can be measured there. */
  clean: boolean
}

/** The result of `ringPixelReport`: every sample line it measured and, when a ring is misplaced, why, line by line. */
export interface RingPixelReport {
  lines: RingLineResult[]
  failures: string[]
  /** With failures, the neutral and ringed pictures (PNG data URLs) the lines were measured in, to attach. */
  pictures?: {neutral: string; ringed: string}
}

/** Below this size (CSS px across), an item's ring is only checked for being painted. */
export const tinyRingItem = 16

/** Sample lines for a ring: 8 px outside the outer edge to 14 px inside it. */
export function ringLines(ring: RingGeometry): Line[] {
  const outside = 8,
    inside = 14
  // Each side and corner at three places: a misplaced ring is off at all of them, while a line, shape or label
  // touching the item at one place (a relationship's end, a neighbor) only confuses that one.
  // A side's line within a corner's radius of its ends crosses that corner's curve, where the edge is inside the box.
  const radius = (corner: number, axis: number) => ring.radii[corner]?.[axis] ?? 0
  const curved = (from: number, to: number, start: number, end: number) => from < start - 0.5 || to < end - 0.5
  const lines: Line[] = [0.3, 0.5, 0.7].flatMap(at => {
    const width = ring.right - ring.left,
      height = ring.bottom - ring.top
    const x = ring.left + width * at,
      y = ring.top + height * at
    const across = [width * at, width * (1 - at)] as const,
      down = [height * at, height * (1 - at)] as const
    return [
      {
        name: `top@${at}`,
        x,
        y: ring.top - outside,
        dx: 0,
        dy: 1,
        length: outside + inside,
        curved: curved(...across, radius(0, 0), radius(1, 0)),
      },
      {
        name: `right@${at}`,
        x: ring.right + outside,
        y,
        dx: -1,
        dy: 0,
        length: outside + inside,
        curved: curved(...down, radius(1, 1), radius(2, 1)),
      },
      {
        name: `bottom@${at}`,
        x,
        y: ring.bottom + outside,
        dx: 0,
        dy: -1,
        length: outside + inside,
        curved: curved(...across, radius(3, 0), radius(2, 0)),
      },
      {
        name: `left@${at}`,
        x: ring.left - outside,
        y,
        dx: 1,
        dy: 0,
        length: outside + inside,
        curved: curved(...down, radius(0, 1), radius(3, 1)),
      },
    ]
  })
  const corners: [string, number, number, number, number][] = [
    ['top-left', ring.left, ring.top, 1, 1],
    ['top-right', ring.right, ring.top, -1, 1],
    ['bottom-right', ring.right, ring.bottom, -1, -1],
    ['bottom-left', ring.left, ring.bottom, 1, -1],
  ]
  corners.forEach(([name, cx, cy, sx, sy], index) => {
    const [rx, ry] = ring.radii[index] ?? [0, 0]
    // A square corner's diagonal grazes two antialiased edges at once; its sides are checked already.
    if (rx < 1 || ry < 1) return
    // Three places on the arc around its middle, each along the inward normal there.
    for (const degrees of [25, 45, 65]) {
      const angle = (degrees * Math.PI) / 180
      const px = cx + sx * rx * (1 - Math.cos(angle)),
        py = cy + sy * ry * (1 - Math.sin(angle))
      let nx = (sx * Math.cos(angle)) / rx,
        ny = (sy * Math.sin(angle)) / ry
      const norm = Math.hypot(nx, ny)
      nx /= norm
      ny /= norm
      lines.push({name: `${name}@${degrees}`, x: px - nx * outside, y: py - ny * outside, dx: nx, dy: ny, length: outside + inside})
    }
  })
  return lines
}

/** Takes the region's picture (`clip` in page CSS pixels) as a data URL. */
async function picture(page: Page, clip: {x: number; y: number; width: number; height: number}): Promise<string> {
  const buffer = await page.screenshot({clip, animations: 'disabled', caret: 'hide', scale: 'device'})
  return `data:image/png;base64,${buffer.toString('base64')}`
}

/**
 * Compares the neutral and ringed pictures of each ring's item. `ring` is
 * called to show the ring and `clear` to hide it; both must leave the page
 * painted. Failures name the line (side or corner) and the offset in CSS px.
 */
export async function ringPixelReport(
  page: Page,
  frame: Frame,
  geometry: RingGeometry,
  {
    ring,
    clear,
    offset = {x: 0, y: 0},
    label = 'ring',
  }: {ring: () => Promise<void>; clear: () => Promise<void>; offset?: {x: number; y: number}; label?: string},
): Promise<RingPixelReport> {
  const failures: string[] = []
  if (geometry.mode === 'halo') return {lines: [], failures}
  const lines = ringLines(geometry)
  const curved = new Set(lines.filter(line => line.curved).map(line => line.name))
  const margin = 10
  const clip = {
    x: Math.floor(geometry.left - margin + offset.x),
    y: Math.floor(geometry.top - margin + offset.y),
    width: Math.ceil(geometry.right - geometry.left + 2 * margin),
    height: Math.ceil(geometry.bottom - geometry.top + 2 * margin),
  }
  const viewport = page.viewportSize()
  if (viewport && (clip.x < 0 || clip.y < 0 || clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height)) {
    return {lines: [], failures}
  }
  await clear()
  const neutral = await picture(page, clip)
  await ring()
  const ringed = await picture(page, clip)
  const scale = await page.evaluate(() => devicePixelRatio)
  const pageLines = lines.map(line => ({...line, x: line.x + offset.x, y: line.y + offset.y}))
  const results = await page.evaluate(analyze, [neutral, ringed, {x: clip.x, y: clip.y}, scale, pageLines, geometry.mode] as [
    string,
    string,
    {x: number; y: number},
    number,
    Line[],
    string,
  ])
  // Half a CSS pixel, plus half a device pixel of antialiasing.
  const tolerance = 0.5 + 0.5 / scale
  markOccludedEdges(results)
  dropFarRings(results, geometry)
  const tiny = Math.min(geometry.right - geometry.left, geometry.bottom - geometry.top) < tinyRingItem
  if (tiny) {
    if (!results.some(result => result.ring !== null)) failures.push(`${label}: no ring is painted around it (missing or clipped)`)
    return {lines: results, failures}
  }
  failures.push(...sideFailures(results, geometry, {curved, tolerance, label}))
  return {lines: results, failures, ...(failures.length ? {pictures: {neutral, ringed}} : {})}
}

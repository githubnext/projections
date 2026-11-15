// Packing a snapshot into an area: nested circles sized by weight, at the largest scale that fits.
import {packEnclose} from 'd3-hierarchy'
import {arrange} from './arrange.js'
import {tree, type PackSettings, type Snapshot, type TreeNode} from './hierarchy.js'

/** A placed circle, in CSS px of the packed area. */
export interface Placement {
  x: number
  y: number
  r: number
  /** 1 for top-level items. */
  depth: number
  /** Drawn as a filled circle: a file, or a folder collapsed at the depth limit. */
  filled: boolean
  /** The aggregated weight of everything inside. */
  value: number
  /** The fill category of a filled circle (a collapsed folder takes its heaviest category). */
  category?: string
  /** The folder this circle is packed in; top-level circles have none. */
  parent?: string
}

export interface Packing {
  placements: Map<string, Placement>
  /** Each circle's centre relative to its folder's (to the top level's centre for top-level circles), in weight units: where a warm start continues from. */
  relative: Map<string, {x: number; y: number}>
  /** CSS px per square root of weight: a leaf's radius is `sqrt(weight) * scale`. */
  scale: number
  /** The bounds of everything drawn. */
  bounds: {x: number; y: number; width: number; height: number}
  /** The row standing for the whole hierarchy, when one root holds everything; it is not drawn. */
  root?: string
}

/** Smallest radius drawn, CSS px, so empty files stay visible and selectable. */
export const minimumRadius = 1.25
/**
 * Space between circles, as a share of the mean radius of the circles it
 * separates: between top-level items, inside folders holding folders and
 * inside folders holding only files. Relative spacing keeps the packing the
 * same shape at every scale, so one layout fits any area.
 */
const topGap = 0.14,
  folderGap = 0.16,
  fileGap = 0.08
/** Space kept between the packing and the edge of its area, CSS px. */
export const margin = 8

interface Packed {
  node: TreeNode
  /** Centre relative to the parent's centre. */
  x: number
  y: number
  r: number
  value: number
  children?: Packed[]
}

const mean = (circles: readonly {r: number}[]) => circles.reduce((sum, circle) => sum + circle.r, 0) / Math.max(1, circles.length)

/**
 * Packs a subtree bottom-up in weight units (a file's radius is the square
 * root of its weight): a folder's children are arranged around its centre
 * (see `arrange`), then enclosed in the smallest circle around them plus the
 * folder's padding.
 */
function packTree(node: TreeNode, smallest: number, previous?: ReadonlyMap<string, {x: number; y: number}>): Packed {
  if (!node.children) return {node, x: 0, y: 0, r: Math.max(smallest, Math.sqrt(node.value)), value: node.value}
  const kids = node.children.map(child => packTree(child, smallest, previous))
  const circles = kids.map(kid => ({x: 0, y: 0, r: kid.r, key: kid.node.id}))
  const gap = (node.children.some(child => child.children) ? folderGap : fileGap) * mean(circles)
  arrange(circles, 1, gap, previous)
  const enclosing = packEnclose(circles) ?? {x: 0, y: 0, r: 0}
  kids.forEach((kid, index) => {
    kid.x = circles[index]!.x - enclosing.x
    kid.y = circles[index]!.y - enclosing.y
  })
  return {node, x: 0, y: 0, r: enclosing.r + gap, value: kids.reduce((sum, kid) => sum + kid.value, 0), children: kids}
}

/**
 * Packs a snapshot into an area of `size` CSS px: every file a circle with
 * area proportional to its weight, nested in its folders' circles, the top
 * level spread to the area's aspect, at the largest scale that fits, unless
 * `fixed` sets the scale (diff mode packs the union at the after revision's
 * scale, so unchanged files keep their size). Each circle's place comes from
 * its own bearing, never from a ranking by weight, so a resized file never
 * reorders its siblings, and the same snapshot always packs the same way.
 * With `previous`, the packing continues from where the previous comparison
 * stage put each circle (see `arrange`).
 */
export function packSnapshot(
  snapshot: Snapshot,
  settings: PackSettings,
  size: {width: number; height: number},
  options: {fixed?: {scale: number}; previous?: Packing} = {},
): Packing {
  const {fixed} = options
  const previous = options.previous?.relative
  const {tops, root} = tree(snapshot, settings)
  const width = Math.max(1, size.width - 2 * margin),
    height = Math.max(1, size.height - 2 * margin)
  const empty = {
    placements: new Map(),
    relative: new Map(),
    scale: fixed?.scale ?? 1,
    bounds: {x: size.width / 2, y: size.height / 2, width: 0, height: 0},
  }
  if (!tops.length) return root === undefined ? empty : {...empty, root}
  // The smallest files are drawn at `minimumRadius`; their slots are packed that large too, so nothing overlaps.
  const pack = (smallest: number) => {
    const packed = tops.map(top => packTree(top, smallest, previous))
    const circles = packed.map(top => ({x: 0, y: 0, r: top.r, key: top.node.id}))
    arrange(circles, width / height, topGap * mean(circles), previous)
    packed.forEach((top, index) => {
      top.x = circles[index]!.x
      top.y = circles[index]!.y
    })
    const bounds = {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity}
    for (const circle of circles) {
      bounds.left = Math.min(bounds.left, circle.x - circle.r)
      bounds.right = Math.max(bounds.right, circle.x + circle.r)
      bounds.top = Math.min(bounds.top, circle.y - circle.r)
      bounds.bottom = Math.max(bounds.bottom, circle.y + circle.r)
    }
    const extent = {width: bounds.right - bounds.left, height: bounds.bottom - bounds.top}
    const scale = fixed?.scale ?? (extent.width > 0 && extent.height > 0 ? Math.min(width / extent.width, height / extent.height) : 1)
    return {packed, bounds, extent, scale}
  }
  // A scale estimate from the total weight at a conservative packing density; at the fitted scale the smallest
  // slots are about `minimumRadius` or more.
  let total = 0
  const visit = (node: TreeNode) => {
    total += node.value
    node.children?.forEach(visit)
  }
  tops.forEach(visit)
  const estimate = fixed?.scale ?? Math.sqrt((0.15 * width * height) / (Math.PI * Math.max(total, 1e-9)))
  let smallest = (minimumRadius * 1.2) / estimate
  let result = pack(smallest)
  // A sparser packing than estimated: pack once more with the slots the fitted scale needs.
  if (smallest * result.scale < minimumRadius * 0.9) {
    smallest = (minimumRadius * 1.2) / result.scale
    result = pack(smallest)
  }
  const {packed, bounds, extent, scale} = result
  const offset = {
    x: margin + width / 2 - ((bounds.left + bounds.right) / 2) * scale,
    y: margin + height / 2 - ((bounds.top + bounds.bottom) / 2) * scale,
  }
  const placements = new Map<string, Placement>()
  const relative = new Map<string, {x: number; y: number}>()
  const place = (item: Packed, x: number, y: number, depth: number, parent?: string) => {
    relative.set(item.node.id, {x: item.x, y: item.y})
    placements.set(item.node.id, {
      ...(parent === undefined ? {} : {parent}),
      x: offset.x + x * scale,
      y: offset.y + y * scale,
      r: Math.max(item.children ? 0 : minimumRadius, item.r * scale),
      depth,
      filled: item.node.filled,
      value: item.value,
      ...(item.node.category === undefined ? {} : {category: item.node.category}),
    })
    for (const child of item.children ?? []) place(child, x + child.x, y + child.y, depth + 1, item.node.id)
  }
  for (const top of packed) place(top, top.x, top.y, 1)
  return {
    placements,
    relative,
    scale,
    bounds: {
      x: offset.x + bounds.left * scale,
      y: offset.y + bounds.top * scale,
      width: extent.width * scale,
      height: extent.height * scale,
    },
    ...(root === undefined ? {} : {root}),
  }
}

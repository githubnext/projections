// Labels whose capitals aren't centred in the chip, bar or button they sit on (probe call `labels`).
import type {OffCentreLabel} from '../types.js'
import {colorAlpha, describe, effectiveOpacity, px, visuallyHidden} from './paint.js'

/** The tallest a chip, bar or button is, in CSS px: anything taller is a panel, whose text isn't centred in it. */
const tallest = 48
/**
 * How far apart the room above and below the capitals may be, in CSS px: half a pixel, the capitals a quarter pixel
 * off centre (half a device pixel at 2×), with room for layout's rounding to 1/64px.
 */
export const labelTolerance = 0.55

/** Whether an HTML element paints a surface its text sits on: a background, or edges above and below it. */
function paintsSurface(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  if (style.display === 'inline' || style.display === 'contents') return false
  if (colorAlpha(style.backgroundColor) > 0.05 || style.backgroundImage !== 'none') return true
  return (['top', 'bottom'] as const).every(
    side =>
      style.getPropertyValue(`border-${side}-style`) !== 'none' &&
      px(style.getPropertyValue(`border-${side}-width`)) > 0 &&
      colorAlpha(style.getPropertyValue(`border-${side}-color`)) > 0.05,
  )
}

function surfaceOf(element: Element, root: Element): HTMLElement | undefined {
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    if (node instanceof HTMLElement && paintsSurface(node)) return node
  }
  return undefined
}

/**
 * A surface's inner top and bottom: inside its borders, or in a table that collapses them, inside half of each rule
 * (which straddles the cells' edge), the one under it drawn by the cell below, in the next row of the table (another
 * section's first included); the table's last row has no rule under it.
 */
export function innerEdges(surface: HTMLElement, box: DOMRect, scale = 1): {top: number; bottom: number} {
  const style = getComputedStyle(surface)
  // Borders are laid out widths; the box is drawn, scaled.
  const width = (value: string) => px(value) * scale
  const [top, bottom] = [width(style.borderTopWidth), width(style.borderBottomWidth)]
  const table = surface.closest('table')
  if (!(surface instanceof HTMLTableCellElement) || !table || getComputedStyle(table).borderCollapse !== 'collapse') {
    return {top: box.top + top, bottom: box.bottom - bottom}
  }
  const row = surface.parentElement
  const next = row instanceof HTMLTableRowElement && table instanceof HTMLTableElement ? table.rows[row.rowIndex + 1] : undefined
  // The next row's rule, from any of its cells: one may span the column (a section's title).
  const under = next ? Math.max(0, ...[...next.cells].map(cell => width(getComputedStyle(cell).borderTopWidth))) : 0
  return {top: box.top + top / 2, bottom: box.bottom - Math.max(bottom, under) / 2}
}

/**
 * Whether a box is stretched by its row to well past its own line, so its text starts at its top as its neighbours'
 * do (a line number beside a wrapped line): a flex or grid row's item, stretched, over a line and a half tall.
 */
function stretched(surface: HTMLElement, line: Line): boolean {
  const parent = surface.parentElement
  if (!parent) return false
  const row = getComputedStyle(parent)
  const flexRow = row.display.includes('flex') && !row.flexDirection.startsWith('column')
  if (!flexRow && !row.display.includes('grid')) return false
  const self = getComputedStyle(surface).alignSelf
  const align = self === 'auto' ? row.alignItems : self
  const lineHeight = px(getComputedStyle(surface).lineHeight) || (line.baseline - line.capTop) * 2
  return (align === 'stretch' || align === 'normal') && surface.offsetHeight > 1.5 * lineHeight
}

interface Line {
  /** The capitals' top and the baseline, in viewport px, and the size of the text that sets them. */
  capTop: number
  baseline: number
  size: number
  /** Each text fragment's top, to tell one line from several. */
  tops: number[]
}

const fonts = new Map<string, {ascent: number; cap: number}>()

/**
 * How far a font's baseline lies under the top of a text fragment's box, and its cap height, as this engine lays them
 * out: measured once per font on a hidden line of its own, with an empty inline block on the baseline and one a `cap`
 * tall (the capitals' height `text-box` trims to). Canvas metrics can't say: WebKit rounds them, but not its layout,
 * and a glyph's ink differs between engines.
 */
function fontMetrics(style: CSSStyleDeclaration): {ascent: number; cap: number} {
  const properties = ['font-style', 'font-weight', 'font-stretch', 'font-size', 'font-family']
  const font = properties.map(property => style.getPropertyValue(property)).join('|')
  const known = fonts.get(font)
  if (known) return known
  const line = document.createElement('div')
  line.style.cssText = 'position: absolute; top: 0; left: -10000px; visibility: hidden; white-space: nowrap; line-height: normal'
  for (const property of properties) line.style.setProperty(property, style.getPropertyValue(property))
  const text = document.createTextNode('H')
  const baseline = document.createElement('span')
  baseline.style.cssText = 'display: inline-block; width: 0; height: 0'
  const cap = document.createElement('span')
  cap.style.cssText = 'display: inline-block; width: 0; height: 1cap'
  line.append(text, baseline, cap)
  document.body.append(line)
  const range = document.createRange()
  range.selectNodeContents(text)
  const metrics = {
    ascent: baseline.getBoundingClientRect().bottom - range.getBoundingClientRect().top,
    cap: cap.getBoundingClientRect().height,
  }
  line.remove()
  fonts.set(font, metrics)
  return metrics
}

/**
 * How much an element is drawn scaled from its layout (a renderer that zooms or fits its drawing with a transform): its
 * drawn height over its laid-out height, 1 when it has none.
 */
function drawnScale(element: HTMLElement): number {
  const laidOut = element.offsetHeight
  return laidOut > 0 ? element.getBoundingClientRect().height / laidOut : 1
}

/**
 * Where a text node's capitals and baseline are, in the page: its fragments are drawn scaled by `scale`, and its font's
 * metrics, measured on an untransformed line, are scaled with them.
 */
function capitals(text: Text, style: CSSStyleDeclaration, scale: number): Line | undefined {
  const metrics = fontMetrics(style)
  const [ascent, cap] = [metrics.ascent * scale, metrics.cap * scale]
  const range = document.createRange()
  range.selectNodeContents(text)
  const fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
  const [first] = fragments
  if (!first) return undefined
  // A text fragment's box is its font's ascent over its descent, whatever its line height or a trimmed text box.
  const baseline = first.top + ascent
  return {capTop: baseline - cap, baseline, size: px(style.fontSize), tops: fragments.map(rect => rect.top)}
}

/**
 * A surface's text so far with one more run: its main text, the runs in its largest font size, sets where the capitals
 * are (a title, not the smaller meta beside it; a name, not its key's smaller mono; words, not a code span set a pixel
 * smaller in them); every run counts toward whether the text is one line.
 */
function merged(known: Line | undefined, line: Line): Line {
  if (!known) return line
  const tops = [...known.tops, ...line.tops]
  if (line.size > known.size + 0.01) return {...line, tops}
  if (known.size > line.size + 0.01) return {...known, tops}
  return {capTop: Math.min(known.capTop, line.capTop), baseline: Math.max(known.baseline, line.baseline), size: known.size, tops}
}

/**
 * Every chip, bar or button whose one line of text isn't centred on its capitals: an HTML element at most 48px tall
 * that paints a background (or edges above and below), whose own text (the text it is the nearest such surface of)
 * is one line, its main text (its largest font size) with more room between its inner edge and the capitals' top than between the baseline and its inner
 * bottom edge, or less, by over half a pixel (`labelTolerance`). Text in SVG, visually hidden text and host chrome aren't labels here.
 */
export function offCentreLabels(root: Element = document.body): OffCentreLabel[] {
  const lines = new Map<HTMLElement, Line>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!(node instanceof Text) || !node.data.trim() || !(parent instanceof HTMLElement)) continue
    if (parent.closest('svg, script, style, [data-projections-host-overlay]')) continue
    const style = getComputedStyle(parent)
    if (style.visibility === 'hidden' || visuallyHidden(parent, style) || effectiveOpacity(parent) <= 0.01) continue
    const surface = surfaceOf(parent, root)
    const line = surface && capitals(node, style, drawnScale(surface))
    if (!surface || !line) continue
    lines.set(surface, merged(lines.get(surface), line))
  }
  const found: OffCentreLabel[] = []
  for (const [surface, line] of lines) {
    const box = surface.getBoundingClientRect()
    if (surface.offsetHeight > tallest || Math.max(...line.tops) - Math.min(...line.tops) > (line.baseline - line.capTop) / 2) continue
    if (stretched(surface, line)) continue
    // In the surface's own pixels, as it was laid out, however it is drawn.
    const scale = drawnScale(surface)
    const edges = innerEdges(surface, box, scale)
    const above = (line.capTop - edges.top) / scale
    const below = (edges.bottom - line.baseline) / scale
    // Text outside its surface (a label over a band's edge) isn't centred in it by design.
    if (above < 0 || below < 0) continue
    if (Math.abs(above - below) > labelTolerance) {
      found.push({element: describe(surface), above: Math.round(above * 100) / 100, below: Math.round(below * 100) / 100})
    }
  }
  return found
}

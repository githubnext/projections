// How a zoomable canvas opens: fitted, or at the readable text floor.
import type {OpeningCanvas, OpeningMeasurement} from '../types.js'
import {visuallyHidden, effectiveOpacity, visible, describe} from './paint.js'

/**
 * The zoomable canvases the renderer draws (scroll containers marked `data-zoom`), as they are now: for each, whether
 * every entity drawn in it (`data-entity-id`, or a presentation-only `data-graph-synthetic` card) lies inside its
 * visible area, and the smallest text it draws, at the scale it is drawn (an SVG's screen transform, or the CSS
 * transforms above HTML text). Visually hidden text doesn't count. `relationships` are the IDs of the relationships the
 * subject holds: lines, which may cross an edge of the view, unlike the cards they join.
 */
export function opening(root: Element = document.body, relationships: readonly string[] = []): OpeningMeasurement {
  const round = (value: number) => Math.round(value * 10) / 10
  const canvases = [...root.querySelectorAll<HTMLElement>('[data-zoom]')]
    .filter(element => visible(element) && element.clientWidth > 0 && element.clientHeight > 0)
    .map((element): OpeningCanvas => {
      const box = element.getBoundingClientRect()
      const area: OpeningCanvas['area'] = [
        Math.max(0, box.left + element.clientLeft),
        Math.max(0, box.top + element.clientTop),
        Math.min(innerWidth, box.left + element.clientLeft + element.clientWidth),
        Math.min(innerHeight, box.top + element.clientTop + element.clientHeight),
      ].map(round) as OpeningCanvas['area']
      const drawn = [...element.querySelectorAll('[data-entity-id], [data-graph-synthetic]')].filter(
        entity => visible(entity) && !visuallyHidden(entity, getComputedStyle(entity)),
      )
      let content: OpeningCanvas['content'] = null
      const outside: string[] = []
      const changes = {count: 0, inView: 0, whole: 0}
      for (const entity of drawn) {
        const rect = entity.getBoundingClientRect()
        const edges: [number, number, number, number] = [rect.left, rect.top, rect.right, rect.bottom]
        if (entity.hasAttribute('data-change')) {
          changes.count++
          if (edges[2] > area[0] && edges[0] < area[2] && edges[3] > area[1] && edges[1] < area[3]) changes.inView++
          if (edges[0] >= area[0] - 1 && edges[1] >= area[1] - 1 && edges[2] <= area[2] + 1 && edges[3] <= area[3] + 1) changes.whole++
        }
        content = content
          ? [Math.min(content[0], edges[0]), Math.min(content[1], edges[1]), Math.max(content[2], edges[2]), Math.max(content[3], edges[3])]
          : edges
        // A pixel of slack for borders and anti-aliasing at the area's edges.
        if (edges[0] < area[0] - 1 || edges[1] < area[1] - 1 || edges[2] > area[2] + 1 || edges[3] > area[3] + 1)
          outside.push(`${describe(entity)} at [${edges.map(Math.round).join(', ')}]`)
      }
      return {
        element: describe(element),
        zoom: Number(element.dataset.zoom ?? NaN),
        start: contentStart(drawn, area),
        cut: cutAtStart(drawn, area, new Set(relationships)),
        entities: drawn.length,
        area,
        content: content ? (content.map(round) as OpeningCanvas['content']) : null,
        outside: outside.slice(0, 5),
        changes,
        scrolls: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
        smallestText: smallestText(element),
      }
    })
  return {viewport: {width: innerWidth, height: innerHeight}, canvases}
}

/**
 * Where drawn content starts: of the outermost entities (nested ones, like a table's columns, belong to theirs), the
 * top row (those whose top is within the smallest entity's height of the topmost) and its leftmost entity. In view at
 * its `top-left` when that entity's top-left corner lies inside the visible `area`, at its `top-centre` (a centred
 * layout's opening) when the row's top and the middle of its extent do, or at the `drawing-top-left` when the row's top
 * and the leftmost entity's left side do (a layout whose top row can't be in view without cutting a card at the left
 * edge opens there); a pixel of slack; null without entities.
 */
function contentStart(drawn: Element[], area: OpeningCanvas['area']): OpeningCanvas['start'] {
  const outer = drawn
    .filter(entity => !entity.parentElement?.closest('[data-entity-id], [data-graph-synthetic]'))
    .map(entity => ({entity, rect: entity.getBoundingClientRect()}))
    .filter(({rect}) => rect.width > 0 && rect.height > 0)
  if (!outer.length) return null
  const top = Math.min(...outer.map(({rect}) => rect.top))
  const band = Math.min(...outer.map(({rect}) => rect.height))
  const row = outer.filter(({rect}) => rect.top <= top + band)
  const first = row.reduce((best, next) => (next.rect.left < best.rect.left ? next : best))
  const middle = (first.rect.left + Math.max(...row.map(({rect}) => rect.right))) / 2
  const across = (x: number) => x >= area[0] - 1 && x <= area[2] + 1
  const down = (y: number) => y >= area[1] - 1 && y <= area[3] + 1
  return {
    element: describe(first.entity),
    corner: [Math.round(first.rect.left * 10) / 10, Math.round(top * 10) / 10],
    inView: !down(top)
      ? false
      : across(first.rect.left)
        ? 'top-left'
        : across(middle)
          ? 'top-centre'
          : across(Math.min(...outer.map(({rect}) => rect.left)))
            ? 'drawing-top-left'
            : false,
  }
}

/**
 * The cards the visible `area`'s left or top edge cuts through, described with their boxes (at most a few): part in
 * view and part beyond that edge (a pixel of slack), where reading starts. A card is a drawn entity that holds no
 * other, so a group's frame around its cards, or a table around its columns, may cross the edge while what it holds
 * is whole. Lines don't count: a relationship (its ID in `relationships`) or a presentation-only one
 * (`data-graph-synthetic` without `data-projections-ring-item`, which marks a presentation-only card).
 */
function cutAtStart(drawn: Element[], area: OpeningCanvas['area'], relationships: ReadonlySet<string>): string[] {
  const cards = drawn
    .filter(entity =>
      entity.hasAttribute('data-entity-id')
        ? !relationships.has(entity.getAttribute('data-entity-id')!)
        : entity.hasAttribute('data-projections-ring-item'),
    )
    .map(entity => ({entity, rect: entity.getBoundingClientRect()}))
    .filter(({rect}) => rect.width > 0 && rect.height > 0)
  const holds = (outer: DOMRect, inner: DOMRect) =>
    inner !== outer &&
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.right <= outer.right + 1 &&
    inner.bottom <= outer.bottom + 1
  return cards
    .filter(({rect}) => !cards.some(other => holds(rect, other.rect)))
    .filter(({rect}) => {
      const across = rect.right > area[0] + 1 && rect.left < area[2] - 1,
        down = rect.bottom > area[1] + 1 && rect.top < area[3] - 1
      return (
        (down && rect.left < area[0] - 1 && rect.right > area[0] + 1) || (across && rect.top < area[1] - 1 && rect.bottom > area[1] + 1)
      )
    })
    .slice(0, 5)
    .map(({entity, rect}) => `${describe(entity)} at [${[rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(', ')}]`)
}

/** The smallest text drawn in `root`, in CSS px: its font size times the scale it is drawn at; null without any. */
function smallestText(root: Element): number | null {
  let smallest = Infinity
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement
    if (!element || !node.textContent?.trim() || !element.getClientRects().length) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || visuallyHidden(element, style) || effectiveOpacity(element) <= 0.01) continue
    let scale = 1
    const view = element.ownerDocument.defaultView!
    if (element instanceof view.SVGElement) {
      // Text and its spans: their screen transform holds every scale above them.
      const matrix = element instanceof view.SVGGraphicsElement ? element.getScreenCTM() : null
      if (!matrix) continue
      scale = Math.hypot(matrix.a, matrix.b)
    } else {
      // HTML text: the CSS transforms above it, and an SVG's screen transform when it sits in a foreignObject.
      const foreign = element.closest('foreignObject')
      for (let above: Element | null = element; above && above !== foreign; above = above.parentElement) {
        const transform = getComputedStyle(above).transform
        if (transform && transform !== 'none') {
          const matrix = new DOMMatrix(transform)
          scale *= Math.hypot(matrix.a, matrix.b)
        }
      }
      if (foreign) {
        const matrix = (foreign as SVGGraphicsElement).getScreenCTM()
        if (matrix) scale *= Math.hypot(matrix.a, matrix.b)
      }
    }
    const size = parseFloat(style.fontSize) * scale
    if (size > 0) smallest = Math.min(smallest, size)
  }
  return Number.isFinite(smallest) ? Math.round(smallest * 100) / 100 : null
}

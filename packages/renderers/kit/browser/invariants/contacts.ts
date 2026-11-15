// Arrowhead contact for Playwright specs: `arrowContacts` runs inside the renderer document (pass it to
// `locator('.pk').evaluate`), so it must stay self-contained: no imports or closures.

/** Issues for arrowheads that don't touch their target's border (within half a CSS pixel): see `arrowContacts`. */
export function contactIssues(contacts: readonly ArrowContact[]): string[] {
  return contacts
    .filter(contact => Math.abs(contact.gap) > 0.5)
    .map(
      contact =>
        `arrowhead ${contact.gap > 0 ? 'short of' : 'over'} its card's border by ${Math.abs(contact.gap).toFixed(2)}px: ${contact.key}`,
    )
}

/** Where a drawn arrowhead's painted tip lies relative to its target's painted border, in CSS pixels. */
export interface ArrowContact {
  key: string
  /** From the painted tip to the outer edge of the border, along the head's axis: 0 touches, positive leaves a gap, negative overlaps. */
  gap: number
}

/**
 * Measures every drawn arrowhead's contact with its target card from painted
 * geometry in CSS pixels: the head's outline with half its stroke (its round
 * joins reach that far past each corner) against the outer edge of the card's
 * border (an SVG outline with half its stroke, or an HTML card's box with any
 * outer ring). Covers kit graph heads (`.graph-arrowhead`), marker heads
 * (`path[marker-end]`, as `EdgeArrowMarker` draws them) and the database's
 * heads. Self-contained, like `measureFrame`.
 */
export function arrowContacts(root: Element): ArrowContact[] {
  type P = {x: number; y: number}
  const contacts: ArrowContact[] = []
  const points = (d: string): P[] => [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
  const scaleOf = (element: SVGGraphicsElement) => {
    const m = element.getScreenCTM()!
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))
  }
  const stroke = (element: Element) => {
    const style = getComputedStyle(element)
    return style.stroke === 'none' || style.stroke === '' ? 0 : Number.parseFloat(style.strokeWidth) || 0
  }
  const opacity = (element: Element) => {
    let value = 1
    for (let node: Element | null = element; node && node !== root; node = node.parentElement)
      value *= Number(node.getAttribute('opacity') ?? getComputedStyle(node).opacity)
    return value
  }
  /** The head's painted reach along its axis, and the axis (from the middle of its base to its tip), in screen space. */
  const head = (vertices: P[], strokeWidth: number) => {
    const [tip, left, right] = vertices as [P, P, P]
    const dx = tip.x - (left.x + right.x) / 2,
      dy = tip.y - (left.y + right.y) / 2
    const length = Math.hypot(dx, dy)
    const axis = {x: dx / length, y: dy / length}
    return {axis, reach: Math.max(...vertices.map(v => v.x * axis.x + v.y * axis.y)) + strokeWidth / 2}
  }
  /** The outer edge, along `axis`, of SVG border elements: the face nearest the head, half each stroke outside it. */
  const svgEdge = (elements: SVGGraphicsElement[], axis: P) =>
    Math.min(
      ...elements.map(element => {
        const box = element.getBBox(),
          m = element.getScreenCTM()!
        const corners = [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x, box.y + box.height],
          [box.x + box.width, box.y + box.height],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
        return Math.min(...corners.map(c => c.x * axis.x + c.y * axis.y)) - (stroke(element) * scaleOf(element)) / 2
      }),
    )
  const visible = (elements: Element[]) => elements.filter(element => opacity(element) > 0.01) as SVGGraphicsElement[]
  // Kit graph heads, drawn in their own layer.
  for (const group of root.querySelectorAll<SVGGElement>('.graph-link-head[data-edge-key]')) {
    const path = group.querySelector<SVGPathElement>('path.graph-arrowhead')
    const link = root.querySelector<SVGGElement>(`.graph-link[data-edge-key="${CSS.escape(group.dataset.edgeKey ?? '')}"]`)
    const card = link && root.querySelector(`.graph-node[data-entity-id="${CSS.escape(link.dataset.to ?? '')}"]`)
    // A head no more visible than a border `visible` ignores has nothing to be judged against.
    if (!path || !card || link.dataset.from === link.dataset.to || opacity(path) <= 0.01) continue
    const m = path.getScreenCTM()!
    const vertices = points(path.getAttribute('d') ?? '').map(v => new DOMPoint(v.x, v.y).matrixTransform(m))
    const {axis, reach} = head(vertices, stroke(path) * scaleOf(path))
    const borders = visible([...card.querySelectorAll(':scope > .node-surface, :scope > .node-emphasis')])
    contacts.push({key: group.dataset.edgeKey!, gap: svgEdge(borders, axis) - reach})
  }
  // Marker heads: the marker's outline placed at the path's end, turned to its final direction.
  for (const path of root.querySelectorAll<SVGPathElement>('[data-to-id] path[marker-end]')) {
    const link = path.closest<SVGGElement>('[data-to-id]')!
    const id = /url\(#(.+)\)/.exec(path.getAttribute('marker-end') ?? '')?.[1]
    const marker = id ? root.querySelector(`marker#${CSS.escape(id)} path`) : null
    const card = root.querySelector(`[data-unit-id="${CSS.escape(link.dataset.toId ?? '')}"]`)
    if (!marker || !card || path.closest('.di-link-halo')) continue
    const total = path.getTotalLength()
    const end = path.getPointAtLength(total),
      before = path.getPointAtLength(Math.max(0, total - 0.5))
    const angle = Math.atan2(end.y - before.y, end.x - before.x)
    const m = path.getScreenCTM()!
    const vertices = points(marker.getAttribute('d') ?? '').map(v =>
      new DOMPoint(
        end.x + v.x * Math.cos(angle) - v.y * Math.sin(angle),
        end.y + v.x * Math.sin(angle) + v.y * Math.cos(angle),
      ).matrixTransform(m),
    )
    const {axis, reach} = head(vertices, stroke(marker) * scaleOf(path))
    const borders = visible([...card.querySelectorAll(':scope > [class*="-surface"], :scope > [class*="-emphasis"]')])
    contacts.push({key: link.dataset.edgeKey ?? '', gap: svgEdge(borders, axis) - reach})
  }
  // Database heads, over HTML tables whose border is a ring outside their box.
  for (const path of root.querySelectorAll<SVGPathElement>('path.database-arrowhead[data-head-of-link]')) {
    const table = root.querySelector<HTMLElement>(`.database-table[data-entity-id="${CSS.escape(path.dataset.to ?? '')}"]`)
    if (!table) continue
    const m = path.getScreenCTM()!
    const vertices = points(path.getAttribute('d') ?? '').map(v => new DOMPoint(v.x, v.y).matrixTransform(m))
    const {axis, reach} = head(vertices, stroke(path) * scaleOf(path))
    const rect = table.getBoundingClientRect(),
      scale = rect.width / table.offsetWidth
    const style = getComputedStyle(table)
    // An outer ring (an inset-free box shadow's spread) paints outside the box; an outline drawn inset does not.
    const rings = style.boxShadow
      .split(/,(?![^(]*\))/)
      .filter(shadow => shadow.trim() !== 'none' && !/inset/.test(shadow))
      // A shadow's lengths are its x and y offsets, blur and spread, in px; its color may hold other numbers.
      .map(shadow => Number.parseFloat([...shadow.matchAll(/(-?[\d.]+)px/g)][3]?.[1] ?? '0') || 0)
    const outline =
      style.outlineStyle === 'none' ? 0 : Math.max(0, Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset))
    const ring = Math.max(0, ...rings, outline) * scale
    const corners = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.left, rect.bottom],
      [rect.right, rect.bottom],
    ].map(([x, y]) => x! * axis.x + y! * axis.y)
    contacts.push({key: path.dataset.headOfLink!, gap: Math.min(...corners) - ring - reach})
  }
  return contacts
}

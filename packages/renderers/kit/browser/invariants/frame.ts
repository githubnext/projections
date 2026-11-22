/**
 * Frame measurements for graph-family renderers, for Playwright specs that
 * drive a renderer in a real host frame. `measureFrame` runs inside the
 * renderer document (pass it to `locator('.pk').evaluate`), so it must stay
 * self-contained: no imports or closures.
 */
export interface FrameMeasurement {
  progress: number
  /** The diagram's `viewBox`, or undefined for HTML layouts. */
  viewBox: string | undefined
  /** Visible cards (opacity above 0.01) in CSS pixels from the diagram's corner (so scrolling never moves them), and their opacity. */
  cards: {id: string; opacity: number; box: {left: number; top: number; right: number; bottom: number}}[]
  /** Fully visible compound boundaries (architecture modules). */
  groups: string[]
  /** Change decoration still drawn: emphasis overlays, status marks and badges, change marks and was/now text colors. */
  decorated: string[]
  issues: string[]
}

export function measureFrame(root: Element): FrameMeasurement {
  const issues: string[] = []
  const svg = root.querySelector<SVGSVGElement>('svg.graph, svg.fp-packing') ?? undefined
  const opacityOf = (element: Element) => {
    let value = 1
    for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
      const attribute = node.getAttribute('opacity')
      value *= Number(attribute ?? getComputedStyle(node).opacity)
    }
    return value
  }
  // A view opened above its fit scrolls; positions are taken from the diagram's corner so scrolling never moves them.
  const origin = svg?.getBoundingClientRect() ?? {left: 0, top: 0}
  const cards = [...root.querySelectorAll<HTMLElement | SVGGElement>('.graph-node:not(.graph-group), .hierarchy-row, .fp-node')]
    .map(node => {
      const surface = node.querySelector('.node-surface, .fp-surface') ?? node
      const rect = surface.getBoundingClientRect()
      return {
        id: node.dataset.entityId ?? '',
        opacity: opacityOf(node),
        box: {left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top},
      }
    })
    .filter(card => card.opacity > 0.01)
  // Packed circles nest by design (files in folders); cards and rows must never overlap while visible.
  if (!root.querySelector('svg.fp-packing')) {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]!.box,
          b = cards[j]!.box
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          issues.push(`cards overlap: ${cards[i]!.id} / ${cards[j]!.id}`)
        }
      }
    }
    // A boundary and anything else visible either nest or keep apart: boundaries never pass through each other or a card.
    const boundaries = [...root.querySelectorAll<SVGGElement>('.graph-group')]
      .filter(group => opacityOf(group) > 0.01)
      .map(group => {
        const rect = group.querySelector('.node-surface')!.getBoundingClientRect()
        return {
          id: group.dataset.entityId ?? '',
          box: {
            left: rect.left - origin.left,
            top: rect.top - origin.top,
            right: rect.right - origin.left,
            bottom: rect.bottom - origin.top,
          },
        }
      })
    type Box = (typeof cards)[number]['box']
    const inside = (a: Box, b: Box) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1
    const overlap = (a: Box, b: Box) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
    for (const [index, boundary] of boundaries.entries()) {
      for (const other of [...boundaries.slice(index + 1), ...cards]) {
        if (overlap(boundary.box, other.box) && !inside(other.box, boundary.box) && !inside(boundary.box, other.box)) {
          issues.push(`boundary overlaps: ${boundary.id} / ${other.id}`)
        }
      }
    }
  } else {
    // Two visible circles either nest or keep apart: they never partly overlap.
    const circles = [...root.querySelectorAll<SVGGElement>('.fp-node:not(.fp-root)')]
      .filter(node => opacityOf(node) > 0.01)
      .map(node => {
        const rect = node.querySelector('.fp-surface')!.getBoundingClientRect()
        return {id: node.dataset.entityId ?? '', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2}
      })
      .filter(circle => circle.r > 0.5)
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i]!,
          b = circles[j]!
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const apart = distance >= a.r + b.r - 1
        const nested = distance + Math.min(a.r, b.r) <= Math.max(a.r, b.r) + 1
        if (!apart && !nested) issues.push(`circles overlap: ${a.id} / ${b.id}`)
      }
    }
  }
  // Every drawn arrow ends on its target card's border, measured in the diagram's own coordinates.
  if (svg) {
    const toSvg = svg.getScreenCTM()!.inverse()
    for (const link of root.querySelectorAll<SVGGElement>('.graph-link')) {
      if (link.dataset.from === link.dataset.to) continue
      const [x, y] = (link.dataset.end ?? '').split(',').map(Number) as [number, number]
      const target = root.querySelector<SVGGraphicsElement>(
        `.graph-node[data-entity-id="${CSS.escape(link.dataset.to ?? '')}"] .node-surface`,
      )
      if (!target) {
        issues.push(`arrow without a target card: ${link.dataset.edgeKey}`)
        continue
      }
      const local = target.getBBox(),
        matrix = toSvg.multiply(target.getScreenCTM()!)
      const corners = [new DOMPoint(local.x, local.y), new DOMPoint(local.x + local.width, local.y + local.height)].map(point =>
        point.matrixTransform(matrix),
      )
      const [x0, x1] = [Math.min(corners[0]!.x, corners[1]!.x), Math.max(corners[0]!.x, corners[1]!.x)]
      const [y0, y1] = [Math.min(corners[0]!.y, corners[1]!.y), Math.max(corners[0]!.y, corners[1]!.y)]
      const inside = x >= x0 - 1.5 && x <= x1 + 1.5 && y >= y0 - 1.5 && y <= y1 + 1.5
      const border = Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1)) < 1.5
      if (!Number.isFinite(x) || !Number.isFinite(y) || !inside || !border) issues.push(`detached arrow: ${link.dataset.edgeKey}`)
      // The drawn arrowhead points into the face it touches: from the middle of its base to its tip, along the inward normal.
      // Arrowheads are drawn in their own layer over the cards.
      const arrowhead = root.querySelector<SVGPathElement>(
        `.graph-link-head[data-edge-key="${CSS.escape(link.dataset.edgeKey ?? '')}"] path.graph-arrowhead`,
      )
      if (!arrowhead) issues.push(`relationship without an arrowhead: ${link.dataset.edgeKey}`)
      // …painted after its target card, so the tip sits on top of the card's border.
      else if (!(target.compareDocumentPosition(arrowhead) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        issues.push(`arrowhead painted under its card: ${link.dataset.edgeKey}`)
      }
      const head = arrowhead?.getAttribute('d')
      if (head) {
        const [tip, left, right] = [...head.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
        const faces = [
          [Math.abs(y - y0), 0, 1],
          [Math.abs(y - y1), 0, -1],
          [Math.abs(x - x0), 1, 0],
          [Math.abs(x - x1), -1, 0],
        ] as const
        const [, nx, ny] = faces.reduce((best, face) => (face[0] < best[0] ? face : best))
        const dx = tip!.x - (left!.x + right!.x) / 2,
          dy = tip!.y - (left!.y + right!.y) / 2
        if (!((dx * nx + dy * ny) / Math.hypot(dx, dy) > 0.9)) issues.push(`arrowhead points away from its card: ${link.dataset.edgeKey}`)
      }
      const path = link.querySelector('path.graph-edge')?.getAttribute('d') ?? ''
      if (/NaN|Infinity/u.test(path)) issues.push(`nonfinite route: ${link.dataset.edgeKey}`)
      // The shaft ends at the middle of the head's flat base and arrives along the head's axis, never at the tip.
      const [bx, by] = (arrowhead?.dataset.base ?? '').split(',').map(Number) as [number, number]
      const [ax, ay] = (arrowhead?.dataset.direction ?? '').split(',').map(Number) as [number, number]
      const coordinates = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(match => ({x: Number(match[1]), y: Number(match[2])}))
      const end = coordinates.at(-1),
        before = coordinates.at(-2)
      if (arrowhead && end && before) {
        if (Math.hypot(end.x - bx, end.y - by) > 0.05) issues.push(`shaft misses its arrowhead's base: ${link.dataset.edgeKey}`)
        const length = Math.hypot(end.x - before.x, end.y - before.y)
        if (length > 0.5 && (ax * (end.x - before.x) + ay * (end.y - before.y)) / length < 0.999) {
          issues.push(`shaft enters its arrowhead at an angle: ${link.dataset.edgeKey}`)
        }
      }
    }
  }
  const decorated = [
    ...root.querySelectorAll(
      '.node-emphasis, .node-status, .fp-emphasis, .badge, .pk-svg-status, .pk-status-text, .graph-edge-emphasis, [data-change], .pk-svg-was, .pk-svg-now',
    ),
  ]
    .filter(element => opacityOf(element) > 0.001)
    .map(element => `${element.getAttribute('class')}`)
  const groups = [...root.querySelectorAll<SVGGElement>('.graph-group')]
    .filter(group => opacityOf(group) > 0.999)
    .map(group => group.dataset.entityId ?? '')
  return {
    progress: Number((root as HTMLElement).dataset.progress),
    viewBox: svg?.getAttribute('viewBox') ?? undefined,
    cards,
    groups,
    decorated,
    issues,
  }
}

/**
 * Invariants for dependency-injection frames, shared by the unit tests and
 * the browser scrubbing suite. Each check returns a list of failures (empty
 * when the frame is coherent), so callers can report every problem at once.
 */

const overlaps = (a, b, gap = 0) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 - gap && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - gap

/**
 * A pure transition frame (`createDiTransition(model)(progress)`): visible
 * cards never overlap, links never outlive or precede their cards, and every
 * link joins two placed cards.
 */
export function checkTransitionFrame(frame, {width = 300, height = 100} = {}) {
  const errors = []
  const cards = new Map(frame.units.map(unit => [unit.id, unit]))
  const visible = frame.units.filter(unit => unit.opacity > 0.01)
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = {...visible[i], width, height},
        b = {...visible[j], width, height}
      if (overlaps(a, b)) errors.push(`cards overlap: ${a.id} / ${b.id}`)
    }
  }
  for (const link of frame.links) {
    const from = cards.get(link.fromId),
      to = cards.get(link.toId)
    if (!from || !to) {
      errors.push(`link ${link.key} has a missing card`)
      continue
    }
    if (link.opacity > Math.min(from.opacity, to.opacity) + 1e-9) errors.push(`link ${link.key} is more opaque than its cards`)
  }
  for (const unit of frame.units) if (!(unit.opacity > 0 && unit.opacity <= 1)) errors.push(`card ${unit.id} has opacity ${unit.opacity}`)
  return errors
}

/**
 * Runs inside the renderer document (pass to `evaluate`). Measures what was
 * actually painted: card boxes with their opacity, link endpoints in screen
 * space, and every element that carries change emphasis.
 */
/** @param {ParentNode} [root] */
export function measureRenderedFrame(root = document) {
  const svg = root.querySelector('svg.di-canvas')
  const pk = root.querySelector('.pk')
  if (!svg) return {progress: Number(pk?.dataset.progress), viewBox: null, cards: [], links: [], emphasis: 0, html: ''}
  /** @param {Element} element */
  const box = element => {
    const {x, y, width, height} = element.getBoundingClientRect()
    return {x, y, width, height}
  }
  const cards = [.../** @type {NodeListOf<SVGGElement>} */ (svg.querySelectorAll('.di-card'))].map(card => ({
    // Every card carries its unit's ID.
    id: /** @type {string} */ (card.dataset.unitId),
    opacity: Number(card.getAttribute('opacity')),
    box: box(card.querySelector('.di-card-surface')),
  }))
  const links = [...svg.querySelectorAll('.graph-edge')].map(path => {
    const group = path.closest('[data-edge-key]')
    const length = path.getTotalLength(),
      matrix = path.getScreenCTM()
    const start = path.getPointAtLength(0).matrixTransform(matrix)
    const base = path.getPointAtLength(length),
      previous = path.getPointAtLength(Math.max(0, length - 0.1))
    const tangent = Math.hypot(base.x - previous.x, base.y - previous.y) || 1
    // The marker's arrowhead extends the kit's `arrowHeadLength` (8.5 SVG units) beyond the path's end, its painted tip
    // touching the outer edge of the card's border (half a unit outside the card's box).
    const tip = new DOMPoint(
      base.x + ((base.x - previous.x) / tangent) * 8.5,
      base.y + ((base.y - previous.y) / tangent) * 8.5,
    ).matrixTransform(matrix)
    const points = []
    for (let at = 0; at <= length; at += 6) {
      const point = path.getPointAtLength(at).matrixTransform(matrix)
      points.push({x: point.x, y: point.y})
    }
    return {
      key: group.dataset.edgeKey,
      from: group.dataset.fromId,
      to: group.dataset.toId,
      opacity: Number(group.getAttribute('opacity')),
      start: {x: start.x, y: start.y},
      tip: {x: tip.x, y: tip.y},
      points,
    }
  })
  const emphasis = svg.querySelectorAll('.node-emphasis, .node-footer-band, .node-status, .graph-edge-emphasis').length
  // Attribute-level serialization: identical progress must paint an identical document.
  const html = JSON.stringify(
    [...svg.querySelectorAll('*')].map(element => [
      element.tagName,
      [...element.attributes]
        .filter(({name}) => name !== 'id' && !name.startsWith('marker'))
        .map(({name, value}) => [name, value])
        .toSorted((a, b) => (a[0] < b[0] ? -1 : 1)),
      element.childElementCount ? null : element.textContent,
    ]),
  )
  return {progress: Number(pk?.dataset.progress), viewBox: svg.getAttribute('viewBox'), cards, links, emphasis, html}
}

/** Checks a measured frame: geometry, link attachment and neutral endpoints. */
export function checkRenderedFrame(frame, {tolerance = 1.5} = {}) {
  const errors = []
  const cards = new Map(frame.cards.map(card => [card.id, card]))
  const visible = frame.cards.filter(card => card.opacity > 0.01)
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i].box,
        b = visible[j].box
      const centre = rect => ({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height})
      if (overlaps(centre(a), centre(b), 0.5)) errors.push(`cards overlap: ${visible[i].id} / ${visible[j].id}`)
    }
  }
  for (const link of frame.links) {
    const from = cards.get(link.from),
      to = cards.get(link.to)
    if (!from || !to) {
      errors.push(`link ${link.key} drawn without its cards`)
      continue
    }
    if (link.opacity > Math.min(from.opacity, to.opacity) + 0.001) errors.push(`link ${link.key} precedes or outlives its cards`)
    if (link.opacity <= 0.01) continue
    const target = to.box,
      source = from.box
    const onTop =
      link.tip.x >= target.x - tolerance &&
      link.tip.x <= target.x + target.width + tolerance &&
      Math.abs(link.tip.y - target.y) <= tolerance
    if (!onTop) errors.push(`link ${link.key} tip is detached from ${link.to}`)
    const onBottom =
      link.start.x >= source.x - tolerance &&
      link.start.x <= source.x + source.width + tolerance &&
      Math.abs(link.start.y - (source.y + source.height)) <= tolerance
    if (!onBottom) errors.push(`link ${link.key} tail is detached from ${link.from}`)
    for (const card of visible) {
      if (card.id === link.from || card.id === link.to) continue
      const inset = 2,
        {x, y, width, height} = card.box
      if (
        link.points.some(point => point.x > x + inset && point.x < x + width - inset && point.y > y + inset && point.y < y + height - inset)
      ) {
        errors.push(`link ${link.key} is drawn through ${card.id}`)
      }
    }
  }
  if ((frame.progress === 0 || frame.progress === 1) && frame.emphasis) {
    errors.push(`${frame.emphasis} emphasized elements at endpoint ${frame.progress}`)
  }
  return errors
}

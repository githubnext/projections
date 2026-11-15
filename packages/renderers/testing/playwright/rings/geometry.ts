// Where a unit's ring is drawn, measured in its frame (the measurement runs in the page, self-contained).
import type {Frame} from '@playwright/test'
import type {RingGeometry} from '../rings.js'

/**
 * The geometry of `id`'s units in `frame` (with `focused`, only the one
 * around the focused element), in the frame's CSS pixels, while
 * their ring shows: an HTML unit's border box and radii (the outline the SDK
 * draws inside it), or an SVG unit's marked edge (`data-projections-edge`):
 * its painted box, with the ring stroke's half width allowed outside.
 */
export async function ringGeometry(frame: Frame, id: string, {focused = false}: {focused?: boolean} = {}): Promise<RingGeometry[]> {
  return frame.evaluate(
    ([id, focused]) => {
      const px = (value: string) => parseFloat(value) || 0
      const unitOf = (element: Element): Element => {
        let unit = element
        for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement?.closest('[data-entity-id]') ?? null) {
          if (cursor.hasAttribute('data-projections-unit')) return cursor
          unit = cursor
        }
        return unit
      }
      // Keyboard focus rings only the unit around the focused element.
      const units = [
        ...new Set(
          [...document.querySelectorAll('[data-entity-id]')].filter(element => element.getAttribute('data-entity-id') === id).map(unitOf),
        ),
      ].filter(unit => !focused || unit.matches(':focus-visible, :has(:focus-visible)'))
      const corner = (value: string, width: number, height: number): [number, number] => {
        const [h = '0', v = h] = value.split(/\s+/)
        const length = (part: string, reference: number) => (part.endsWith('%') ? (px(part) / 100) * reference : px(part))
        return [length(h, width), length(v, height)]
      }
      return units.map(unit => {
        if (unit instanceof SVGElement && !(unit instanceof SVGSVGElement)) {
          const edges = [...unit.querySelectorAll('[data-projections-edge]'), ...(unit.hasAttribute('data-projections-edge') ? [unit] : [])]
          const shape = edges
            .map(edge => ({edge, box: edge.getBoundingClientRect()}))
            .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0]
          if (!shape) return {left: 0, top: 0, right: 0, bottom: 0, radii: [], mode: 'halo' as const}
          const element = shape.edge as SVGGeometryElement
          const style = getComputedStyle(element)
          const closed = ['rect', 'circle', 'ellipse', 'polygon'].includes(element.localName) || style.fill !== 'none'
          const matrix = element.getScreenCTM()!
          const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
          const stroke = px(style.strokeWidth) * (style.vectorEffect === 'non-scaling-stroke' ? 1 : scale)
          const {box} = shape
          const half = stroke / 2
          const tag = element.localName
          const rx =
            tag === 'rect'
              ? (px(style.getPropertyValue('rx')) || px(element.getAttribute('rx') ?? '')) * scale
              : tag === 'circle' || tag === 'ellipse'
                ? box.width / 2
                : 0
          const ry = tag === 'rect' ? rx : tag === 'circle' || tag === 'ellipse' ? box.height / 2 : 0
          // The neutral edge is thinner: its outer edge is up to half the ring stroke inside the ring's.
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            radii: [0, 1, 2, 3].map(() => [rx, ry] as [number, number]),
            mode: closed ? ('inside' as const) : ('halo' as const),
            edge: true,
            outward: half,
            dashed: style.strokeDasharray !== 'none' && style.strokeDasharray !== '',
          }
        }
        const rect = unit.getBoundingClientRect()
        const style = getComputedStyle(unit)
        const radii = [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ].map(value => corner(value, rect.width, rect.height))
        // Flush inside an edged group (a row in a rounded list), the group's edge stays outside the ring on those sides.
        const inward: [number, number, number, number] = [0, 0, 0, 0]
        for (let cursor = unit.parentElement; cursor && cursor !== document.body; cursor = cursor.parentElement) {
          const outer = getComputedStyle(cursor)
          const borders = ['Top', 'Right', 'Bottom', 'Left'].map(side =>
            outer.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none'
              ? 0
              : px(outer.getPropertyValue(`border-${side.toLowerCase()}-width`)),
          )
          if (!borders.some(Boolean)) continue
          const box = cursor.getBoundingClientRect()
          const flush = [
            Math.abs(rect.top - box.top - borders[0]!) < 0.75,
            Math.abs(box.right - borders[1]! - rect.right) < 0.75,
            Math.abs(box.bottom - borders[2]! - rect.bottom) < 0.75,
            Math.abs(rect.left - box.left - borders[3]!) < 0.75,
          ]
          flush.forEach((value, side) => {
            if (value) inward[side] = borders[side]!
          })
          break
        }
        // A rule a neighbor draws against a side (a row separator) is shared: it stays outside the ring too. The
        // neighbor may be an ancestor's, on a side the ancestor shares with the unit (a panel header's rule over the
        // first section of its body).
        const near = (a: number, b: number) => Math.abs(a - b) < 0.75
        for (let node: Element | null = unit; node && node !== document.body; node = node.parentElement) {
          const own = node.getBoundingClientRect()
          const shared = [near(own.top, rect.top), near(own.right, rect.right), near(own.bottom, rect.bottom), near(own.left, rect.left)]
          if (!shared.some(Boolean)) break
          for (const sibling of [node.previousElementSibling, node.nextElementSibling]) {
            if (!sibling) continue
            const box = sibling.getBoundingClientRect()
            const other = getComputedStyle(sibling)
            const rule = (side: string) =>
              other.getPropertyValue(`border-${side}-style`) === 'none' ? 0 : px(other.getPropertyValue(`border-${side}-width`))
            if (shared[2] && near(box.top, rect.bottom)) inward[2] = Math.max(inward[2], rule('top'))
            if (shared[0] && near(box.bottom, rect.top)) inward[0] = Math.max(inward[0], rule('bottom'))
            if (shared[1] && near(box.left, rect.right)) inward[1] = Math.max(inward[1], rule('left'))
            if (shared[3] && near(box.right, rect.left)) inward[3] = Math.max(inward[3], rule('right'))
          }
        }
        const visible =
          ['top', 'right', 'bottom', 'left'].some(
            side => px(style.getPropertyValue(`border-${side}-width`)) > 0 && style.getPropertyValue(`border-${side}-style`) !== 'none',
          ) ||
          style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
          inward.some(Boolean)
        const dashed = style.outlineStyle === 'dashed' || style.outlineStyle === 'dotted'
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          radii,
          mode: 'box' as const,
          edge: visible,
          inward,
          dashed,
        }
      })
    },
    [id, focused] as const,
  )
}

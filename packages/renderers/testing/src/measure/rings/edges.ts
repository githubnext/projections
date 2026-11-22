// How an element draws its own edge: borders, inset and spread shadows, outlines, radii and rounded clips.
import {px, colorAlpha} from '../paint.js'

interface EdgeBox {
  left: number
  top: number
  right: number
  bottom: number
  radii: [number, number][]
}
/** Solid, unshifted, unblurred shadow spreads: outside and inside the box. */
export function spreads(value: string): {outer: number; inner: number} {
  const result = {outer: 0, inner: 0}
  if (!value || value === 'none') return result
  for (const shadow of value.split(/,(?![^(]*\))/u)) {
    const colorless = shadow.replaceAll(/(?:rgba?|hsla?|color|oklch|oklab|lab|lch|hwb)\([^()]*\)/giu, '')
    const color = /(?:rgba?|hsla?|color|oklch|oklab|lab|lch|hwb)\([^()]*\)/iu.exec(shadow)?.[0] ?? 'black'
    const [x = 0, y = 0, blur = 0, spread = 0] = [...colorless.matchAll(/-?[\d.]+(?:px)?/gu)].map(match => px(match[0]))
    if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01 || blur > 0.01 || spread <= 0.01 || colorAlpha(color) <= 0.01) continue
    if (/\binset\b/u.test(shadow)) result.inner = Math.max(result.inner, spread)
    else result.outer = Math.max(result.outer, spread)
  }
  return result
}
function sideBorder(style: CSSStyleDeclaration, side: string): number {
  const kind = style.getPropertyValue(`border-${side}-style`)
  return kind === 'none' || kind === 'hidden' || colorAlpha(style.getPropertyValue(`border-${side}-color`)) <= 0.01
    ? 0
    : px(style.getPropertyValue(`border-${side}-width`))
}
function cornerRadius(value: string, width: number, height: number): [number, number] {
  const [h = '0', v = h] = value.split(/\s+/u)
  const length = (part: string, reference: number) => (part.endsWith('%') ? (px(part) / 100) * reference : px(part))
  return [length(h, width), length(v, height)]
}
/** Scales radii down as CSS does where adjacent ones overlap. */
function fitRadii(radii: [number, number][], width: number, height: number): [number, number][] {
  const [tl, tr, br, bl] = radii as [[number, number], [number, number], [number, number], [number, number]]
  const factor = Math.min(
    1,
    width / (tl[0] + tr[0] || 1),
    width / (bl[0] + br[0] || 1),
    height / (tl[1] + bl[1] || 1),
    height / (tr[1] + br[1] || 1),
  )
  return radii.map(([x, y]) => [x * factor, y * factor])
}
/** How an element draws its own edge, in its neutral state. */
export interface EdgeInfo {
  box: EdgeBox
  padding: EdgeBox
  /** A border, an inset shadow or an inside outline. */
  inside: boolean
  /** A spread shadow or an outline drawn outside the box: how far. */
  outside: number
  /** A rounded clip of its content. */
  clips: boolean
  surface: boolean
}
export function edgeOf(element: Element): EdgeInfo {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const shadow = spreads(style.boxShadow)
  const outline = style.outlineStyle !== 'none' && colorAlpha(style.outlineColor) > 0.01 ? px(style.outlineWidth) : 0
  const offset = px(style.outlineOffset)
  const radii = fitRadii(
    [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value =>
      cornerRadius(value, rect.width, rect.height),
    ),
    rect.width,
    rect.height,
  )
  const borders = ['top', 'right', 'bottom', 'left'].map(side => sideBorder(style, side))
  const rounded = radii.some(([x, y]) => x > 0.01 && y > 0.01)
  return {
    box: {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, radii},
    padding: {
      left: rect.left + borders[3]!,
      top: rect.top + borders[0]!,
      right: rect.right - borders[1]!,
      bottom: rect.bottom - borders[2]!,
      radii: [],
    },
    inside: borders.some(Boolean) || shadow.inner > 0 || (outline > 0 && offset + outline <= 0.01),
    outside: Math.max(shadow.outer, outline > 0 ? Math.max(0, offset + outline) : 0),
    clips: !(style.overflowX === 'visible' && style.overflowY === 'visible') && rounded,
    surface: colorAlpha(style.backgroundColor) > 0.01 || style.backgroundImage !== 'none',
  }
}
export const edged = (info: EdgeInfo) => info.inside || info.outside > 0 || info.clips

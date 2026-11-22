// The hue families of the theme's change and accent colors, and the hued paints of an element (probe call `accents`).
import type {AccentFamily} from '../../types.js'
import {normalizeColors, px} from '../paint.js'

type Rgba = [number, number, number, number]
/** One hued paint: its family and the property that paints it. */
export interface Paint {
  family: AccentFamily
  property: string
}
const families: readonly AccentFamily[] = ['added', 'removed', 'modified', 'moved', 'accent']
/** Least chroma (0–255, scaled by alpha) a color needs to read as a hue rather than a neutral. */
const leastChroma = 10
const hueTolerance = 30

function rgba(color: string): Rgba | undefined {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/iu.exec(color.trim())
  if (hex) {
    return [
      Number.parseInt(hex[1]!, 16),
      Number.parseInt(hex[2]!, 16),
      Number.parseInt(hex[3]!, 16),
      hex[4] ? Number.parseInt(hex[4], 16) / 255 : 1,
    ]
  }
  const match = /rgba?\(([^)]*)\)/u.exec(color)
  if (!match) return undefined
  const [r = 0, g = 0, b = 0, a = 1] = match[1]!
    .split(/[\s,/]+/u)
    .filter(Boolean)
    .map(Number)
  return [r, g, b, a]
}

/** A color's hue in degrees, or undefined when it is a neutral (or nearly transparent). */
function hue(color: Rgba): number | undefined {
  const [r, g, b, a] = color
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma * a < leastChroma) return undefined
  const h = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return (h * 60 + 360) % 360
}

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/** Each family's hue in this document, from its emphasis token. */
export function familyHues(): Map<AccentFamily, number> {
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.append(probe)
  const hues = new Map<AccentFamily, number>()
  for (const family of families) {
    const token = getComputedStyle(document.documentElement).getPropertyValue(`--projections-color-${family}`).trim()
    if (!token) continue
    probe.style.color = token
    const value = rgba(normalizeColors(getComputedStyle(probe).color))
    const at = value && hue(value)
    if (at !== undefined) hues.set(family, at)
  }
  probe.remove()
  return hues
}

function familyOf(color: string, hues: Map<AccentFamily, number>): AccentFamily | undefined {
  const value = rgba(normalizeColors(color))
  const at = value && hue(value)
  if (at === undefined) return undefined
  let best: AccentFamily | undefined
  let bestDistance = hueTolerance
  for (const [family, familyHue] of hues) {
    const distance = hueDistance(at, familyHue)
    if (distance <= bestDistance) [best, bestDistance] = [family, distance]
  }
  return best
}

/** The text an element shows itself, not through its children. */
function ownText(element: Element): string {
  let text = ''
  for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  return text.trim()
}

/** Each hued paint of an element: an HTML background, border, inset shadow edge and own text; an SVG fill and stroke. */
export function paintsOf(element: Element, style: CSSStyleDeclaration, hues: Map<AccentFamily, number>): Paint[] {
  const paints: Paint[] = []
  const add = (property: string, color: string) => {
    const family = familyOf(color, hues)
    if (family) paints.push({family, property})
  }
  if (element instanceof SVGElement) {
    const geometry = element instanceof SVGGeometryElement
    const text = element instanceof SVGTextContentElement && Boolean(ownText(element))
    if ((geometry && !(element instanceof SVGLineElement)) || text) add('fill', style.fill)
    if ((geometry || text) && style.stroke !== 'none' && px(style.strokeWidth) > 0) add('stroke', style.stroke)
    return paints
  }
  add('background-color', style.backgroundColor)
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (style.getPropertyValue(`border-${side}-style`) !== 'none' && px(style.getPropertyValue(`border-${side}-width`)) > 0) {
      add(`border-${side}-color`, style.getPropertyValue(`border-${side}-color`))
    }
  }
  // An inset shadow draws an edge inside the box, as `pk-region` does.
  for (const shadow of style.boxShadow === 'none' ? [] : style.boxShadow.split(/,(?![^(]*\))/u)) {
    if (/\binset\b/u.test(shadow)) add('inset box-shadow', /rgba?\([^)]*\)|#[0-9a-f]{6,8}\b/iu.exec(normalizeColors(shadow))?.[0] ?? '')
  }
  if (ownText(element)) add('color', style.color)
  return paints
}

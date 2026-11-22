// The colors an element paints, normalized, in the order the palette check reports them.
import {normalizeColors, px, colorAlpha} from '../paint.js'

/** Colors listed in a `box-shadow`, normalized. */
function shadowColors(value: string): string[] {
  if (value === 'none') return []
  return [...normalizeColors(value).matchAll(/rgba?\([^)]*\)|#[0-9a-f]{6,8}\b/giu)].map(match => match[0])
}

/** The fill and stroke an SVG element paints itself. */
function svgPaints(element: Element, style: CSSStyleDeclaration, text: string, colors: Record<string, string>): void {
  for (const property of ['fill', 'stroke'] as const) {
    const value = style.getPropertyValue(property)
    // Text and shapes paint their fill; containers (svg, g) only pass it on.
    const paints =
      property === 'stroke'
        ? px(style.strokeWidth) > 0
        : (element instanceof SVGGeometryElement && !(element instanceof SVGLineElement)) ||
          // Text paints its fill on its own characters; a <text> of <tspan>s passes it on.
          (element instanceof SVGTextContentElement && Boolean(text))
    if (paints && /^(?:rgb|color)/u.test(value)) colors[property] = normalizeColors(value)
  }
}

/**
 * What an element paints: its text color when it shows text of its own, its background, the colors of the borders it
 * draws (`borders`, by side), its outline, shadows and text decoration, and an SVG element's fill and stroke.
 */
export function paintedColors(
  element: Element,
  style: CSSStyleDeclaration,
  text: string,
  borders: Record<string, number>,
): Record<string, string> {
  const colors: Record<string, string> = {}
  const svg = element instanceof SVGElement
  if (text && !svg) colors.color = normalizeColors(style.color)
  const background = normalizeColors(style.backgroundColor)
  if (colorAlpha(background) > 0) colors['background-color'] = background
  for (const side of Object.keys(borders)) colors[`border-${side}-color`] = normalizeColors(style.getPropertyValue(`border-${side}-color`))
  if (style.outlineStyle !== 'none' && px(style.outlineWidth) > 0) colors['outline-color'] = normalizeColors(style.outlineColor)
  shadowColors(style.boxShadow).forEach((color, at) => {
    colors[`box-shadow ${at + 1}`] = color
  })
  if (style.textDecorationLine !== 'none' && text) colors['text-decoration-color'] = normalizeColors(style.textDecorationColor)
  if (svg) svgPaints(element, style, text, colors)
  return colors
}

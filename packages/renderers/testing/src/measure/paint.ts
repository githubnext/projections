// What an element paints, and whether it is visible.
import {pseudoPaints} from './pseudo.js'

// checks/comparison/support.ts names these, in this order, when a paint differs; keep the two lists together.
const paintProperties = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-style',
  'outline-color',
  'outline-width',
  'box-shadow',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'filter',
  'text-decoration',
  'font-weight',
]

let canvas: CanvasRenderingContext2D | null | undefined
/** A 2D canvas context for reading colors and text, made once. */
export function canvasContext(): CanvasRenderingContext2D | null {
  canvas ??= document.createElement('canvas').getContext('2d')
  return canvas
}

/** One spelling per color, so `color(srgb …)` from `color-mix()` and `rgb(…)` of the same color compare equal. */
export function normalizeColors(value: string): string {
  if (!value.includes('(')) return value
  const context = canvasContext()
  if (!context) return value
  return value.replaceAll(/\b(?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^()]*\)/gu, color => {
    // Canvas keeps `color(srgb …)` as written; spell it as rgba first.
    const srgb = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)$/u.exec(color)
    const input = srgb
      ? `rgba(${[srgb[1], srgb[2], srgb[3]].map(channel => Math.round(Number(channel) * 255)).join(', ')}, ${srgb[4] ?? 1})`
      : color
    context.fillStyle = '#000'
    context.fillStyle = input
    // Alpha to two decimals: 0.7 and 0.701961 (179/255) are one color.
    return context.fillStyle.replace(
      /rgba\(([^)]*), ([\d.]+)\)/u,
      (_, rgb: string, alpha: string) => `rgba(${rgb}, ${Number(alpha).toFixed(2)})`,
    )
  })
}

/** A text decoration as seen: none when its line is transparent. */
function decoration(style: CSSStyleDeclaration): string {
  const line = style.getPropertyValue('text-decoration-line')
  const color = normalizeColors(style.getPropertyValue('text-decoration-color'))
  return line === 'none' || /rgba\([^)]*, 0(?:\.00)?\)$/u.test(color) ? 'none' : `${line} ${color}`
}

/** Content only assistive technology perceives (`sr-only` and friends) is not painted. */
export function visuallyHidden(element: Element, style: CSSStyleDeclaration): boolean {
  const box = element.getBoundingClientRect()
  return (
    (box.width <= 1 && box.height <= 1 && style.overflow === 'hidden') ||
    style.clipPath.includes('inset(50%)') ||
    /rect\(0(?:px)?,? 0(?:px)?,? 0(?:px)?,? 0(?:px)?\)/u.test(style.getPropertyValue('clip'))
  )
}

export function effectiveOpacity(element: Element): number {
  let value = 1
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none') return 0
    value *= Number(style.opacity)
  }
  return value
}

export function visible(element: Element): boolean {
  const box = element.getBoundingClientRect()
  return (box.width > 0 || box.height > 0) && getComputedStyle(element).visibility !== 'hidden' && effectiveOpacity(element) > 0.01
}

export function describe(element: Element): string {
  const id = element.getAttribute('data-entity-id')
  const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/u).filter(Boolean).slice(0, 2)
  return `${element.tagName.toLowerCase()}${classes.map(name => `.${name}`).join('')}${id === null ? '' : `[data-entity-id="${id}"]`}`
}

/** A categorical part's colours, as `paintOf` records them: its background and fill. */
const categoricalColors = (style: CSSStyleDeclaration) =>
  ['background-color', 'fill'].map(name => normalizeColors(style.getPropertyValue(name))).join('|')

/**
 * Paint and visible text of an entity element and its parts, excluding nested entity elements; what each draws in its
 * `::before` and `::after` included. A part marked
 * `data-projections-category` paints a categorical colour: its fill and background, and its pseudo-elements', are
 * recorded by key instead (`key::before`, `key::after`). Generated text counts as text.
 */
export function paintOf(element: Element): {paint: string; text: string; categories: Record<string, string>} {
  const paint: string[] = []
  const text: string[] = []
  const categories: Record<string, string> = {}
  const visit = (node: Element, root: boolean) => {
    if (!root && node.hasAttribute('data-entity-id')) return
    // Tooltips, metadata and SVG definitions aren't painted themselves.
    if (
      [
        'title',
        'desc',
        'metadata',
        'script',
        'style',
        'template',
        'defs',
        'clipPath',
        'mask',
        'pattern',
        'linearGradient',
        'radialGradient',
        'symbol',
        'marker',
      ].includes(node.localName)
    ) {
      return
    }
    const opacity = effectiveOpacity(node)
    if (opacity <= 0.01) return
    const style = getComputedStyle(node)
    if (visuallyHidden(node, style)) return
    // A collapsed HTML part (a zero-height slot) paints nothing; SVG lines may be zero-height.
    const box = node.getBoundingClientRect()
    if (
      !root &&
      !(node instanceof SVGElement) &&
      (box.width === 0 || box.height === 0) &&
      (!node.children.length || style.overflow !== 'visible')
    ) {
      return
    }
    if (style.visibility !== 'hidden') {
      const category = node.getAttribute('data-projections-category')
      const categorical = (name: string) => category !== null && (name === 'background-color' || name === 'fill')
      if (category !== null) categories[category] = categoricalColors(style)
      const line = (name: string, painted: CSSStyleDeclaration, alpha: number) =>
        `${name}:${paintProperties
          .map(property =>
            categorical(property)
              ? `category(${category})`
              : property === 'text-decoration'
                ? decoration(painted)
                : normalizeColors(painted.getPropertyValue(property)),
          )
          .join('|')}|${alpha.toFixed(2)}`
      paint.push(line(node.tagName, style, opacity))
      // What it draws in its `::before` and `::after` (an overlaid edge, a stripe, a marker) is its paint too.
      if (!(node instanceof SVGElement)) {
        for (const {pseudo, painted, alpha, generated} of pseudoPaints(node, opacity)) {
          paint.push(line(`${node.tagName}-${pseudo}`, painted, alpha))
          if (category !== null) categories[`${category}::${pseudo}`] = categoricalColors(painted)
          if (generated) text.push(generated)
        }
      }
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) text.push(child.textContent.trim())
      }
    }
    for (const child of node.children) visit(child, false)
  }
  visit(element, true)
  return {paint: paint.join(';'), text: text.join(' '), categories}
}

export const px = (value: string) => Number.parseFloat(value) || 0
export function colorAlpha(color: string): number {
  if (!color || color === 'transparent' || color === 'none') return 0
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/u.exec(color)
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1])
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/u.exec(color)
  return rgba ? Number(rgba[1]) : 1
}

// The theme's tokens and the styles a renderer document uses.
import {themeTokenNames} from '@githubnext/projections-renderer-sdk/protocol'
import type {StyledElement, StyleMeasurement, StyleTokens} from '../types.js'
import {normalizeColors, visuallyHidden, visible, describe, px} from './paint.js'
import {borderWidths, radiiOf, spacingOf} from './styles/box.js'
import {paintedColors} from './styles/colors.js'

/** A token's value as this document resolves it: the custom property `applyEnvironment` sets on the root. */
function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--projections-${name}`).trim()
}

/** The theme tokens as resolved here: colors computed through a probe element, lengths in px. */
export function styleTokens(): StyleTokens {
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.append(probe)
  const resolveColor = (value: string) => {
    probe.style.color = ''
    probe.style.color = value
    return normalizeColors(getComputedStyle(probe).color)
  }
  const resolveFamily = (value: string) => {
    probe.style.fontFamily = value
    return getComputedStyle(probe).fontFamily
  }
  const lengths = (names: readonly string[]) => [...new Set(names.map(name => parseFloat(tokenValue(name))).filter(Number.isFinite))]
  const names = themeTokenNames as readonly string[]
  const colors: Record<string, string> = {}
  // Theme colors, and the categorical palette (`chart-*`).
  for (const name of names) if (/^(color|chart)-/.test(name) && tokenValue(name)) colors[name] = resolveColor(tokenValue(name))
  const tokens: StyleTokens = {
    colors,
    fontSizes: lengths(names.filter(name => name.startsWith('font-size') || name === 'label-font-size')),
    fontFamilies: ['font-family', 'font-family-mono'].filter(name => tokenValue(name)).map(name => resolveFamily(tokenValue(name))),
    fontWeights: lengths(names.filter(name => name.startsWith('font-weight') || name === 'label-font-weight')),
    // Labels and pills have their own horizontal padding token.
    spaces: lengths(names.filter(name => name.startsWith('space-') || name === 'label-padding-x')),
    radii: lengths(names.filter(name => name.startsWith('radius') || name === 'label-radius')),
    borderWidths: lengths(names.filter(name => name.startsWith('border-width'))),
  }
  probe.remove()
  return tokens
}

/** The text an element shows itself, not through its children. */
function ownText(element: Element): string {
  let text = ''
  for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Every visible element of the renderer document with what the styling checks compare against the theme: its painted
 * colors, its type if it shows text of its own, and its spacing, corner radii and border widths. Subtrees marked
 * `data-projections-off-system="<reason>"` are left out and listed; so is host chrome (`data-projections-host-overlay`).
 */
export function styleSystem(root: Element = document.body): StyleMeasurement {
  const elements: StyledElement[] = []
  const exemptions: string[] = []
  let index = 0
  const walk = (element: Element, category: boolean) => {
    if (
      element.hasAttribute('data-projections-host-overlay') ||
      ['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'DEFS', 'defs'].includes(element.tagName)
    ) {
      return
    }
    if (element.hasAttribute('data-projections-off-system')) {
      if (visible(element)) {
        exemptions.push(`${describe(element)}: ${element.getAttribute('data-projections-off-system') || '(no reason given)'}`)
      }
      return
    }
    const style = getComputedStyle(element)
    if (style.display === 'none') return
    const inCategory = category || element.hasAttribute('data-projections-category')
    if (visible(element) && !visuallyHidden(element, style)) {
      const box = element.getBoundingClientRect()
      const text = ownText(element)
      const svg = element instanceof SVGElement
      const borders = borderWidths(style)
      const colors = paintedColors(element, style, text, borders)
      const spacing = svg ? {} : spacingOf(element, style, box)
      const radii = svg ? {} : radiiOf(style, box)
      const font = text
        ? {size: px(style.fontSize), family: style.fontFamily, weight: Number(style.fontWeight) || 400, text: text.slice(0, 40)}
        : undefined
      elements.push({element: describe(element), index, colors, ...(font ? {font} : {}), spacing, radii, borders, category: inCategory})
    }
    index += 1
    for (const child of element.children) walk(child, inCategory)
  }
  for (const child of root.children) walk(child, false)
  return {tokens: styleTokens(), elements, exemptions}
}

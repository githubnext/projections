// How evenly the cards, panels and tables on a renderer's stage sit in its frame.
import type {StageInsetsMeasurement} from '../types.js'
import {colorAlpha, describe, normalizeColors, px, visible, visuallyHidden} from './paint.js'

/** A card's edge: a visible border on all four sides, or a filled surface that isn't the stage. */
function isCard(element: Element, style: CSSStyleDeclaration, stage: string): boolean {
  if (element instanceof SVGElement && !(element instanceof SVGSVGElement)) return false
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
  const bordered = sides.every(
    side =>
      px(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
      style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' &&
      colorAlpha(normalizeColors(style.getPropertyValue(`border-${side.toLowerCase()}-color`))) > 0.01,
  )
  if (bordered) return true
  const fill = normalizeColors(style.backgroundColor)
  return colorAlpha(fill) > 0.5 && fill !== stage
}

/**
 * The outermost cards, panels and tables the renderer stands on its stage, and the space between their union and the
 * frame's edges: its sides, the top of the document and the end of the renderer's content (the bottom of the body's
 * child that holds them, which a host that sizes its frame to the content ends the frame at), and the host's
 * `stage-inset-top` (`overlaid`), the part of the top it overlays, when it sends one. A zoomable canvas
 * (`data-zoom`) or a kit renderer that fills its frame (`data-fill`) centres a fitted drawing instead.
 */
export function stageInsets(): StageInsetsMeasurement {
  const fitted = document.querySelector('[data-zoom], .pk[data-fill]')
  if (fitted) return {cards: 0, fitted: describe(fitted)}
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.backgroundColor = 'var(--projections-color-surface-canvas)'
  document.body.append(probe)
  const stage = normalizeColors(getComputedStyle(probe).backgroundColor)
  probe.remove()
  const cards: Element[] = []
  for (const element of document.body.querySelectorAll('*')) {
    if (element.closest('[data-projections-host-overlay]') || cards.some(card => card.contains(element))) continue
    if (!visible(element)) continue
    const style = getComputedStyle(element)
    if (visuallyHidden(element, style) || style.display === 'inline') continue
    const box = element.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    if (isCard(element, style, stage)) cards.push(element)
  }
  if (!cards.length) return {cards: 0}
  const boxes = cards.map(card => card.getBoundingClientRect())
  const left = Math.min(...boxes.map(box => box.left)),
    top = Math.min(...boxes.map(box => box.top)),
    right = Math.max(...boxes.map(box => box.right)),
    bottom = Math.max(...boxes.map(box => box.bottom))
  const root = [...document.body.children].find(child => child.contains(cards[0]!)) ?? document.body
  const end = root.getBoundingClientRect().bottom
  const round = (value: number) => Math.round(value * 10) / 10
  const overlaid = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--projections-stage-inset-top'))
  return {
    cards: cards.length,
    first: describe(cards[0]!),
    ...(Number.isFinite(overlaid) && overlaid > 0 ? {overlaid} : {}),
    insets: {
      top: round(top + scrollY),
      right: round(document.documentElement.clientWidth - right),
      bottom: round(end - bottom),
      left: round(left),
    },
  }
}

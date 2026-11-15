// Keyboard focus on an entity: it shows, and stays inside its item.
import {settle} from './interaction.js'

/**
 * Keyboard focus on an entity (the entity element if it is focusable,
 * otherwise its first focusable descendant), measured inside the renderer
 * document. Focus must show (something the item paints, or the SDK's ring
 * over it, changes), an SVG element must never draw an outline (browsers ring
 * its bounding box, outside its shape), and an outline must stay inside the
 * item: the data-projections-unit element around it, or the outermost entity
 * element. Browsers that can't focus visibly from script skip the
 * measurement.
 */
export async function focusFailures(id: string): Promise<string[]> {
  const element = [...document.querySelectorAll('[data-entity-id]')].find(candidate => candidate.getAttribute('data-entity-id') === id)
  if (!element) return []
  const focusable = '[tabindex]:not([tabindex="-1"]), button:not([disabled]), a[href], input, select, textarea, summary'
  const target = (element.matches(focusable) ? element : element.querySelector(focusable)) as (HTMLElement | SVGElement) | null
  if (!target) return []
  let outermost: Element = element
  for (let cursor = element.parentElement?.closest('[data-entity-id]'); cursor; cursor = cursor.parentElement?.closest('[data-entity-id]'))
    outermost = cursor
  const unit = target.closest('[data-projections-unit][data-entity-id]') ?? outermost
  const properties = [
    'outline-style',
    'outline-width',
    'outline-color',
    'box-shadow',
    'background-color',
    'background-image',
    'stroke',
    'stroke-width',
    'fill',
    'opacity',
    'visibility',
  ]
  // What the unit paints, its SDK ring included, and the pieces drawn for it elsewhere.
  const pieces = [...document.querySelectorAll('[data-projections-ring-with]')].filter(
    piece => piece.getAttribute('data-projections-ring-with') === unit.getAttribute('data-entity-id'),
  )
  const signature = () =>
    [unit, ...unit.querySelectorAll('*'), ...pieces.flatMap(piece => [piece, ...piece.querySelectorAll('*')])]
      .flatMap(node => [getComputedStyle(node), getComputedStyle(node, '::after')])
      .map(style => properties.map(name => style.getPropertyValue(name)).join(';'))
      .join('|')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  await settle()
  const before = signature()
  target.focus({preventScroll: true, focusVisible: true} as FocusOptions)
  try {
    await settle()
    if (!target.matches(':focus-visible')) return []
    const failures: string[] = []
    const style = getComputedStyle(target)
    const outline = style.outlineStyle !== 'none' ? parseFloat(style.outlineWidth) || 0 : 0
    if (outline > 0 && target instanceof SVGElement)
      failures.push(
        `${id} draws an outline on an SVG element, around its bounding box; the SDK rings its marked edge (data-projections-edge) instead`,
      )
    if (outline > 0) {
      const grow = Math.max(0, outline + (parseFloat(style.outlineOffset) || 0))
      const box = target.getBoundingClientRect(),
        outer = unit.getBoundingClientRect()
      if (
        box.left - grow < outer.left - 0.5 ||
        box.top - grow < outer.top - 0.5 ||
        box.right + grow > outer.right + 0.5 ||
        box.bottom + grow > outer.bottom + 0.5
      )
        failures.push(
          `the focus ring of ${id} extends outside its item (the nearest data-projections-unit element around the focused element, or the outermost entity element); the SDK rings the item: draw no outline of your own`,
        )
    }
    if (signature() === before)
      failures.push(
        `focusing ${id} changes nothing painted: give its focusable element (<${target.tagName.toLowerCase()}>, the entity element or its first focusable descendant) a :focus-visible style`,
      )
    return failures
  } finally {
    target.blur()
  }
}

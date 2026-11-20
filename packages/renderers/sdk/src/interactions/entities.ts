// The renderer's entity elements: finding an item's, marking them hovered, filtered and annotated, and measuring
// where annotated items are visible.
import type {AnchorRect} from '../protocol.js'
import {annotatedAttribute, filteredAttribute, hoveredAttribute, toggle} from './attributes.js'
import {visibleRect} from './geometry.js'

/** The entity elements in `root`: those with `attribute`, the selection ID, apart from any `excluded` (badges). */
export interface Entities {
  root: HTMLElement
  attribute: string
  excluded(node: Node | null): boolean
}

/** The item an event target belongs to in the renderer, if any. */
export function entityOf({root, attribute}: Entities, target: EventTarget | null): string | null {
  const element = target instanceof Element ? target.closest(`[${attribute}]`) : null
  return element && root.contains(element) ? element.getAttribute(attribute) : null
}

/** An item's elements, in document order. */
export function elementsOf({root, attribute, excluded}: Entities, id: string): Element[] {
  return [...root.querySelectorAll<Element>(`[${attribute}="${CSS.escape(id)}"]`)].filter(element => !excluded(element))
}

/**
 * Marks the elements the filter excludes (`isVisible`) and those annotated (`isAnnotated`). An element holding one the
 * filter keeps isn't marked, as receding it would recede what it holds: only the parts it leaves out recede (a card
 * whose registration a summary figure names stays, and its other lines recede).
 */
export function markFiltered(entities: Entities, isVisible: (id: string) => boolean, isAnnotated: (id: string) => boolean) {
  const {root, attribute, excluded} = entities
  const elements = [...root.querySelectorAll(`[${attribute}]`)].filter(element => !excluded(element))
  const holding = new Set<Element>()
  for (const element of elements) {
    if (!isVisible(element.getAttribute(attribute) ?? '')) continue
    for (let parent = element.parentElement; parent && parent !== root && !holding.has(parent); parent = parent.parentElement)
      holding.add(parent)
  }
  for (const element of elements) {
    const id = element.getAttribute(attribute) ?? ''
    toggle(element, filteredAttribute, !isVisible(id) && !holding.has(element))
    toggle(element, annotatedAttribute, isAnnotated(id))
  }
}

/** Marks the hovered item's elements, and only those, hovered. */
export function markHovered(entities: Entities, hovered: string | null) {
  const {root, attribute} = entities
  for (const element of root.querySelectorAll(`[${hoveredAttribute}]`)) {
    if (!hovered || element.getAttribute(attribute) !== hovered) element.removeAttribute(hoveredAttribute)
  }
  if (!hovered) return
  for (const element of elementsOf(entities, hovered)) {
    if (!element.hasAttribute(hoveredAttribute)) element.setAttribute(hoveredAttribute, '')
  }
}

/** Where each visible annotated item is, from one pass over the entity elements in document order. */
export function annotatedRects(
  entities: Entities,
  view: Window,
  isAnnotated: (id: string) => boolean,
  isVisible: (id: string) => boolean,
  clips: Map<Element, boolean>,
): Map<string, AnchorRect> {
  const {root, attribute, excluded} = entities
  const annotated = new Map<string, AnchorRect>()
  for (const element of root.querySelectorAll(`[${attribute}]`)) {
    const id = element.getAttribute(attribute)
    if (id === null || !isAnnotated(id) || annotated.has(id) || excluded(element)) continue
    if (!isVisible(id)) continue
    const rect = visibleRect(view, element, clips)
    if (rect) annotated.set(id, rect)
  }
  return annotated
}

/** Where an item is visible: its first element that is, or `null`. */
export function itemRect(entities: Entities, view: Window, id: string, clips: Map<Element, boolean>): AnchorRect | null {
  return (
    elementsOf(entities, id)
      .map(element => visibleRect(view, element, clips))
      .find(value => value !== null) ?? null
  )
}

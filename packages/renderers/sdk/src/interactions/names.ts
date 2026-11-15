// Accessible names for annotation badges.
import type {AnnotationMark} from '../protocol.js'

/** Text inside an element, one space between separate text nodes, skipping hidden and non-content subtrees. */
function visibleText(element: Element): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (parts.length > 40) return
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) parts.push(node.textContent.trim())
      return
    }
    if (
      !(node instanceof Element) ||
      node.getAttribute('aria-hidden') === 'true' ||
      ['STYLE', 'SCRIPT', 'TEMPLATE', 'defs', 'title'].includes(node.tagName)
    )
      return
    for (const child of node.childNodes) walk(child)
  }
  walk(element)
  return parts.join(' ')
}

/** The accessible name of an item element, approximately: `aria-label`, `aria-labelledby`, `title` or text. */
export function itemName(element: Element): string {
  const document = element.ownerDocument
  const labelled = element.getAttribute('aria-labelledby')
  const text =
    element.getAttribute('aria-label') ??
    (labelled
      ? labelled
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent ?? '')
          .join(' ')
      : null) ??
    element.getAttribute('title') ??
    element.querySelector(':scope > title')?.textContent ??
    element.querySelector('[aria-label]')?.getAttribute('aria-label') ??
    visibleText(element)
  const name = text.replace(/\s+/g, ' ').trim()
  return name.length > 80 ? `${name.slice(0, 79)}…` : name
}

/**
 * The accessible name of an annotation badge: the mark's label, or its count,
 * on the item's accessible name (or its ID when it has none).
 */
export function annotationName(mark: AnnotationMark, item?: string): string {
  const what = mark.label?.trim() || (mark.count ? `${mark.count} ${mark.count === 1 ? 'annotation' : 'annotations'}` : 'Annotation')
  return `${what} on ${item?.trim() || mark.id}`
}

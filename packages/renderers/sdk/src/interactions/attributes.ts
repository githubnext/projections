// The attributes the interactions controller reads and sets on a renderer's elements.

/** Attribute the controller sets on every element of the entity the host says is hovered. */
export const hoveredAttribute = 'data-projections-hovered'
/**
 * Marks the entity element that is one visual unit (a card, a table) when
 * entity elements nest inside it. The SDK rings units (see `rings.ts`);
 * nested parts are tinted by the renderer, never ringed.
 */
export const unitAttribute = 'data-projections-unit'
/** Attribute the controller sets on every entity element the host's filter excludes. */
export const filteredAttribute = 'data-projections-filtered'
/**
 * Attribute a renderer may set on an item (or an ancestor) to choose the corner its annotation badge straddles:
 * `top-left` (default), `top-right`, `bottom-left` or `bottom-right`.
 */
export const annotationAnchorAttribute = 'data-projections-annotation-anchor'
/** The corners an annotation badge can straddle, the values of `annotationAnchorAttribute`. */
export const annotationAnchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
/** One of `annotationAnchors`. */
export type AnnotationAnchor = (typeof annotationAnchors)[number]
/** Attribute that names a scroll container for mirroring between panes. */
export const scrollAttribute = 'data-projections-scroll'
/** Attribute the controller sets on every entity element the host has annotated (`annotations`). */
export const annotatedAttribute = 'data-projections-annotated'
/** Attribute that carries the annotated item's selection ID on each annotation badge. */
export const annotationAttribute = 'data-projections-annotation'
/** Marks an item selected elsewhere while it pulses. */
export const pulseAttribute = 'data-projections-pulse'

/** Sets or removes a boolean attribute, touching the element only when it changes. */
export function toggle(element: Element, name: string, on: boolean) {
  if (on === element.hasAttribute(name)) return
  if (on) element.setAttribute(name, '')
  else element.removeAttribute(name)
}

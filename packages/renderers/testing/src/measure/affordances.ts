// The affordance policy for hovered and selected entities: rings inside their unit, parts only tinted.

/**
 * Checks the affordance policy for hovered and selected entities inside the
 * renderer document (pass it to `evaluate`; it must stay self-contained). A
 * unit is an entity element with `data-projections-unit`, or the outermost
 * entity element around a nested one. Units may be ringed, but only inside
 * their own box; nested entities (parts) may only be tinted: no outline, no
 * ring-shaped box shadow and no stroke on an SVG part.
 */
export function affordanceFailures(root: Element): string[] {
  const failures: string[] = []
  const unitOf = (element: Element): Element => {
    const declared = element.closest('[data-projections-unit][data-entity-id]')
    if (declared) return declared
    let unit = element
    for (
      let cursor = element.parentElement?.closest('[data-entity-id]');
      cursor;
      cursor = cursor.parentElement?.closest('[data-entity-id]')
    ) {
      unit = cursor
    }
    return unit
  }
  const marked = new Set(
    root.querySelectorAll(
      '[data-projections-hovered], [data-entity-id].selected, [data-entity-id][aria-pressed="true"], [data-entity-id][aria-current="true"]',
    ),
  )
  for (const element of marked) {
    const id = element.getAttribute('data-entity-id') ?? ''
    const style = getComputedStyle(element)
    const outline = style.outlineStyle !== 'none' ? Number.parseFloat(style.outlineWidth) || 0 : 0
    const unit = unitOf(element)
    const box = element.getBoundingClientRect(),
      outer = unit.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    if (unit !== element) {
      if (outline > 0 && !element.matches(':focus-visible')) {
        failures.push(`part ${id} draws an outline inside unit ${unit.getAttribute('data-entity-id')}`)
      }
      if (/(?:^|,\s*)(?:rgba?\([^)]*\)\s+)?0px 0px 0px [1-9]/u.test(style.boxShadow)) {
        failures.push(`part ${id} draws a ring-shaped box shadow`)
      }
      if (
        element instanceof SVGGeometryElement &&
        !element.matches(':focus-visible') &&
        style.stroke !== 'none' &&
        style.stroke !== 'transparent' &&
        style.stroke !== 'rgba(0, 0, 0, 0)' &&
        (Number.parseFloat(style.strokeWidth) || 0) > 0
      ) {
        failures.push(`SVG part ${id} is stroked inside unit ${unit.getAttribute('data-entity-id')}`)
      }
    }
    // The affordance's own extent: an outline extends by its width plus its offset (a negative offset draws inside).
    const grow = outline > 0 ? Math.max(0, outline + (Number.parseFloat(style.outlineOffset) || 0)) : 0
    const tolerance = 0.5
    if (
      box.left - grow < outer.left - tolerance ||
      box.top - grow < outer.top - tolerance ||
      box.right + grow > outer.right + tolerance ||
      box.bottom + grow > outer.bottom + tolerance
    ) {
      failures.push(
        `the outline of ${id} extends outside its unit ${unit.getAttribute('data-entity-id')} (the element with data-projections-unit or the outermost data-entity-id element); draw it inside with a negative outline-offset`,
      )
    }
  }
  return failures
}

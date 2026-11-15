/**
 * Item rings: hover, keyboard focus and selection drawn as styling on the
 * item's own element, so the ring is the item's edge and moves, scales and
 * clips with it on the same frame, through any transform, scroll or zoom.
 *
 * - **Unit.** An entity element (`data-entity-id`) that is not inside
 *   another one, or an entity element marked `data-projections-unit`. Nested entities are
 *   parts: they get no ring (renderers tint them); hovering, focusing or
 *   selecting a part rings its unit.
 * - **HTML units** take an `outline` at a negative `outline-offset` equal to
 *   its width: it follows the unit's `border-radius`, covers its border from
 *   the outer edge inwards and is never clipped by the unit's own `overflow`.
 *   While ringed the unit is its own stacking context (`isolation`), so the
 *   outline paints above all of its content, positioned descendants included. The unit must own its visible edge
 *   (its border, or nothing): the `rings` check fails, naming the element to
 *   mark, when the edge belongs to a wrapper's child or is drawn outside the
 *   box by a shadow.
 * - **SVG units** restyle the shape that draws their edge, marked
 *   `data-projections-edge` (a card's surface rect, a circle, a relationship's
 *   path): its stroke takes the ring's color and width, in screen pixels.
 *   `data-projections-edge="line"` marks a line (a relationship, an arrow, a
 *   connector): it is highlighted as itself, the accent and heavier, solid
 *   under focus, never outlined. `data-projections-edge="fill"` (an
 *   arrowhead, a marker's path) takes the color as its fill and stroke,
 *   keeping its own stroke width.
 *   There is no second shape. A piece of the entity drawn in another layer (an
 *   arrowhead over the cards) joins with `data-projections-ring-with="<id>"`.
 * - **States.** Hover (the pointer, or the host's mirrored hover), selection
 *   (heavier) and keyboard focus (in the focus color: a double outline on
 *   HTML, a dashed stroke on SVG, so it differs from selection). Focus wins
 *   over selection, which wins over hover. Forced colors use system colors.
 *
 * The SDK marks the host's hover and the selection on units
 * (`data-projections-ring-hover`, `data-projections-ring-selected`); the rest
 * is CSS. Renderers draw no ring, outline or selection border of their own.
 */

/** Set by the SDK on the units (and ring-with pieces) of the hovered entity. */
export const ringHoverAttribute = 'data-projections-ring-hover'
/** Set by the SDK on the units (and ring-with pieces) of the selected entity. */
export const ringSelectedAttribute = 'data-projections-ring-selected'
/** Set by the SDK on ring-with pieces of the unit that has keyboard focus. */
export const ringFocusAttribute = 'data-projections-ring-focus'
/** Marks the SVG shape that draws a unit's edge; its stroke shows the ring. */
export const ringEdgeAttribute = 'data-projections-edge'
/**
 * Marks a piece of an SVG entity drawn in another layer (a relationship's
 * arrowhead drawn over the cards), with the entity's ID: its marked edge
 * shapes ring with the entity.
 */
export const ringWithAttribute = 'data-projections-ring-with'
/**
 * Marks an interactive element that isn't an entity (a synthetic aggregate)
 * as a unit for hover and focus rings.
 */
export const ringItemAttribute = 'data-projections-ring-item'

const unitAttribute = 'data-projections-unit'

/** The entities to ring, by selection ID, as `RingController.set` takes them; `null` rings none. */
export interface RingTargets {
  /** The host's hovered entity (mirrored from any pane). */
  hovered?: string | null
  /** The selected entity. */
  selected?: string | null
}

/** Marks the hovered and selected entities' units for the ring stylesheet (`connectRings`). */
export interface RingController {
  /** Updates the hovered or selected entity; omitted fields keep their value. */
  set(targets: RingTargets): void
  /** Re-marks now. */
  refresh(): void
  /** The attribute that carries an element's selection ID. */
  attribute: string
  /** Stops observing the document, removes the ring stylesheet and every ring attribute the SDK set. */
  dispose(): void
}

/** How `connectRings` finds entities. */
export interface RingOptions {
  /** Attribute that carries an element's selection ID (default `data-entity-id`). */
  attribute?: string
}

/** The units' selector, for an entity attribute. */
export function unitSelector(attribute = 'data-entity-id'): string {
  const entity = `[${attribute}]`
  return `:is(${entity}:not(${entity} *), ${entity}[${unitAttribute}], [${ringItemAttribute}])`
}

/** The ring stylesheet for an entity attribute: every rule is styling on the unit or its marked edge. */
export function ringStylesheet(attribute = 'data-entity-id'): string {
  const unit = unitSelector(attribute)
  const nested = `:is([${attribute}][${unitAttribute}], [${ringItemAttribute}])`
  const hover = `:is(:hover:not(:has(${nested}:hover)), [${ringHoverAttribute}])`
  const selected = `[${ringSelectedAttribute}]`
  const focus = `:is(:focus-visible, :has(:focus-visible)):not(:has(${nested}:focus-visible, ${nested} :focus-visible))`
  const html = `${unit}:not(svg, svg *)`
  const svg = `${unit}:is(svg *)`
  const piece = `[${ringWithAttribute}]`
  const edge = `[${ringEdgeAttribute}]:not([${ringEdgeAttribute}='fill'])`
  /** An SVG unit's edge, or a ring-with piece's, in a state; the unit may be the edge itself. */
  const edges = (state: string, pieceState: string, shape = edge) =>
    [`${svg}${state} ${shape}`, `${shape}${svg}${state}`, `${piece}[${pieceState}] ${shape}`, `${shape}${piece}[${pieceState}]`].join(',\n')
  const filled = `[${ringEdgeAttribute}='fill']`
  // A stacking context of its own, so the outline paints above every descendant, positioned ones included.
  const outline = (width: string, style: string, color: string) =>
    `outline: ${width} ${style} ${color} !important; outline-offset: calc(-1 * ${width}) !important; isolation: isolate;`
  const stroke = (width: string, color: string, dash = 'none') =>
    `stroke: ${color} !important; stroke-width: ${width} !important; stroke-dasharray: ${dash} !important; vector-effect: non-scaling-stroke !important; stroke-opacity: 1 !important;`
  return `
:root {
  --pr-hover: var(--projections-color-accent, #0969da);
  --pr-selected: var(--projections-color-accent, #0969da);
  --pr-focus: var(--projections-color-focus, #0969da);
  --pr-hover-width: var(--projections-border-width-thick, 2px);
  --pr-selected-width: calc(var(--projections-border-width-thick, 2px) + var(--projections-border-width, 1px));
  --pr-focus-width: calc(3 * var(--projections-border-width-thick, 2px));
}
@media (forced-colors: active) {
  :root { --pr-hover: Highlight; --pr-selected: Highlight; --pr-focus: CanvasText; }
}
${html}${hover} { ${outline('var(--pr-hover-width)', 'solid', 'var(--pr-hover)')} }
${html}${selected} { ${outline('var(--pr-selected-width)', 'solid', 'var(--pr-selected)')} }
${html}${focus} { ${outline('var(--pr-focus-width)', 'double', 'var(--pr-focus)')} }
/* Focusables inside a unit hand their outline to the unit's ring. */
${unit} :focus-visible:not(${nested}, svg *) { outline: none !important; }
${unit}:is(svg *) :focus, ${unit}:is(svg *):focus { outline: none !important; }
${edges(hover, ringHoverAttribute)} { ${stroke('var(--pr-hover-width)', 'var(--pr-hover)')} }
${edges(selected, ringSelectedAttribute)} { ${stroke('var(--pr-selected-width)', 'var(--pr-selected)')} }
${edges(focus, ringFocusAttribute)} { ${stroke('var(--pr-selected-width)', 'var(--pr-focus)', 'calc(3 * var(--pr-selected-width)) var(--pr-selected-width)')} }
/* A line (a relationship, an arrow, a connector) is highlighted as itself, never outlined: the accent, heavier with
   each state, and solid under focus, its arrowhead in the same color. */
${edges(focus, ringFocusAttribute, `[${ringEdgeAttribute}='line']:not([${ringEdgeAttribute}='fill'])`)} { stroke-width: calc(2 * var(--projections-border-width-thick, 2px)) !important; stroke-dasharray: none !important; }
/* A filled edge shape (an arrowhead, a marker's head) takes the ring's color, keeping its shape. */
${edges(hover, ringHoverAttribute, filled)} { fill: var(--pr-hover) !important; stroke: var(--pr-hover) !important; }
${edges(selected, ringSelectedAttribute, filled)} { fill: var(--pr-selected) !important; stroke: var(--pr-selected) !important; }
${edges(focus, ringFocusAttribute, filled)} { fill: var(--pr-focus) !important; stroke: var(--pr-focus) !important; }
`
}

/**
 * Marks hover and selection for the entities in `view`'s document and adds
 * the ring stylesheet. Most renderers never call this: `connectRenderer`
 * starts it.
 */
export function connectRings(view: Window, options: RingOptions = {}): RingController {
  const document = view.document
  let attribute = options.attribute ?? 'data-entity-id'
  let hovered: string | null = null
  let selected: string | null = null
  let disposed = false
  let queued = false
  const stylesheet = document.createElement('style')
  stylesheet.setAttribute('data-projections-rings', '')
  const install = () => {
    stylesheet.textContent = ringStylesheet(attribute)
    if (!stylesheet.isConnected) (document.head ?? document.documentElement).append(stylesheet)
  }
  install()

  const entity = (element: Element | null) => element?.closest(`[${CSS.escape(attribute)}]`) ?? null
  /** The unit an entity element belongs to: the nearest marked unit around it, else the outermost entity element. */
  function unitOf(element: Element): Element {
    let unit = element
    for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement ? entity(cursor.parentElement) : null) {
      if (cursor.hasAttribute(unitAttribute)) return cursor
      unit = cursor
    }
    return unit
  }
  const elementsOf = (id: string) => [...document.querySelectorAll(`[${CSS.escape(attribute)}="${CSS.escape(id)}"]`)]
  const unitsOf = (id: string | null) => (id === null ? [] : [...new Set(elementsOf(id).map(unitOf))])
  const piecesOf = (units: Element[]) => {
    const ids = new Set(units.map(unit => unit.getAttribute(attribute)).filter((id): id is string => id !== null))
    return [...document.querySelectorAll(`[${ringWithAttribute}]`)].filter(piece => ids.has(piece.getAttribute(ringWithAttribute) ?? ''))
  }
  function focusedUnits(): Element[] {
    const active = document.activeElement
    if (!active || active === document.body) return []
    let visible: boolean
    try {
      visible = active.matches(':focus-visible')
    } catch {
      visible = false
    }
    const owner = entity(active)
    return visible && owner ? [unitOf(owner)] : []
  }
  function apply(name: string, elements: Element[]) {
    const wanted = new Set(elements)
    for (const element of document.querySelectorAll(`[${name}]`)) if (!wanted.has(element)) element.removeAttribute(name)
    for (const element of wanted) if (!element.hasAttribute(name)) element.setAttribute(name, '')
  }
  function mark() {
    queued = false
    if (disposed) return
    if (!stylesheet.isConnected) install()
    const hoverUnits = unitsOf(hovered)
    const selectedUnits = unitsOf(selected)
    apply(ringHoverAttribute, [...hoverUnits, ...piecesOf(hoverUnits)])
    apply(ringSelectedAttribute, [...selectedUnits, ...piecesOf(selectedUnits)])
    apply(ringFocusAttribute, piecesOf(focusedUnits()))
  }
  function schedule() {
    if (disposed || queued) return
    queued = true
    queueMicrotask(mark)
  }
  const own = new Set([ringHoverAttribute, ringSelectedAttribute, ringFocusAttribute])
  const mutations = new (view as Window & typeof globalThis).MutationObserver((records: MutationRecord[]) => {
    if (records.every(record => record.type === 'attributes' && own.has(record.attributeName ?? ''))) return
    if (records.every(record => record.target === stylesheet || stylesheet.contains(record.target))) return
    if (hovered !== null || selected !== null || document.querySelector(`[${ringWithAttribute}]`)) schedule()
  })
  mutations.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [attribute, unitAttribute, ringWithAttribute],
  })
  const onFocus = () => schedule()
  document.addEventListener('focusin', onFocus, true)
  document.addEventListener('focusout', onFocus, true)

  return {
    get attribute() {
      return attribute
    },
    set attribute(value: string) {
      if (value === attribute) return
      attribute = value
      install()
      schedule()
    },
    set(update) {
      if (update.hovered !== undefined) hovered = update.hovered
      if (update.selected !== undefined) selected = update.selected
      mark()
    },
    refresh: mark,
    dispose() {
      disposed = true
      mutations.disconnect()
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('focusout', onFocus, true)
      stylesheet.remove()
      for (const name of own) for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name)
    },
  }
}

const shared = new WeakMap<Window, {controller: RingController; users: number}>()

/**
 * The document's ring controller, shared by every SDK connection in a window
 * (`connectRenderer` and `connectInteractions` feed it). Returns `null` where
 * there is no DOM.
 */
export function documentRings(view: Window): {controller: RingController; release(): void} | null {
  if (!view.document?.documentElement || typeof (view as Window & typeof globalThis).MutationObserver !== 'function') return null
  let entry = shared.get(view)
  if (!entry) {
    entry = {controller: connectRings(view), users: 0}
    shared.set(view, entry)
  }
  entry.users++
  const current = entry
  let released = false
  return {
    controller: current.controller,
    release() {
      if (released) return
      released = true
      current.users--
      if (current.users <= 0) {
        current.controller.dispose()
        shared.delete(view)
      }
    },
  }
}

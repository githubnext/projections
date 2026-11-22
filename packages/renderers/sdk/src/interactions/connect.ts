// The interactions controller: wires a renderer's root to the host's hover, selection, filter, scroll and
// annotations, and reports what the person does there.
import type {RendererClient} from '../client.js'
import type {AnchorRect, AnnotationMark, HostMessage} from '../protocol.js'
import {documentRings, ringFocusAttribute, ringHoverAttribute, ringSelectedAttribute} from '../rings.js'
import {createAnchorReporter} from './anchors.js'
import {annotatedAttribute, filteredAttribute, hoveredAttribute} from './attributes.js'
import {createBadgeOverlay} from './badges.js'
import {
  annotatedRects,
  elementsOf as entityElements,
  entityOf as entityAt,
  itemRect,
  markFiltered,
  markHovered,
  type Entities,
} from './entities.js'
import {createPulse} from './pulse.js'
import {applyScroll, reveal, scrollKey, scrollTarget, type AppliedScrolls} from './scroll.js'

/** How `connectInteractions` finds entities and reports badge selections. */
export interface InteractionOptions {
  /** Attribute that carries an element's selection ID (default `data-entity-id`). */
  attribute?: string
  /** Defaults to the root's window. */
  window?: Window
  /**
   * Reports a selection when the person activates an annotation badge, in
   * place of `client.select`, so the renderer can update its own selection
   * too. It must still call `client.select(id)`.
   */
  select?: (id: string) => void
  /**
   * The item an element's ID presents a part of, when the host names that item instead (a split's or merge's further
   * parts, by their change): the filter keeps or recedes the part with it.
   */
  partOf?: (id: string) => string | undefined
}

/** The running interactions of one root (`connectInteractions`). */
export interface InteractionController {
  /** The renderer's current selection, whose position is reported as an anchor. */
  setSelected: (id: string | null) => void
  /** The latest selection, from `setSelected`, the host's `select` (with its property `path`) or an annotation badge. */
  readonly selection: {id: string | null; path?: string}
  /** Re-measures anchors and badges, for layout changes the controller can't observe. */
  refresh: () => void
  /** Stops listening and observing, removes badges and annotation marks, and releases the document's rings. */
  dispose: () => void
}

/** Capabilities a renderer using `connectInteractions` can declare. */
export const interactionCapabilities = {hover: true, anchors: true, scrollSync: true, filter: true, annotations: true} as const

/**
 * Implements hover, anchors, scroll mirroring, the host's filter and
 * annotation badges for any renderer whose entities carry their selection ID
 * in `data-entity-id` (or `attribute`):
 *
 * - Pointer and focus on an entity report `hover`; the host's `hover` marks
 *   every element of that entity with `data-projections-hovered`, which the
 *   renderer styles.
 * - The selected and hovered entities' visible rectangles are reported as
 *   `anchor` messages after every scroll, resize or DOM change.
 * - Scrolling a container reports `viewport`; the host's `scroll` scrolls the
 *   matching container without echoing it back.
 * - A selection that arrives from the host (chosen in another pane or view)
 *   scrolls the item into view if a scrolling container hides it, without
 *   mirroring that scroll to the other pane, and briefly pulses its elements
 *   (`data-projections-pulse`, never under reduced motion), so the counterpart
 *   of a selection is in view and easy to find.
 * - The host's `annotations` mark annotated entity elements with
 *   `data-projections-annotated` and draw a badge button on each visible one,
 *   in an overlay outside `root`. Activating a badge selects the item and
 *   reports `annotation`. Visible annotated items' anchors are reported too,
 *   at a bounded rate.
 */
export function connectInteractions(client: RendererClient, root: HTMLElement, options: InteractionOptions = {}): InteractionController {
  const view = options.window ?? root.ownerDocument.defaultView ?? window
  const document = root.ownerDocument
  const attribute = options.attribute ?? 'data-entity-id'
  let selected: string | null = null
  let selectedPath: string | undefined
  let hovered: string | null = null
  let reportedHover: string | null = null
  let visible: Set<string> | null = null
  const applied: AppliedScrolls = new Map()
  let frame = 0
  let timer = 0
  let disposed = false
  const marks = new Map<string, AnnotationMark>()

  // Excludes the badges once their overlay exists: it needs the entities' lookups first.
  const entities: Entities = {root, attribute, excluded: () => false}
  const entityOf = (target: EventTarget | null) => entityAt(entities, target)
  const elementsOf = (id: string) => entityElements(entities, id)
  const isVisible = (id: string) => visible === null || visible.has(id) || visible.has(options.partOf?.(id) ?? id)
  const isAnnotated = (id: string) => marks.has(id)

  function reportHover(id: string | null) {
    if (id === reportedHover) return
    reportedHover = id
    client.hover(id)
  }
  function select(id: string | null, path?: string) {
    selected = id
    selectedPath = path
    schedule()
  }
  const badges = createBadgeOverlay({
    view,
    document,
    marks,
    elementsOf,
    entityOf,
    hover: reportHover,
    activate(id) {
      if (options.select) options.select(id)
      else client.select(id)
      selected = id
      selectedPath = undefined
      client.annotation(id)
      schedule()
    },
  })
  entities.excluded = node => badges.contains(node)
  const pulse = createPulse(view, root, elementsOf)
  const anchors = createAnchorReporter(view, client, () => schedule())

  function measure() {
    frame = 0
    view.clearTimeout(timer)
    if (disposed) return
    markHovered(entities, hovered)
    markFiltered(entities, isVisible, isAnnotated)
    const clips = new Map<Element, boolean>()
    const annotated = marks.size ? annotatedRects(entities, view, isAnnotated, isVisible, clips) : new Map<string, AnchorRect>()
    badges.place(annotated)
    anchors.report({
      primary: new Set([selected, hovered].filter((id): id is string => id !== null)),
      rectOf: id => itemRect(entities, view, id, clips),
      annotated,
      isAnnotated,
    })
  }
  // Animation frames pause in hidden documents; a timer still measures there.
  function schedule() {
    if (disposed || frame) return
    frame = view.requestAnimationFrame(measure)
    timer = view.setTimeout(() => {
      view.cancelAnimationFrame(frame)
      measure()
    }, 150)
  }

  const onPointerOver = (event: PointerEvent) => reportHover(entityOf(event.target))
  const onPointerLeave = () => reportHover(null)
  const onFocusIn = (event: FocusEvent) => reportHover(entityOf(event.target))
  const onFocusOut = (event: FocusEvent) => {
    if (!entityOf(event.relatedTarget)) reportHover(null)
  }
  const onScroll = (event: Event) => {
    schedule()
    const target = event.target instanceof Document ? event.target.scrollingElement : event.target
    if (!(target instanceof Element)) return
    const key = scrollKey(target)
    const position = {x: target.scrollLeft, y: target.scrollTop}
    const expected = applied.get(key ?? '')
    applied.delete(key ?? '')
    if (expected && Math.abs(expected.x - position.x) < 1 && Math.abs(expected.y - position.y) < 1) return
    client.viewport({...position, ...(key === undefined ? {} : {key})})
  }
  /** A selection from the host: revealed and pulsed when it is new, after the renderer has drawn it. */
  function onSelect(id: string | null, path: string | undefined) {
    if (id !== null && id !== selected) {
      // After the renderer has drawn the selection, which can change the layout.
      view.requestAnimationFrame(() => {
        const element = !disposed && selected === id ? elementsOf(id)[0] : undefined
        if (element) reveal(view, element, applied)
      })
      pulse.pulse(id)
    }
    select(id, path)
  }
  const handlers: {[Type in HostMessage['type']]?: (message: Extract<HostMessage, {type: Type}>) => void} = {
    hover(message) {
      hovered = message.id
      markHovered(entities, hovered)
      schedule()
    },
    select: message => onSelect(message.id, message.path),
    annotations(message) {
      marks.clear()
      for (const mark of message.items) marks.set(mark.id, mark)
      badges.update()
      markFiltered(entities, isVisible, isAnnotated)
      schedule()
    },
    filter(message) {
      // A host before `scope` sent the Changes scope in `ids`: what is laid out, none of it receding.
      const legacy = message.scope === undefined && message.changesOnly
      visible = message.ids === null || legacy ? null : new Set(message.ids)
      markFiltered(entities, isVisible, isAnnotated)
      schedule()
    },
    scroll(message) {
      const target = scrollTarget(document, message.key)
      if (target) applyScroll(target, message.key, {x: message.x, y: message.y}, applied)
    },
  }
  const rings = documentRings(view)
  if (rings && options.attribute) rings.controller.attribute = options.attribute
  const unsubscribe = client.subscribe(message => (handlers[message.type] as ((message: HostMessage) => void) | undefined)?.(message))
  root.addEventListener('pointerover', onPointerOver)
  root.addEventListener('pointerleave', onPointerLeave)
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  document.addEventListener('scroll', onScroll, {capture: true, passive: true})
  view.addEventListener('resize', schedule)
  const resize = new ResizeObserver(schedule)
  resize.observe(root)
  // The attributes the controller sets itself, whose changes don't call for measuring again. Built here, not at
  // module scope: the package's bundle chunks can evaluate this module before the rings' attributes exist.
  const ownAttributes = new Set([
    hoveredAttribute,
    filteredAttribute,
    annotatedAttribute,
    ringFocusAttribute,
    ringHoverAttribute,
    ringSelectedAttribute,
  ])
  const mutations = new MutationObserver(records => {
    // Ignore the controller's own marks and badges.
    const own = (record: MutationRecord) =>
      badges.contains(record.target) || (record.type === 'attributes' && ownAttributes.has(record.attributeName ?? ''))
    if (!records.every(own)) schedule()
  })
  mutations.observe(root, {subtree: true, childList: true, attributes: true, characterData: true})

  return {
    setSelected(id) {
      rings?.controller.set({selected: id})
      if (id === selected) return
      select(id)
    },
    get selection() {
      return {id: selected, ...(selectedPath === undefined ? {} : {path: selectedPath})}
    },
    refresh: schedule,
    dispose() {
      disposed = true
      rings?.release()
      unsubscribe()
      view.cancelAnimationFrame(frame)
      view.clearTimeout(timer)
      anchors.dispose()
      badges.dispose()
      pulse.dispose()
      for (const element of root.querySelectorAll(`[${annotatedAttribute}]`)) element.removeAttribute(annotatedAttribute)
      root.removeEventListener('pointerover', onPointerOver)
      root.removeEventListener('pointerleave', onPointerLeave)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('scroll', onScroll, {capture: true})
      view.removeEventListener('resize', schedule)
      resize.disconnect()
      mutations.disconnect()
    },
  }
}

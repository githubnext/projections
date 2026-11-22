// The annotation badges: one button per annotated item, in an overlay outside the renderer's root, straddling a corner
// of the item where it is visible.
import type {AnchorRect, AnnotationMark} from '../protocol.js'
import {annotationAnchorAttribute, annotationAnchors, annotationAttribute, toggle} from './attributes.js'
import type {AnnotationAnchor} from './attributes.js'
import {badgeStyle} from './badge-style.js'
import {clipRect} from './geometry.js'
import {annotationName, itemName} from './names.js'

/** Badge counts above this show as `99+`; the accessible name keeps the exact count. */
const badgeCountLimit = 99

interface Badge {
  button: HTMLButtonElement
  mark: AnnotationMark
  /** The item element the accessible name was taken from. */
  named: Element | null
}

export interface BadgeOverlayOptions {
  view: Window
  document: Document
  /** The host's marks, by item; the badges follow them on `update`. */
  marks: ReadonlyMap<string, AnnotationMark>
  /** The renderer's elements for an item, in document order. */
  elementsOf(id: string): Element[]
  /** The item an event target belongs to in the renderer, if any. */
  entityOf(target: EventTarget | null): string | null
  /** The person activated the badge of an annotated item. */
  activate(id: string): void
  /** The person points at or focuses a badge (its item's ID), or leaves the badges and items (`null`). */
  hover(id: string | null): void
}

export interface BadgeOverlay {
  /** Whether a node is the overlay or inside it. */
  contains(node: Node | null): boolean
  /** Adds, updates and removes badges to match the marks. */
  update(): void
  /** Shows the badges of the items visible at `annotated`, positioned on them, and hides the rest. */
  place(annotated: Map<string, AnchorRect>): void
  /** Releases the overlay, its listeners' targets and its stylesheet. */
  dispose(): void
}

/** Where a badge goes: straddling `corner` of the item at `rect`, kept inside `bounds`. */
function badgePosition(rect: AnchorRect, size: {width: number; height: number}, corner: AnnotationAnchor, bounds: AnchorRect) {
  const {width, height} = size
  const wantX = corner.endsWith('left') ? rect.x - width * 0.3 : rect.x + rect.width - width * 0.7
  const wantY = corner.startsWith('top') ? rect.y - height * 0.3 : rect.y + rect.height - height * 0.7
  const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, wantX))
  const y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - height, wantY))
  return {left: `${Math.round(x)}px`, top: `${Math.round(y)}px`}
}

/** The corner an item's badge straddles (its renderer's `annotationAnchorAttribute`, else top left). */
function cornerOf(element: Element | undefined): AnnotationAnchor {
  const anchor = element?.closest(`[${annotationAnchorAttribute}]`)?.getAttribute(annotationAnchorAttribute)
  return annotationAnchors.includes(anchor as AnnotationAnchor) ? (anchor as AnnotationAnchor) : 'top-left'
}

/** The text a badge shows: its count, capped at `99+`, or nothing (a dot). */
const countText = (mark: AnnotationMark) => (mark.count ? (mark.count > badgeCountLimit ? `${badgeCountLimit}+` : String(mark.count)) : '')

/** Shows `badge` when its item is visible at a rectangle in `annotated`; returns that rectangle. */
function showBadge(badge: Badge, rect: AnchorRect | undefined): rect is AnchorRect {
  const hidden = !rect
  if (badge.button.hidden !== hidden) badge.button.hidden = hidden
  return !hidden
}

const badgeId = (target: EventTarget | null) =>
  target instanceof Element ? (target.closest(`[${annotationAttribute}]`)?.getAttribute(annotationAttribute) ?? null) : null

/** The annotation badges for one controller, in an overlay it creates on first use. */
export function createBadgeOverlay(options: BadgeOverlayOptions): BadgeOverlay {
  const {view, document, marks, elementsOf} = options
  const badges = new Map<string, Badge>()
  const scope = `projections-annotations-${Math.random().toString(36).slice(2, 10)}`
  let overlay: HTMLDivElement | null = null
  let stylesheet: HTMLStyleElement | null = null

  function onClick(event: MouseEvent) {
    const id = badgeId(event.target)
    if (!id || !marks.has(id)) return
    event.preventDefault()
    event.stopPropagation()
    options.activate(id)
  }
  function onOver(event: Event) {
    const id = badgeId(event.target)
    if (id) options.hover(id)
  }
  const onLeave = () => options.hover(null)
  function onOut(event: FocusEvent) {
    if (!badgeId(event.relatedTarget) && !options.entityOf(event.relatedTarget)) options.hover(null)
  }

  function ensureOverlay(): HTMLDivElement {
    if (overlay) return overlay
    stylesheet = document.createElement('style')
    stylesheet.textContent = badgeStyle(scope)
    document.head.append(stylesheet)
    overlay = document.createElement('div')
    overlay.className = scope
    // Host chrome drawn on the host's behalf; renderer checks don't hold it to the renderer's styling rules.
    overlay.setAttribute('data-projections-host-overlay', '')
    overlay.addEventListener('click', onClick)
    overlay.addEventListener('pointerover', onOver)
    overlay.addEventListener('pointerleave', onLeave)
    overlay.addEventListener('focusin', onOver)
    overlay.addEventListener('focusout', onOut)
    document.body.append(overlay)
    return overlay
  }

  function badgeFor(mark: AnnotationMark): Badge {
    const existing = badges.get(mark.id)
    if (existing) return existing
    const button = document.createElement('button')
    button.type = 'button'
    button.hidden = true
    button.setAttribute(annotationAttribute, mark.id)
    const badge = {button, mark, named: null}
    badges.set(mark.id, badge)
    return badge
  }

  /** Names each shown badge from its mark and its item's accessible name, when either changed. */
  function name(shown: [Badge, AnchorRect][]) {
    for (const [badge] of shown) {
      const element = elementsOf(badge.mark.id)[0] ?? null
      if (badge.named === element && badge.button.hasAttribute('aria-label')) continue
      badge.named = element
      const label = annotationName(badge.mark, element ? itemName(element) : undefined)
      badge.button.setAttribute('aria-label', label)
      badge.button.title = label
    }
  }

  return {
    contains: node => !!overlay && !!node && overlay.contains(node),
    update() {
      for (const [id, badge] of badges) {
        if (marks.has(id)) continue
        badge.button.remove()
        badges.delete(id)
      }
      if (!marks.size) return
      const container = ensureOverlay()
      for (const mark of marks.values()) {
        const badge = badgeFor(mark)
        const {button} = badge
        badge.mark = mark
        badge.named = null
        button.dataset.tone = mark.tone ?? 'neutral'
        const count = countText(mark)
        if (button.textContent !== count) button.textContent = count
        toggle(button, 'data-dot', !count)
        // Moving a badge would take focus from it, so only new ones are inserted.
        if (!button.isConnected) container.append(button)
      }
    },
    place(annotated) {
      const shown: [Badge, AnchorRect][] = []
      for (const [id, badge] of badges) {
        const rect = annotated.get(id)
        if (showBadge(badge, rect)) shown.push([badge, rect])
      }
      // Write names first and read sizes after, so layout is computed once.
      name(shown)
      const sizes = shown.map(([badge]) => ({width: badge.button.offsetWidth, height: badge.button.offsetHeight}))
      const corners = shown.map(([badge]) => {
        const element = elementsOf(badge.mark.id)[0]
        return {corner: cornerOf(element), clip: element ? clipRect(view, element) : null}
      })
      shown.forEach(([badge, rect], index) => {
        const {corner, clip} = corners[index]!
        // Straddle the item's corner (top-left unless the renderer names another, so it doesn't cover the kit's change
        // markers at the top right), and stay inside the item's clipping containers and the viewport.
        const bounds = clip ?? {x: 0, y: 0, width: view.innerWidth, height: view.innerHeight}
        const {left, top} = badgePosition(rect, sizes[index]!, corner, bounds)
        if (badge.button.style.left !== left) badge.button.style.left = left
        if (badge.button.style.top !== top) badge.button.style.top = top
      })
    },
    dispose() {
      overlay?.remove()
      stylesheet?.remove()
      badges.clear()
    },
  }
}

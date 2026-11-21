// Overlays VSCode Elements has no component for, styled with VS Code's own variables: an anchored widget (VS Code's
// hover and quick input widgets), its context menu with menu roles, and a quick pick. `vscode-context-menu` has no menu
// roles, item icons or checked items and keeps focus on its wrapper, so assistive technology can't follow it.

import {createContext, useContext, useLayoutEffect, useRef, useState} from 'react'
import type {CSSProperties, KeyboardEvent, ReactNode, RefObject} from 'react'
import {createPortal} from 'react-dom'
import {deepActiveElement, focusControl} from '../elements.js'
import {position} from './position.js'
import type {Placement} from './position.js'

const LayerContext = createContext<HTMLElement | null>(null)
/** Where overlays open: an element inside the view, so they stay visible when it is full screen. */
export const OverlayLayer = LayerContext.Provider

/** Whether the event happened inside one of `elements`, through shadow roots. */
const inside = (event: Event, elements: readonly (Element | null | undefined)[]) =>
  event.composedPath().some(node => elements.includes(node as Element))

/** A select or combobox whose own list is open takes Escape first. */
const ownsEscape = (event: KeyboardEvent<HTMLElement>) =>
  event.nativeEvent
    .composedPath()
    .some(
      node =>
        node instanceof HTMLElement && /^VSCODE-(SINGLE|MULTI)-SELECT$/.test(node.tagName) && (node as HTMLElement & {open?: boolean}).open,
    )

const focusable =
  '[data-autofocus], input, select, textarea, button, [tabindex], vscode-textfield, vscode-single-select, vscode-checkbox, vscode-button, vscode-toolbar-button'

/** Focuses `initialFocus`, else the overlay's first control, else the overlay itself. */
function focusInitial(overlay: HTMLElement, initialFocus: RefObject<Element | null> | undefined) {
  const target = initialFocus?.current ?? overlay.querySelector(focusable)
  if (!focusControl(target)) overlay.focus()
  // A VSCode Element opened with the overlay draws its control a microtask later: focus it once it has.
  const pending = (target as {updateComplete?: Promise<unknown>} | null)?.updateComplete
  if (pending) void pending.then(() => overlay.isConnected && overlay.contains(target) && focusControl(target))
}

function isInShadowOf(node: Node, host: Element): boolean {
  for (let current: Node | null = node; current; current = (current.getRootNode() as ShadowRoot).host ?? null) {
    if (host.contains(current)) return true
    if (!(current.getRootNode() instanceof ShadowRoot)) return false
  }
  return false
}

/** Whether focus is still the overlay's as it closes (not moved elsewhere by a press), so it goes back to the anchor. */
function focusLeftWithOverlay(document: Document, overlay: HTMLElement): boolean {
  const active = deepActiveElement(document)
  return !active || active === document.body || overlay.contains(active) || !active.isConnected || isInShadowOf(active, overlay)
}

/** The props of `Overlay`: whether it is open, what it opens from and returns focus to, and how it takes focus. */
export interface OverlayProps {
  open: boolean
  onClose: () => void
  /** The element the overlay opens from; focus returns there when it closes. */
  anchor: RefObject<Element | null>
  placement?: Placement
  /** The overlay element's role and name, for example `dialog` and "Settings". */
  role: 'dialog' | 'menu' | 'listbox' | 'none'
  label?: string
  className?: string
  /** Focused when it opens; else the first control. */
  initialFocus?: RefObject<Element | null> | undefined
  /** Keep focus where it is when it opens (a menu focuses its own item). */
  manualFocus?: boolean
  children: ReactNode
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /** Draw it where it is rendered, not in the overlay layer: a submenu inside its menu's overlay. */
  inline?: boolean
  /** Return focus to the anchor when it closes (default); a submenu returns it itself. */
  returnFocus?: boolean
  /** Called each time it is placed: whether a `beside` overlay covers the menu it opens from. */
  onPlaced?: (placed: {inPlace: boolean}) => void
}

/**
 * A widget anchored to a control, drawn like VS Code's editor widgets (`--vscode-editorWidget-*`): it opens in the
 * view's overlay layer, closes on Escape or a press outside it and its anchor, and returns focus to the anchor.
 */
export function Overlay({
  open,
  onClose,
  anchor,
  placement = 'below-end',
  role,
  label,
  className,
  initialFocus,
  manualFocus = false,
  children,
  onKeyDown,
  inline = false,
  returnFocus = true,
  onPlaced,
}: OverlayProps) {
  const layer = useContext(LayerContext)
  const element = useRef<HTMLDivElement>(null)
  // Placed after it renders, but focusable from the start (a hidden element can't take focus).
  const [style, setStyle] = useState<CSSProperties>({opacity: 0})
  const close = useRef(onClose)
  close.current = onClose
  const placed = useRef(onPlaced)
  placed.current = onPlaced

  useLayoutEffect(() => {
    if (!open) return undefined
    const overlay = element.current
    if (!overlay) return undefined
    const place = () => {
      const next = position(anchor.current, overlay, placement)
      setStyle({opacity: 1, ...next.style})
      placed.current?.({inPlace: next.inPlace})
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(overlay)
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    const press = (event: PointerEvent) => {
      if (!inside(event, [overlay, anchor.current])) close.current()
    }
    const document = overlay.ownerDocument
    document.addEventListener('pointerdown', press, true)
    if (!manualFocus) focusInitial(overlay, initialFocus)
    return () => {
      observer.disconnect()
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', press, true)
      // Focus inside the overlay goes back to its anchor; focus a press moved elsewhere stays there.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- focus returns to the anchor as it is when the overlay closes.
      if (returnFocus && focusLeftWithOverlay(document, overlay)) focusControl(anchor.current)
    }
  }, [open, anchor, placement, initialFocus, manualFocus, returnFocus])

  if (!open) return null
  const content = (
    <div
      ref={element}
      role={role === 'none' ? undefined : role}
      aria-label={label}
      tabIndex={-1}
      className={`phv-overlay ${className ?? ''}`}
      style={{position: 'fixed', ...style}}
      onKeyDown={event => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.key !== 'Escape' || ownsEscape(event)) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      {children}
    </div>
  )
  return layer && !inline ? createPortal(content, layer) : content
}

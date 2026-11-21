// The host's find and "changes only" settings, and the first focused item of a list scrolled into view.
import {useEffect, useMemo, useState} from 'react'
import type {RefObject} from 'react'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import {afterPaint} from '@githubnext/projections-renderer-sdk/client'
import {placedAttribute} from '../../focus.js'
import {layoutFilter} from '../../scope-filter.js'

/**
 * What the host's latest filter lays out (`layoutFilter`), or undefined before it sends any: the same object while a
 * summary figure or find changes only what recedes.
 */
export function useHostFilter(message: FilterPayload | undefined): FilterPayload | undefined {
  // The host's latest filter, as `useRenderer` kept it from the first message (a subscription made after the client
  // connects can miss the one sent with the documents).
  const [seen, setSeen] = useState(message)
  const [filter, setFilter] = useState(() => (message ? layoutFilter(undefined, message) : undefined))
  if (message !== seen) {
    setSeen(message)
    if (message) setFilter(layoutFilter(filter, message))
  }
  return filter
}

/**
 * Opens a list on what it was asked to focus: once a document (or a new focus request) is painted, the first focused
 * element in document order that is out of view is scrolled to, a fifth of the way down its scroll container, so the
 * rows before it give it context. Content in a container that places its own view (`placedAttribute`) is left alone.
 */
export function useOpeningReveal(root: RefObject<HTMLElement | null>, ids: ReadonlySet<string> | undefined, key: unknown): void {
  const wanted = useMemo(() => (ids ? [...ids].sort().join('\n') : ''), [ids])
  useEffect(() => {
    const element = root.current
    if (!element || !wanted) return
    const focused = new Set(wanted.split('\n'))
    return afterPaint(() => {
      const target = [...element.querySelectorAll('[data-entity-id]')].find(
        item => focused.has(item.getAttribute('data-entity-id') ?? '') && !item.closest(`[${placedAttribute}]`),
      )
      if (target) scrollOpen(target)
    })
  }, [root, wanted, key])
}

/** Scrolls each container that hides `target` so it sits a fifth of the way down (and in view across). */
function scrollOpen(target: Element): void {
  const document = target.ownerDocument
  const view = document.defaultView
  if (!view) return
  for (
    let scroller = scrollerOf(view, target);
    scroller;
    scroller = scroller === document.scrollingElement ? null : scrollerOf(view, scroller)
  ) {
    const rect = target.getBoundingClientRect()
    const port =
      scroller === document.scrollingElement
        ? {top: 0, left: 0, width: view.innerWidth, height: view.innerHeight}
        : (() => {
            const box = scroller.getBoundingClientRect()
            return {
              top: box.top + scroller.clientTop,
              left: box.left + scroller.clientLeft,
              width: scroller.clientWidth,
              height: scroller.clientHeight,
            }
          })()
    if (rect.top < port.top || rect.bottom > port.top + port.height) scroller.scrollTop += rect.top - port.top - port.height / 5
    if (rect.left < port.left || rect.right > port.left + port.width) scroller.scrollLeft += rect.left - port.left - port.width / 5
  }
}

/** The nearest ancestor that scrolls, up to the document's scrolling element. */
function scrollerOf(view: Window, element: Element): Element | null {
  const document = element.ownerDocument
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent)
    const scrolls = (value: string) => value === 'auto' || value === 'scroll'
    if (
      (scrolls(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) ||
      (scrolls(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1)
    )
      return parent
  }
  return document.scrollingElement
}

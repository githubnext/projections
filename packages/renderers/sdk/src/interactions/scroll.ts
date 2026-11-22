// Scroll containers: naming them for mirroring between panes, finding them again, and revealing an item in them.
import type {ScrollPosition} from '../protocol.js'
import {scrollAttribute} from './attributes.js'

/** Positions the controller set itself, by scroll key (`''` for the document), so it doesn't report them back. */
export type AppliedScrolls = Map<string, {x: number; y: number}>

/** The key that names a scroll container in both panes: its `data-projections-scroll`, or its structural path. */
export function scrollKey(target: Element): string | undefined {
  const document = target.ownerDocument
  if (target === document.scrollingElement || target === document.documentElement || target === document.body) return undefined
  const named = target.closest(`[${scrollAttribute}]`)
  if (named === target) return named.getAttribute(scrollAttribute) ?? undefined
  const path: string[] = []
  for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
    const parent: Element | null = element.parentElement
    path.unshift(`${element.tagName.toLowerCase()}:${parent ? [...parent.children].indexOf(element) : 0}`)
  }
  return path.join('>').slice(0, 256)
}

/** The scroll container a key names, or `null` when this document has none. */
export function scrollTarget(document: Document, key: string | undefined): Element | null {
  if (key === undefined) return document.scrollingElement
  const named = document.querySelector(`[${scrollAttribute}="${CSS.escape(key)}"]`)
  if (named) return named
  let element: Element | null = document.body
  for (const step of key.split('>')) {
    const [tag, index] = step.split(':')
    const child: Element | undefined = element?.children[Number(index)]
    if (!child || child.tagName.toLowerCase() !== tag) return null
    element = child
  }
  return element
}

/** Scrolls `target` to `position`, recorded as applied, unless it is already there. */
export function applyScroll(target: Element, key: string | undefined, position: ScrollPosition, applied: AppliedScrolls) {
  if (Math.abs(target.scrollLeft - position.x) < 1 && Math.abs(target.scrollTop - position.y) < 1) return
  applied.set(key ?? '', position)
  target.scrollLeft = position.x
  target.scrollTop = position.y
}

/** The nearest ancestor that scrolls (has overflow to scroll), up to the document. */
function scrollerOf(view: Window, element: Element): Element | null {
  const document = element.ownerDocument
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent)
    const scrolls = (value: string) => value === 'auto' || value === 'scroll'
    if (
      (scrolls(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) ||
      (scrolls(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1)
    ) {
      return parent
    }
  }
  return element === document.scrollingElement ? null : document.scrollingElement
}

/** The box a scroller shows its content in, in the viewport. */
function scrollport(view: Window, scroller: Element, isDocument: boolean) {
  if (isDocument) return {left: 0, top: 0, width: view.innerWidth, height: view.innerHeight}
  const box = scroller.getBoundingClientRect()
  const {clientLeft, clientTop, clientWidth: width, clientHeight: height} = scroller
  return {left: box.left + clientLeft, top: box.top + clientTop, width, height}
}

/**
 * Along one axis: whether `from`–`to` (`length` long) is outside the scrollport (`start`, `size`), and the scroll
 * position that centres it, within the scroll range, if it is (else the current `scroll`).
 */
function centre(scroll: number, scrollSize: number, start: number, size: number, from: number, length: number, to: number) {
  const hidden = from < start || to > start + size
  const value = hidden ? scroll + from + length / 2 - (start + size / 2) : scroll
  return {hidden, value: Math.max(0, Math.min(scrollSize - size, value))}
}

/**
 * Scrolls an item selected elsewhere into view, centred in each scrolling container that hides it, so the
 * counterpart of an item selected in the other pane is in view (and side by side's connector can join them). The
 * scroll is recorded as applied, so scroll sync doesn't mirror it back to the pane the person selected in.
 */
export function reveal(view: Window, element: Element, applied: AppliedScrolls) {
  let rect = element.getBoundingClientRect()
  if (!rect.width && !rect.height) return
  for (let scroller = scrollerOf(view, element); scroller; scroller = scrollerOf(view, scroller)) {
    const isDocument = scroller === element.ownerDocument.scrollingElement
    const {left, top, width, height} = scrollport(view, scroller, isDocument)
    const x = centre(scroller.scrollLeft, scroller.scrollWidth, left, width, rect.left, rect.width, rect.right)
    const y = centre(scroller.scrollTop, scroller.scrollHeight, top, height, rect.top, rect.height, rect.bottom)
    if (x.hidden || y.hidden) {
      const position = {x: x.value, y: y.value}
      if (Math.abs(position.x - scroller.scrollLeft) >= 1 || Math.abs(position.y - scroller.scrollTop) >= 1) {
        applied.set(scrollKey(scroller) ?? '', position)
        scroller.scrollLeft = position.x
        scroller.scrollTop = position.y
        rect = element.getBoundingClientRect()
      }
    }
    if (isDocument) break
  }
}

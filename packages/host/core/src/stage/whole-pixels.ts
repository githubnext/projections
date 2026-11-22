import {useLayoutEffect, type RefObject} from 'react'

/**
 * Keeps an element the stage floats over its frames (the utility bar, a pane chip) on whole pixels: a stage that rests
 * at a fractional offset in its page (under a host's header), a centred bar, or a sticky one the page scrolls under,
 * would otherwise draw its edges between pixels. It nudges the element by the fraction (`translate`), measured again as
 * it, its parent or the page resizes, and as the page scrolls.
 */
export function useWholePixels(ref: RefObject<HTMLElement | null>, {width: round = false}: {width?: boolean} = {}): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const align = () => {
      element.style.translate = ''
      // A width its text decides can be fractional, which leaves one edge between pixels however it's nudged: `width`
      // takes the next whole pixel, for an element whose size only its text changes (a chip), measured again when it does.
      if (round) {
        element.style.width = ''
        const width = element.getBoundingClientRect().width
        if (Math.abs(Math.ceil(width) - width) > 0.01) element.style.width = `${Math.ceil(width)}px`
      }
      const {left, top} = element.getBoundingClientRect()
      const x = Math.round(left) - left,
        y = Math.round(top) - top
      if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) element.style.translate = `${x}px ${y}px`
    }
    align()
    // Observers report after layout and before paint, and the page's scroll once a frame, so aligning straight away
    // lands in the same frame; the nudge changes no size, so it doesn't report again.
    const observer = new ResizeObserver(align)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    observer.observe(element.ownerDocument.documentElement)
    const text = new MutationObserver(align)
    if (round) text.observe(element, {subtree: true, childList: true, characterData: true})
    const view = element.ownerDocument.defaultView
    view?.addEventListener('scroll', align, {capture: true, passive: true})
    return () => {
      observer.disconnect()
      text.disconnect()
      view?.removeEventListener('scroll', align, {capture: true})
    }
  }, [ref, round])
}

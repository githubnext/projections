import {useLayoutEffect} from 'react'
import type {RefObject} from 'react'

/**
 * Keeps an element the stage floats over its frames (the utility bar, a pane chip) on whole pixels: a stage that rests
 * at a fractional offset in its page (under a host's header), a centred bar, or a sticky one the page scrolls under,
 * would otherwise draw its edges between pixels. It nudges the element by the fraction (`translate`), measured again as
 * it, its parent or the page resizes, and as the page scrolls.
 */
export function useWholePixels(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const align = () => {
      element.style.translate = ''
      const {left, top} = element.getBoundingClientRect()
      const x = Math.round(left) - left,
        y = Math.round(top) - top
      if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) element.style.translate = `${x}px ${y}px`
    }
    let frame = 0
    const later = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0
        align()
      })
    }
    align()
    const observer = new ResizeObserver(later)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    observer.observe(element.ownerDocument.documentElement)
    const view = element.ownerDocument.defaultView
    view?.addEventListener('scroll', later, {capture: true, passive: true})
    return () => {
      observer.disconnect()
      view?.removeEventListener('scroll', later, {capture: true})
      cancelAnimationFrame(frame)
    }
  }, [ref])
}

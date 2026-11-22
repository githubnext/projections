// Panning a content-sized stage by dragging, so the host page keeps the wheel and touch scrolling.
import {useEffect} from 'react'
import type {RefObject} from 'react'
import {useFrameSizing, useStageHeightCap} from './shell/frame.js'

/** How far, CSS px, a pointer moves before a press on the stage becomes a drag that pans it rather than a click. */
const dragPanThreshold = 4
/** How far, CSS px, an arrow key pans a stage that pans by dragging. */
const keyPanStep = 40

/**
 * In a content-sized frame laid in its host's scrolling page (`active`: the host sends `stage-max-height`, see
 * `useStageHeightCap`), the stage never takes the page's
 * wheel or touch scrolling: it isn't scrollable by the person (`data-pan="drag"` hides its overflow), so the wheel and
 * an upward or downward swipe scroll the page, while Ctrl/⌘-wheel and pinch still zoom it. Content larger than the
 * stage (zoomed in, or opened at the text floor) pans by dragging it with a mouse or pen, or with a sideways touch
 * drag, and with the arrow keys while the stage itself has focus; `data-pannable` marks it then. A press that moves
 * less than `dragPanThreshold` stays a click, and a focused item still scrolls into view.
 */
export function useDragPan(scrollerRef: RefObject<HTMLElement | null>): void {
  const sizing = useFrameSizing()
  const cap = useStageHeightCap()
  const active = sizing === 'content' && cap !== undefined
  useEffect(() => {
    const element = scrollerRef.current
    if (!element || !active) return
    element.dataset.pan = 'drag'
    const pannable = () => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
    const mark = () => element.toggleAttribute('data-pannable', pannable())
    mark()
    const observer = new ResizeObserver(mark)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    let drag: {id: number; x: number; y: number; left: number; top: number; moved: boolean} | undefined
    let swallow: (() => void) | undefined
    const down = (event: PointerEvent) => {
      swallow?.()
      if (!event.isPrimary || event.button !== 0 || !pannable()) return
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false}
    }
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < dragPanThreshold) return
        drag.moved = true
        element.setPointerCapture?.(event.pointerId)
        element.dataset.panning = ''
      }
      element.scrollLeft = drag.left - dx
      element.scrollTop = drag.top - dy
    }
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const moved = drag.moved
      drag = undefined
      delete element.dataset.panning
      if (!moved) return
      // The click that ends a drag selects nothing.
      const stop = (click: MouseEvent) => {
        click.preventDefault()
        click.stopPropagation()
      }
      element.addEventListener('click', stop, {capture: true})
      const timer = setTimeout(() => swallow?.(), 300)
      swallow = () => {
        element.removeEventListener('click', stop, {capture: true})
        clearTimeout(timer)
        swallow = undefined
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.target !== element || event.altKey || event.ctrlKey || event.metaKey) return
      const step = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key]
      if (!step || !pannable()) return
      event.preventDefault()
      element.scrollBy({left: step[0]! * keyPanStep, top: step[1]! * keyPanStep})
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('keydown', key)
    return () => {
      observer.disconnect()
      swallow?.()
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('keydown', key)
      delete element.dataset.pan
      delete element.dataset.panning
      element.removeAttribute('data-pannable')
    }
  }, [scrollerRef, active])
}

/** A wheel over a stage that pans by dragging, which scrolls the host's page rather than the stage (not a zoom). */
export function pageWheel(event: Event, element: HTMLElement): boolean {
  return event instanceof WheelEvent && element.dataset.pan === 'drag' && !event.ctrlKey && !event.metaKey
}

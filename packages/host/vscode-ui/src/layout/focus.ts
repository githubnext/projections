import {useLayoutEffect, useRef} from 'react'
import type {RefObject} from 'react'
import {focusControl} from '../elements.js'

/** Where focus goes when its control changes form or moves into an overflow. */
const focusFallbacks: Record<string, readonly string[]> = {
  'compare-from': ['revisions'],
  to: ['revisions'],
  swap: ['revisions'],
  revisions: ['compare-from'],
  'previous-step': ['playback-options'],
  'next-step': ['playback-options'],
  'playback-options': ['previous-step'],
  varied: ['more'],
  zoom: ['more'],
  filter: ['more'],
  info: ['more'],
  fullscreen: ['more'],
  more: ['filter'],
}

/**
 * Keeps focus on a toolbar control that changes form: it tracks the focused control's `data-focus-id`, and when that
 * control leaves the document, focuses the control with the same ID in its new form, or the overflow that now holds it.
 */
export function useFocusFollow(toolbar: RefObject<HTMLElement | null>) {
  const focus = useRef<{element: Element; id: string} | null>(null)

  useLayoutEffect(() => {
    const element = toolbar.current
    if (!element) return
    const track = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-focus-id]') : null
      focus.current = target ? {element: target, id: target.getAttribute('data-focus-id')!} : null
    }
    element.addEventListener('focusin', track)
    return () => element.removeEventListener('focusin', track)
  }, [toolbar])

  // A control that changed form keeps focus: the same control in its new form, or the overflow that now holds it.
  // After every render: any render can remount the focused control.
  useLayoutEffect(() => {
    const element = toolbar.current
    const last = focus.current
    if (!element || !last || last.element.isConnected) return
    const active = document.activeElement
    if (active && active !== document.body && element.ownerDocument.contains(active)) return
    for (const id of [last.id, ...(focusFallbacks[last.id] ?? [])]) {
      // A VSCode Element draws its control in its shadow root: focus that control.
      if (focusControl(element.querySelector(`[data-focus-id="${id}"]`))) return
    }
  })
}

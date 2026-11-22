import {useLayoutEffect, useRef} from 'react'
import type {RefObject} from 'react'

/**
 * Whether focus left `control` on purpose, so it's no longer the bar's to restore: it stays mounted, focus is outside
 * the bar, and the control has no popup open. A menu or dialog the control opens may render outside the bar (a portal),
 * and focus in it is still the control's: choosing an item can remount the control in a new form.
 */
export function leftOnPurpose(control: Element, bar: Element): boolean {
  return control.isConnected && !bar.contains(bar.ownerDocument.activeElement) && control.getAttribute('aria-expanded') !== 'true'
}

/**
 * Keeps focus on a bar's control that changes form: it tracks the focused control's `data-focus-id`, and when that
 * control leaves the document with nothing else focused, focuses the control with the same ID in its new form, else the
 * first of its `fallbacks` the bar holds (for example the overflow that now holds it), with `focusControl`.
 */
export function useFocusRetention(
  bar: RefObject<HTMLElement | null>,
  fallbacks: Readonly<Record<string, readonly string[]>> = {},
  focusControl: (control: HTMLElement) => void = control => control.focus(),
) {
  const focus = useRef<{element: Element; id: string} | null>(null)
  const latest = useRef({fallbacks, focusControl})
  latest.current = {fallbacks, focusControl}

  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const track = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-focus-id]') : null
      focus.current = target && element.contains(target) ? {element: target, id: target.getAttribute('data-focus-id')!} : null
    }
    // Focus that leaves while its control stays mounted, with no popup of its own open, was moved on purpose: forget the
    // control. A remount's loss is told apart once the render that removed the control (and restored focus) is done.
    const leave = () => {
      const left = focus.current
      queueMicrotask(() => {
        if (focus.current === left && left && leftOnPurpose(left.element, element)) {
          focus.current = null
        }
      })
    }
    element.addEventListener('focusin', track)
    element.addEventListener('focusout', leave)
    return () => {
      element.removeEventListener('focusin', track)
      element.removeEventListener('focusout', leave)
    }
  }, [bar])

  // After every render: any render can remount the focused control.
  useLayoutEffect(() => {
    const element = bar.current
    const last = focus.current
    if (!element || !last || last.element.isConnected) return
    const document = element.ownerDocument
    const active = document.activeElement
    if (active && active !== document.body && document.contains(active)) return
    const current = latest.current
    for (const id of [last.id, ...(current.fallbacks[last.id] ?? [])]) {
      const target = element.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`)
      if (target) {
        current.focusControl(target)
        return
      }
    }
  })
}

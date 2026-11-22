import {useCallback, useEffect, useState, type RefObject} from 'react'

const noop = () => undefined

/** What `useFullscreen` returns: whether the target is full screen and how, and `toggle` to enter or leave it. */
export interface FullscreenState {
  /** Whether the target is full screen, natively or through the fallback. */
  active: boolean
  /** `native` (the Fullscreen API) or `fallback` (a fixed overlay, where the API is unavailable, as on iPhone). */
  kind: 'native' | 'fallback' | undefined
  toggle: () => void
}

/**
 * Full screen for a view: the Fullscreen API where it works, else a fixed
 * overlay (`fallbackClass` on the target, `data-fullscreen="fallback"`) that
 * Escape closes. Taking the target out of the page shortens it, so the
 * fallback records the page's scroll position on entering and restores it on
 * leaving, and returns focus without scrolling.
 */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>, {fallbackClass}: {fallbackClass: string}): FullscreenState {
  const [fallback, setFallback] = useState(false)
  const [native, setNative] = useState(false)
  useEffect(() => {
    const update = () => setNative(Boolean(targetRef.current) && document.fullscreenElement === targetRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [targetRef])
  useEffect(() => {
    const element = targetRef.current
    if (!fallback || !element) return undefined
    const view = element.ownerDocument.defaultView ?? globalThis.window
    const scroll = {x: view.scrollX, y: view.scrollY}
    element.classList.add(fallbackClass)
    element.setAttribute('data-fullscreen', 'fallback')
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setFallback(false)
    }
    document.addEventListener('keydown', escape)
    return () => {
      const focused = element.ownerDocument.activeElement
      element.classList.remove(fallbackClass)
      element.removeAttribute('data-fullscreen')
      document.removeEventListener('keydown', escape)
      // The page has its height back now; return to where it was, and again after layout settles.
      view.scrollTo(scroll.x, scroll.y)
      if (focused instanceof HTMLElement && element.contains(focused)) focused.focus({preventScroll: true})
      view.requestAnimationFrame(() => {
        if (view.scrollX !== scroll.x || view.scrollY !== scroll.y) view.scrollTo(scroll.x, scroll.y)
      })
    }
  }, [fallback, targetRef, fallbackClass])
  const toggle = useCallback(() => {
    const element = targetRef.current
    if (!element) return
    if (fallback) {
      setFallback(false)
      return
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(noop)
      return
    }
    if (document.fullscreenEnabled && typeof element.requestFullscreen === 'function') {
      element.requestFullscreen().catch(() => setFallback(true))
    } else setFallback(true)
  }, [fallback, targetRef])
  return {active: native || fallback, kind: native ? 'native' : fallback ? 'fallback' : undefined, toggle}
}

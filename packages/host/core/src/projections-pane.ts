import {useCallback, useEffect, useState} from 'react'
import type {RefObject} from 'react'

/** The narrowest a page offers the projections pane at, CSS px: narrower, a pinned pane would crush the stage. */
export const paneMinWidth = 900
/** How much wider than `paneMinWidth` the page must grow before a pane it dropped comes back, CSS px: the toolbar's. */
const paneHysteresis = 32

/**
 * Whether a surface's projections pane is pinned, kept in `localStorage` under `key` (one per surface, say
 * `projections:pane-pinned:viewer`) so it survives reloads. Storage that throws (a sandboxed frame) keeps it in memory.
 */
export function usePinnedPane(key: string): [boolean, (pinned: boolean) => void] {
  const [pinned, setPinned] = useState(() => {
    try {
      const storage = globalThis.localStorage as Storage | undefined
      return storage?.getItem(key) === 'true'
    } catch {
      return false
    }
  })
  const set = useCallback(
    (value: boolean) => {
      setPinned(value)
      try {
        const storage = globalThis.localStorage as Storage | undefined
        if (value) storage?.setItem(key, 'true')
        else storage?.removeItem(key)
      } catch {
        // Kept for this page only.
      }
    },
    [key],
  )
  return [pinned, set]
}

const widthOf = (element: RefObject<HTMLElement | null> | undefined) =>
  element?.current?.getBoundingClientRect().width ?? (typeof innerWidth === 'number' ? innerWidth : paneMinWidth)

/**
 * Whether there is room for the projections pane (`paneMinWidth`): in `element`, when given (a tab that is narrower
 * than the page), else in the page, with hysteresis so a width at the boundary doesn't flicker between the pane and
 * the dropdown.
 */
export function usePaneRoom(element?: RefObject<HTMLElement | null>): boolean {
  const [room, setRoom] = useState(() => widthOf(element) >= paneMinWidth)
  useEffect(() => {
    const resize = () => setRoom(previous => widthOf(element) >= paneMinWidth + (previous ? 0 : paneHysteresis))
    resize()
    const target = element?.current
    const observer = target ? new ResizeObserver(resize) : undefined
    if (target) observer?.observe(target)
    else addEventListener('resize', resize)
    return () => {
      observer?.disconnect()
      removeEventListener('resize', resize)
    }
  }, [element])
  return room
}

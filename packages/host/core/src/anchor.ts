import {useLayoutEffect, useState} from 'react'
import type {Side} from './modes.js'
import type {ProjectionAnchor, ProjectionController} from './projection.js'

function same(a: ProjectionAnchor | null, b: ProjectionAnchor | null): boolean {
  if (!a || !b) return a === b
  return (
    a.side === b.side &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

/**
 * Follows where a row (default: the selection) is drawn, in host viewport
 * coordinates, so a consumer can place an overlay such as a comment popover
 * beside it. Updates when the renderer reports a move (its own scrolling,
 * resizing or layout), when the mode changes, and when the host page scrolls or
 * resizes; `null` while the item isn't visible or the renderer doesn't report
 * anchors.
 */
export function useProjectionAnchor(projection: ProjectionController, rowId?: string | null, side?: Side): ProjectionAnchor | null {
  const id = rowId === undefined ? projection.selectedId : rowId
  const measure = projection.anchorFor
  // A mode change can move a frame without resizing it or scrolling the page, so it measures again too.
  const mode = projection.mode
  const [anchor, setAnchor] = useState<ProjectionAnchor | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const next = measure(id, side)
      setAnchor(previous => (same(previous, next) ? previous : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    addEventListener('scroll', schedule, {capture: true, passive: true})
    addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(document.documentElement)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('scroll', schedule, {capture: true})
      removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [measure, id, side, mode])
  return anchor
}

import {useLayoutEffect, useState, type RefObject} from 'react'
import type {Side} from '../modes.js'

/**
 * What the stage overlays on each frame (its utility area: side by side's and swipe's chips, animated's playback
 * bar; and its foot: the floating legend and summary), as the frame's `stage-cover`, `stage-inset-top` and
 * `stage-inset-bottom` theme tokens. Undefined while nothing covers it.
 */
export interface FrameCover {
  /** The covered rectangles, `x y width height` in whole CSS px from the frame's top left, comma separated. */
  cover: string
  /**
   * Of the rectangles in the frame's top half: the bottom of the lowest and as much again as the highest one's gap
   * above it, CSS px; 0 without any.
   */
  insetTop: number
  /** The same for the rectangles in its bottom half, up from the frame's bottom edge, CSS px; 0 without any. */
  insetBottom: number
}

export type FrameCovers = Partial<Record<Side, FrameCover | undefined>>

/** The bands that `rects` take at the top and at the foot of a frame `height` tall (`FrameCover`), CSS px. */
export function insets(rects: readonly {y: number; height: number}[], height: number): {insetTop: number; insetBottom: number} {
  const middle = height / 2
  const top = rects.filter(rect => rect.y + rect.height / 2 <= middle)
  const bottom = rects.filter(rect => rect.y + rect.height / 2 > middle)
  const band = (
    side: typeof top,
    edge: (rect: {y: number; height: number}) => number,
    extent: (rect: {y: number; height: number}) => number,
  ) => (side.length ? Math.max(...side.map(extent)) + Math.max(0, Math.min(...side.map(edge))) : 0)
  return {
    // The lowest rectangle's bottom, and as much again as the highest one's gap above it.
    insetTop: band(
      top,
      rect => rect.y,
      rect => rect.y + rect.height,
    ),
    // Up from the frame's bottom: the highest rectangle's top, and as much again as the lowest one's gap below it.
    insetBottom: band(
      bottom,
      rect => height - rect.y - rect.height,
      rect => height - rect.y,
    ),
  }
}

/** The elements of the stage body that overlay its frames. */
export const coverSelector = '[data-stage-cover]'

const sameCovers = (a: FrameCovers, b: FrameCovers) =>
  a.before?.cover === b.before?.cover &&
  a.after?.cover === b.after?.cover &&
  a.before?.insetTop === b.before?.insetTop &&
  a.after?.insetTop === b.after?.insetTop &&
  a.before?.insetBottom === b.before?.insetBottom &&
  a.after?.insetBottom === b.after?.insetBottom

/**
 * The cover of each frame: every element in `container` marked `data-stage-cover` that lies over the frame, in the
 * frame's own coordinates, measured before paint and again whenever the container, a cover or a frame resizes. The
 * host decides what covers the frame, never the frame's content, so the measurement can't feed back on itself. A
 * cover the stage has just shown fades in (`appear`), unless motion is reduced.
 */
export function useFrameCovers(
  container: RefObject<HTMLElement | null>,
  frames: () => Partial<Record<Side, HTMLIFrameElement | undefined>>,
  key: unknown,
  reducedMotion: boolean,
): FrameCovers {
  const [covers, setCovers] = useState<FrameCovers>({})
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return undefined
    const measure = () => {
      const top = element.getBoundingClientRect().top
      // A sticky cover is measured where it rests, at the stage's top: once stuck, it moves over the content as the
      // page scrolls, which a renderer needn't keep clear of.
      const covering = [...element.querySelectorAll<HTMLElement>(coverSelector)]
        .map(cover => {
          const rect = cover.getBoundingClientRect()
          const sticky = cover.closest<HTMLElement>('[data-stage-sticky]')
          const moved = sticky ? Math.max(0, sticky.getBoundingClientRect().top - top) : 0
          return new DOMRect(rect.x, rect.y - moved, rect.width, rect.height)
        })
        .filter(rect => rect.width > 0 && rect.height > 0)
      const current = frames()
      const of = (side: Side): FrameCover | undefined => {
        const frame = current[side]
        if (!frame?.isConnected) return undefined
        const box = frame.getBoundingClientRect()
        const rects = covering
          .filter(rect => rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top)
          .map(rect => ({
            x: Math.round(rect.left - box.left),
            y: Math.round(rect.top - box.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }))
        if (!rects.length) return undefined
        return {cover: rects.map(rect => `${rect.x} ${rect.y} ${rect.width} ${rect.height}`).join(', '), ...insets(rects, box.height)}
      }
      const next = {before: of('before'), after: of('after')}
      setCovers(previous => (sameCovers(previous, next) ? previous : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const cover of element.querySelectorAll(coverSelector)) observer.observe(cover)
    for (const frame of Object.values(frames())) if (frame) observer.observe(frame)
    window.addEventListener('resize', measure)
    if (!reducedMotion) {
      for (const cover of element.querySelectorAll<HTMLElement>(coverSelector)) {
        if (cover.dataset.stageCoverShown !== undefined) continue
        cover.dataset.stageCoverShown = ''
        if ('animate' in cover) cover.animate([{opacity: 0}, {opacity: 1}], {duration: 120, easing: 'ease-out'})
      }
    }
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [container, frames, key, reducedMotion])
  return covers
}

/** A frame's cover as its theme tokens: `stage-cover`, and each inset where something covers that edge. */
export function coverTokens(cover: FrameCover): Record<string, string> {
  return {
    'stage-cover': cover.cover,
    ...(cover.insetTop ? {'stage-inset-top': `${cover.insetTop}px`} : {}),
    ...(cover.insetBottom ? {'stage-inset-bottom': `${cover.insetBottom}px`} : {}),
  }
}

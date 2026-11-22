import {useLayoutEffect, useMemo, useState, type RefObject} from 'react'
import {coveredPadding, scrolledPadding, type FitPadding} from '../fit.js'
import {useFrameSizing, useStageCover, useStageInsetBottom, useStageInsetTop} from './shell/frame.js'

/**
 * `padding` for content of `size` fitted to the stage element `stage` (as `useFitScale` fits it), with its top moved
 * down and its bottom (`y`) up only where the host's cover (`useStageCover`) would otherwise lie over the fitted
 * drawing (see `coveredTop` and `coveredBottom`): a flat graph centred below a pane's chips and above a floating
 * summary keeps its own padding, a tall one opens between them. Without a cover, `padding` as it is. Pass the result
 * to `useFitScale` and pad the drawing's top by its `top` and its bottom by its `y` (the kit's `--pk-fit-top` and
 * `--pk-fit-bottom`, which graph.css reads). The stage is measured in the frame on every resize. In a frame the host
 * sizes to the content, the host's insets say which rectangles lie at the frame's top and which at its foot, and the
 * bottom clears its `stage-inset-bottom`, less what lies below the stage, rather than where the rectangles lie, which
 * move as the frame grows (see `coveredBottom`).
 */
export function useCoveredPadding<P extends FitPadding>(
  stage: RefObject<HTMLElement | null>,
  size: {width: number; height: number} | undefined,
  padding: P,
  maxScale = 1,
): P {
  const cover = useStageCover()
  const insetTop = useStageInsetTop()
  const insetBottom = useStageInsetBottom()
  // A host that sizes the frame to its content places its cover by its insets (see `coveredBottom`).
  const content = useFrameSizing() === 'content' && (insetTop !== undefined || insetBottom !== undefined)
  // The stage in the frame's document, and how much of the frame lies below it (a footer under the drawing).
  const [box, setBox] = useState<{x: number; y: number; width: number; height: number; below: number}>()
  const covered = cover !== undefined
  const sized = size !== undefined
  useLayoutEffect(() => {
    const element = stage.current
    if (!element || !covered) return undefined
    const view = element.ownerDocument.defaultView
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const next = {
        x: Math.round(rect.left + (view?.scrollX ?? 0)),
        y: Math.round(rect.top + (view?.scrollY ?? 0)),
        width: element.clientWidth,
        height: element.clientHeight,
        below: Math.max(0, Math.round(element.ownerDocument.documentElement.clientHeight - rect.bottom)),
      }
      setBox(last =>
        last?.x === next.x &&
        last.y === next.y &&
        last.width === next.width &&
        last.height === next.height &&
        last.below === next.below
          ? last
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(element.ownerDocument.documentElement)
    return () => observer.disconnect()
  }, [stage, covered, sized])
  return useMemo(() => {
    if (!cover || !box || !size) return padding
    const insets = content ? {insets: {top: insetTop ?? 0, bottom: insetBottom ?? 0, below: box.below}} : {}
    const {top, y} = coveredPadding({cover, view: box, origin: box, size, padding, maxScale, ...insets})
    return top === (padding.top ?? padding.y) && y === padding.y ? padding : {...padding, top, y}
  }, [cover, box, size, padding, maxScale, content, insetTop, insetBottom])
}

/**
 * The padding a fitted drawing is drawn with (its `--pk-fit-top` and `--pk-fit-bottom`): `padding` while it is drawn
 * at its fitted scale (`fitScale`), and once it is drawn larger and scrolls down (opened at the text floor, or zoomed
 * in: `drawnScale`), under a cover a top of at least the host's `stage-inset-top` and a bottom (`y`) of at least its
 * `stage-inset-bottom`, so its first row opens, and its last row scrolls, clear of what the host overlays at the
 * frame's top and foot. `height` is the content's height (content units) and the stage's inner height (`Fit.height`):
 * a drawing drawn larger that still fits the stage's height (a flat graph zoomed in) keeps its padding where, centred,
 * it clears the bands, and takes just enough more where it doesn't (`scrolledPadding`), so it moves no more than it
 * must as it zooms. The fit never reads it.
 */
export function useScrolledPadding<P extends FitPadding>(
  padding: P,
  drawnScale: number,
  fitScale: number,
  height?: {content: number; view: number},
): P {
  const cover = useStageCover()
  const insetTop = useStageInsetTop()
  const insetBottom = useStageInsetBottom()
  const own = padding.top ?? padding.y
  const scrolled = Boolean(cover?.length) && fitScale > 0 && drawnScale > fitScale * 1.001
  const inset = {top: insetTop ?? 0, bottom: insetBottom ?? 0}
  const {top, y: bottom} = !scrolled
    ? {top: own, y: padding.y}
    : height
      ? scrolledPadding({own: {top: own, y: padding.y}, inset, height: height.content * drawnScale, view: height.view})
      : {top: Math.max(own, inset.top), y: Math.max(padding.y, inset.bottom)}
  return useMemo(() => (top === own && bottom === padding.y ? padding : {...padding, top, y: bottom}), [padding, top, own, bottom])
}

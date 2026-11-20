import {useLayoutEffect, useMemo, useState} from 'react'
import type {RefObject} from 'react'
import {coveredTop} from '../fit.js'
import type {FitPadding} from '../fit.js'
import {useStageCover} from './shell/frame.js'

/**
 * `padding` for content of `size` fitted to the stage element `stage` (as `useFitScale` fits it), with its top moved
 * down only where the host's cover (`useStageCover`) would otherwise lie over the fitted drawing (see `coveredTop`):
 * a flat graph centred below a pane's chips keeps its own top, a tall one opens below them. Without a cover,
 * `padding` as it is. Pass the result to `useFitScale` and pad the drawing's top by its `top` (the kit's
 * `--pk-fit-top`, which graph.css reads). The stage is measured in the frame on every resize.
 */
export function useCoveredPadding<P extends FitPadding>(
  stage: RefObject<HTMLElement | null>,
  size: {width: number; height: number} | undefined,
  padding: P,
  maxScale = 1,
): P {
  const cover = useStageCover()
  const [box, setBox] = useState<{x: number; y: number; width: number; height: number}>()
  const covered = cover !== undefined
  const sized = size !== undefined
  useLayoutEffect(() => {
    const element = stage.current
    if (!element || !covered) return
    const view = element.ownerDocument.defaultView
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const next = {
        x: Math.round(rect.left + (view?.scrollX ?? 0)),
        y: Math.round(rect.top + (view?.scrollY ?? 0)),
        width: element.clientWidth,
        height: element.clientHeight,
      }
      setBox(last =>
        last && last.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height ? last : next,
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
    const top = coveredTop({cover, view: box, origin: box, size, padding, maxScale})
    return top === (padding.top ?? padding.y) ? padding : {...padding, top}
  }, [cover, box, size, padding, maxScale])
}

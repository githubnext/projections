import {useLayoutEffect, useRef, useState} from 'react'
import type {RefObject} from 'react'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import {fitPadding, fitPaddingDown, fitScale} from '../fit.js'
import type {Fit, FitOptions} from '../fit.js'
import {openingZoom} from '../zoom.js'
import {useContentAspect, useFrameFill, useFrameSizing, usePaintHold, useStageHeightCap} from './shell/frame.js'

/**
 * Fits content of `size` (in its own units) to the stage element `stage`,
 * the flexible child of a filling renderer (see `useFrameFill`): centred and
 * scaled down to fit both dimensions, however small that makes it (the user
 * can zoom in, see `useStageZoom`), never above `maxScale`. Reports the height
 * a content-sized host should give the frame: the stage at the width-fitted
 * scale (or at `options.floor` when that is larger and the view opens there)
 * plus everything around it, but never more than the host's `stage-max-height` (`useStageHeightCap`), when it sends
 * one: content taller than that is fitted to the capped stage instead (or opens at the text floor and pans). Zoomed in
 * (`options.drawnScale`), it asks for the content's height at that scale, up to the same cap. Measured before paint and on every resize;
 * a new measurement holds the host's paint acknowledgement until the content
 * is drawn at its scale, so a host never measures a scale about to change
 * (such as the one before the renderer fills its frame).
 */
export function useFitScale(
  stage: RefObject<HTMLElement | null>,
  size: {width: number; height: number} | undefined,
  options: FitOptions = {},
): Fit {
  const {padding = 16, maxScale = 1, minHeight = 200, floor = 0, aspect, drawnScale = 0} = options
  const pad = fitPadding(padding)
  const down = fitPaddingDown(padding).total
  interface Measured {
    width: number
    height: number
    chrome: number | undefined
  }
  const [measured, setMeasured] = useState<Measured>()
  const hold = usePaintHold()
  const sizing = useFrameSizing()
  const cap = useStageHeightCap()
  // The latest measurement, and the paint acknowledgement held until it is drawn.
  const latest = useRef<Measured>(undefined)
  const held = useRef<() => void>(undefined)
  const remeasure = useRef<() => void>(undefined)
  // The stage mounts with the content, so measuring starts once there is content.
  const hasContent = size !== undefined
  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return undefined
    let observedFill: Element | undefined
    // Measures, and has `watcher` (the stage's observer) watch the frame's fill once there is one.
    const measure = (watcher: ResizeObserver) => {
      const width = element.clientWidth,
        height = element.clientHeight
      // Everything in the frame that is not the stage: captions, footers, scrollbars. Known once the renderer fills
      // its frame (`useFrameFill`); before that the stage is only as tall as its content, which hasn't been drawn at
      // a measured scale yet, and a height reported from it would be far too tall.
      const fill = element.closest<HTMLElement>('[data-fill]')
      if (fill && fill !== observedFill) watcher.observe((observedFill = fill))
      const chrome = fill ? chromeAround(element, fill) : undefined
      const previous = latest.current
      if (previous?.width === width && previous.height === height && previous.chrome === chrome) return
      // A resize observed outside React renders later: the frame painted until then is drawn at the old scale.
      held.current ??= hold()
      latest.current = {width, height, chrome}
      setMeasured(latest.current)
    }
    const observer = new ResizeObserver((_entries, self) => measure(self))
    observer.observe(element)
    observer.observe(element.ownerDocument.documentElement)
    measure(observer)
    remeasure.current = () => measure(observer)
    return () => {
      observer.disconnect()
      remeasure.current = undefined
    }
  }, [stage, hasContent, hold])
  // The renderer starts filling its frame (`useFrameFill`, below) in the commit after the first measurement: measured
  // again as that commits, before paint, the height is reported before the paint is acknowledged. Left to the resize
  // observer, it waits for the frame's next rendering opportunity, which on a loaded machine can come after the
  // acknowledgement has gone out on its timer (see `afterPaint`): a host would measure the frame before the renderer
  // had asked for any height.
  useLayoutEffect(() => {
    if (latest.current && latest.current.chrome === undefined) remeasure.current?.()
  })
  useLayoutEffect(() => {
    if (measured !== latest.current || !held.current) return
    held.current()
    held.current = undefined
  }, [measured])
  useLayoutEffect(
    () => () => {
      held.current?.()
      held.current = undefined
    },
    [],
  )
  let fit =
    !measured || !size || size.width <= 0 || size.height <= 0
      ? undefined
      : // A stage with no width (a hidden frame) has nothing to fit to: content keeps its own size until it is shown.
        measured.width <= 0
        ? {scale: maxScale, widthFirst: maxScale}
        : // A host that gives the frame the height it reports will make room for the content at its width's fit: fit to
          // that from the first paint, not to the height the frame has before the host answers.
          sizing === 'content'
          ? fitScale(size, {width: measured.width, height: rendererLimits.maxHeight}, {padding, maxScale})
          : // A stage with no height yet (an offscreen frame laid out before its pane, whose resize arrives only once
            // it is shown) fits the width, never collapsing the content to nothing.
            measured.height <= down
            ? (({widthFirst}) => ({scale: widthFirst, widthFirst}))(fitScale(size, measured, {padding, maxScale}))
            : fitScale(size, measured, {padding, maxScale})
  // Content scaled down to the width already spans the stage, so it gets exactly its height, never a margin above it.
  const least = fit && fit.widthFirst < maxScale ? 0 : minHeight
  // A view that opens at the text floor rather than the width's fit takes the content's height at that floor.
  const opening = fit ? fit.widthFirst * openingZoom(fit.widthFirst, floor) : 0
  const natural =
    fit && measured?.chrome !== undefined && size ? measured.chrome + Math.max(least, size.height * opening + down) : undefined
  // A content-sized frame lies in the host's page: a stage taller than most of its window is capped, and the content
  // fitted to the capped stage (both dimensions) rather than to the width alone.
  const preferred =
    natural === undefined || sizing !== 'content' || cap === undefined
      ? natural
      : Math.min(natural, Math.max(cap, measured!.chrome! + least))
  if (preferred !== undefined && natural !== undefined && preferred < natural && size && measured && measured.width > 0) {
    fit = fitScale(size, {width: measured.width, height: preferred - measured.chrome!}, {padding, maxScale})
  }
  // Zoomed in past where it opens, the stage grows to the content's height at the drawn scale, up to the cap.
  const zoomed =
    preferred !== undefined && sizing === 'content' && drawnScale > opening && size
      ? Math.max(preferred, Math.min(measured!.chrome! + size.height * drawnScale + down, cap ?? rendererLimits.maxHeight))
      : preferred
  const reported = zoomed === undefined ? undefined : Math.round(zoomed)
  useFrameFill(reported)
  useArrivedHeight(stage, sizing === 'content' ? reported : undefined, hold)
  useContentAspect(aspect ?? (size && size.width > 0 && size.height > 0 ? (size.width + 2 * pad.x) / (size.height + down) : undefined))
  return {scale: fit?.scale ?? 0, width: measured?.width ?? 0, height: measured?.height ?? 0}
}

/**
 * The height, CSS px, of everything in the frame but the stage's inside: the frame less the stage while the stage
 * fills its share of the frame, else the document outside the filling column `fill`, the column's border, and its
 * content but the stage's client height. While the stage is for a moment as tall as its own content (a frame being
 * resized, a style not yet applied), the frame less the stage would be short by exactly as much as the stage
 * overflows, and the height reported from it would keep the frame as it is, whatever order the resizes come in.
 */
function chromeAround(stage: HTMLElement, fill: HTMLElement): number {
  const frame = stage.ownerDocument.documentElement.clientHeight
  // The column's content counts only when the stage overflows it (a popover's overflow never does).
  if (stage.getBoundingClientRect().bottom <= fill.getBoundingClientRect().bottom + 0.5) return frame - stage.clientHeight
  const outside = Math.max(0, frame - fill.offsetHeight)
  return outside + (fill.offsetHeight - fill.clientHeight) + fill.scrollHeight - stage.clientHeight
}

/** How long a paint acknowledgement waits for the frame to take the height asked for, ms: a host may never resize it. */
const arrivalTimeout = 1000

/**
 * Holds the paint acknowledgement (`hold`, see `usePaintHold`) until the frame has the height a content-sized host was
 * asked for (`height`, clamped as the host clamps it), or `arrivalTimeout` passes. The renderer's frame is a sandboxed,
 * out-of-process frame, so the host's resize reaches it only some time after the host applies it: acknowledged before,
 * the paint is of the frame at its old height, with the view placed for that, and a host that measures once the paint
 * is acknowledged (a check, a screenshot) sees it so.
 */
function useArrivedHeight(stage: RefObject<HTMLElement | null>, height: number | undefined, hold: () => () => void): void {
  useLayoutEffect(() => {
    const view = stage.current?.ownerDocument.documentElement
    if (height === undefined || !view) return undefined
    const target = Math.min(rendererLimits.maxHeight, Math.max(rendererLimits.minHeight, Math.ceil(height)))
    const arrived = () => Math.abs(view.clientHeight - target) <= 1
    if (arrived()) return undefined
    const release = hold()
    const observer = new ResizeObserver(() => {
      if (arrived()) done()
    })
    const timer = setTimeout(() => done(), arrivalTimeout)
    function done() {
      observer.disconnect()
      clearTimeout(timer)
      release()
    }
    observer.observe(view)
    return done
  }, [stage, height, hold])
}

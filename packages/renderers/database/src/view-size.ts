import {useLayoutEffect, useState, type RefObject} from 'react'

/**
 * The width the schema is laid out for (the view's, with or without a scrollbar, so zoom never reflows it) and the
 * stage's inner size and vertical padding, measured before paint and on resize.
 */
export function useViewSize(view: RefObject<HTMLDivElement | null>) {
  const [available, setAvailable] = useState(1100)
  const [stage, setStage] = useState<{width: number; height: number; padding: number}>()
  useLayoutEffect(() => {
    const element = view.current
    if (!element) return undefined
    const measure = () => {
      const style = getComputedStyle(element)
      const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      // Laid out for the view's width with or without a scrollbar (which only a zoomed schema has), so zoom never reflows it.
      const width = element.offsetWidth - horizontal
      if (width > 0) setAvailable(Math.floor(width))
      const inner = {width: element.clientWidth - horizontal, height: element.clientHeight - vertical, padding: vertical}
      setStage(previous =>
        previous?.width === inner.width && previous.height === inner.height && previous.padding === inner.padding ? previous : inner,
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [view])
  return {available, stage}
}

/** The content's own height, measured before paint and on resize. */
export function useNaturalHeight(content: RefObject<HTMLDivElement | null>) {
  const [natural, setNatural] = useState<number>()
  useLayoutEffect(() => {
    const element = content.current
    if (!element) return undefined
    const measure = () => setNatural(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [content])
  return natural
}

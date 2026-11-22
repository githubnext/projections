import {useLayoutEffect, useState, type RefObject} from 'react'
import {useFrameFill} from '@githubnext/projections-renderer-kit/react'

/** The smallest area packed, CSS px. */
const minimum = {width: 300, height: 220}
/** Height a content-sized host gets, as a share of the width (square on narrow screens). */
const preferredAspect = 0.62

/**
 * The stage's inner size, inside its padding (the kit's stage padding, `pk-stage`), measured before paint and on
 * resize; the packing fills it. A stage smaller than the smallest area packed gets that area scaled down to fit (`fit`
 * below 1), so the whole packing is always in view.
 */
export function useStageSize(stage: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{width: number; height: number; chrome: number; fit: number; padding: number}>()
  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      const padding = {
        inline: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        block: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      }
      const room = {width: element.clientWidth - padding.inline, height: element.clientHeight - padding.block}
      const width = Math.max(minimum.width, room.width)
      const height = Math.max(minimum.height, room.height)
      const fit = Math.max(0.05, Math.min(1, room.width / width, room.height / height))
      const chrome = element.ownerDocument.documentElement.clientHeight - element.clientHeight
      setSize(previous =>
        previous?.width === width &&
        previous.height === height &&
        previous.chrome === chrome &&
        previous.fit === fit &&
        previous.padding === padding.block
          ? previous
          : {width, height, chrome, fit, padding: padding.block},
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(element.ownerDocument.documentElement)
    return () => observer.disconnect()
  }, [stage])
  useFrameFill(
    size && Math.round(size.chrome + Math.max(minimum.height, size.width * (size.width < 600 ? 1 : preferredAspect)) + size.padding),
  )
  return size
}

/** The theme's extra-small type size in CSS px, which labels are drawn in and fitted to. */
export function useLabelSize(): number {
  const [size, setSize] = useState(12)
  useLayoutEffect(() => {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--projections-font-size-xs'))
    if (Number.isFinite(value) && value > 0) setSize(value)
  }, [])
  return size
}

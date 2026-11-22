import {useLayoutEffect, useState, type RefObject} from 'react'
import {defaultBorderWidths, readBorderWidths, type BorderWidths} from '../border.js'

/** The border widths in effect on a rendered element, read when it mounts (before its first paint); the defaults until then. */
export function useBorderWidths(ref: RefObject<Element | null>): BorderWidths {
  const [widths, setWidths] = useState(defaultBorderWidths)
  useLayoutEffect(() => {
    const next = readBorderWidths(ref.current)
    setWidths(current => (current.normal === next.normal && current.strong === next.strong ? current : next))
  }, [ref])
  return widths
}

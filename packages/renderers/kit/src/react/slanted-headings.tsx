// Column headings slanted at 45°, for a table whose columns are narrower than their headings (a matrix).
import {useLayoutEffect, type ReactNode, type RefObject} from 'react'

/**
 * A column heading slanted at 45°, reading up and to the right from its column's bottom centre, so a column is only
 * as wide as its cells however long its heading. Render it as the only content of the column's heading cell (a `th`
 * with the class `pk-slanted-column`), and call `useSlantedHeadings` with the table, which makes the heading row as
 * tall as the longest heading needs. A heading's tail runs over the columns to its right, so the table needs room on
 * its right for the last one's: its following columns, or the space beside it.
 */
export function SlantedHeading({children}: {children: ReactNode}) {
  return (
    <span className="pk-slanted-heading">
      <span className="pk-slanted-heading-label">{children}</span>
    </span>
  )
}

/**
 * Sizes a table's slanted headings (`SlantedHeading`): sets `--pk-slant-length` on the table, the longest heading's
 * length in CSS px, from which each `pk-slanted-column` takes the height its slanted heading needs. Layout lengths, so
 * a zoomed or fitted drawing doesn't change them; measured on every render and once the fonts load.
 */
export function useSlantedHeadings(table: RefObject<HTMLTableElement | null>): void {
  useLayoutEffect(() => {
    const element = table.current
    if (!element) return undefined
    let live = true
    const measure = () => {
      if (!live) return
      let longest = 0
      for (const label of element.querySelectorAll<HTMLElement>('.pk-slanted-heading-label')) longest = Math.max(longest, label.offsetWidth)
      const value = `${Math.ceil(longest)}px`
      if (element.style.getPropertyValue('--pk-slant-length') !== value) element.style.setProperty('--pk-slant-length', value)
    }
    measure()
    // DOM implementations without font loading (jsdom) have no `fonts`.
    if ('fonts' in element.ownerDocument) void element.ownerDocument.fonts.ready.then(measure)
    return () => {
      live = false
    }
  })
}

// A pill's status as a tab hanging off its bottom edge at its left, or flush with a pill no wider than it.
import {useLayoutEffect, useRef} from 'react'
import {variedBeyond} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange, statusParts} from '../emphasis.js'
import type {StatusChange} from '../svg-status.js'
import {Icon} from './icons.js'
import {VariedMarker} from './components.js'

/**
 * A pill's or chip's status as a tab hanging off its bottom edge: the icon and
 * word per part, filled and edged in the status hue, joined to the pill and
 * rounded on its free corners. Render it inside the pill (positioned:
 * `position: relative` or otherwise), which keeps its single-line box; the
 * pill's container reserves `--pk-tab-height` below every pill, so nothing
 * moves when status appears, but an unchanged pill draws nothing there. The
 * tab joins the pill at its left, its left side on the pill's left border and
 * the pill's bottom-left corner squared; the pill's content is centred. Where
 * the pill is too narrow to keep its bottom-right corner radius clear of the
 * tab, the tab spans the pill's full width, its sides on the pill's borders,
 * and both the pill's bottom corners are squared, so pill and tab read as one
 * shape. A pill must
 * be at least as wide as its tab: `measure` draws the tab at full strength
 * and its natural width, for measuring the room a pill needs (the wider of its
 * content and `.pk-status-tab`). It fades with `emphasis` and is absent at 0.
 * The pill's accessible name carries the status, so the tab is hidden from
 * assistive technology.
 */
export function StatusTab({change, emphasis, measure = false}: {change: StatusChange; emphasis: number; measure?: boolean}) {
  const shown = measure ? 1 : emphasis
  const parts = shown > 0.01 ? statusParts(change) : []
  const varied = variedBeyond(change)
  const room = useRef<HTMLSpanElement>(null)
  const drawn = `${parts.map(part => part.status).join(' ')}${varied ? ' varied' : ''}`
  useLayoutEffect(() => {
    const element = room.current
    if (!element || measure) return
    const update = () => {
      element.removeAttribute('data-flush')
      const tab = element.firstElementChild
      if (!(tab instanceof HTMLElement)) return
      // Layout widths, unscaled by a zoomed or fitted drawing, at the tab's natural width.
      const style = getComputedStyle(element)
      const corner =
        (parseFloat(style.getPropertyValue('--projections-radius')) || 0) -
        (parseFloat(style.getPropertyValue('--projections-border-width')) || 0)
      // The room starts on the pill's left border, so only the right corner needs clearing.
      if (tab.offsetWidth + corner > element.clientWidth + 0.5) element.setAttribute('data-flush', '')
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    // The pill resizes with its slot, and the tab with its font.
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [drawn, measure])
  return (
    <span className="pk-status-tab-room" aria-hidden="true" ref={room}>
      {parts.length > 0 && (
        <span className="pk-status-tab pk-region" data-change={classifyChange(change)} style={{opacity: Math.min(1, shown)}}>
          {parts.map(part => (
            <span key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
              <Icon name={part.icon} />
              {part.label}
            </span>
          ))}
          {varied && <VariedMarker />}
        </span>
      )}
    </span>
  )
}

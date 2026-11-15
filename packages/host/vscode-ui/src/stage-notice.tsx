import {useLayoutEffect, useRef} from 'react'
import type {ReactNode} from 'react'

/**
 * A pill floating over the stage (`VscodeProjectionView`'s `stageNotice`), for a state of the whole result rather than
 * a control: "⚠ Out of date · 3 files changed  ⟳ Refresh". The view draws it at the stage's top centre, 12px in,
 * over whatever the renderer, table or text view shows; it takes no layout space and stays put while they scroll. In
 * side by side and swipe it sits 12px below the panes' header bands (the top pane's when stacked), so it covers no
 * revision name.
 * Narrow, the detail truncates first; the label and the action stay whole.
 */
export interface StageNoticeProps {
  /** What is wrong, never truncated: "Out of date". */
  label: string
  /** More about it, after a middle dot, truncated first on a narrow stage: "3 files changed". */
  detail?: string | undefined
  /** Why, as the pill's tooltip. */
  title?: string | undefined
  /** The codicon before the label (`warning` by default). */
  icon?: string
  /** One flat text button at the pill's end, with an optional codicon: Refresh. */
  action?: {label: string; icon?: string; onClick: () => void} | undefined
  /** Attributes for hosts and tests to find it by (`data-*`). */
  data?: {[name: `data-${string}`]: string}
}

/** A warning pill over the stage; a status, so screen readers announce it when it appears. */
export function StageNotice({label, detail, title, icon = 'warning', action, data}: StageNoticeProps) {
  return (
    <div className="phv-stage-notice" role="status" data-severity="warning" {...data}>
      <span className="phv-stage-notice-message" title={title}>
        <span className={`codicon codicon-${icon} phv-stage-notice-icon`} aria-hidden="true" />
        <span className="phv-stage-notice-label phv-cap">{label}</span>
        {detail && <span className="phv-stage-notice-detail phv-cap">· {detail}</span>}
      </span>
      {action && (
        <button type="button" className="phv-stage-notice-action" onClick={action.onClick}>
          {action.icon && <span className={`codicon codicon-${action.icon}`} aria-hidden="true" />}
          <span className="phv-cap">{action.label}</span>
        </button>
      )}
    </div>
  )
}

/** The stage's inset: the pill's distance from the stage's top, or from the panes' header bands below it. */
const inset = 12

/**
 * Where the view draws its `stageNotice`: across the top of the stage it sits in (its parent, the workspace, which
 * doesn't scroll), 12px in, and
 * when the panes have header bands at the stage's top (side by side and swipe), 12px below the lowest of them. Placed
 * again as the stage resizes or its panes change (another mode, columns or stacked).
 */
export function StageNoticeSlot({children}: {children: ReactNode}) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = slot.current
    const workspace = element?.parentElement
    if (!element || !workspace) return
    let frame = 0
    const place = () => {
      frame = 0
      const top = workspace.getBoundingClientRect().top
      const bands = [...workspace.querySelectorAll(':is(.ph-panes, .ph-swipe) [data-pane-band]')]
        .map(band => band.getBoundingClientRect())
        .filter(box => box.height > 0)
      // The bands along the stage's top: both in columns and swipe, the before pane's alone when stacked.
      const first = Math.min(...bands.map(box => box.top))
      const below = Math.max(0, ...bands.filter(box => box.top <= first + 1).map(box => box.bottom - top))
      element.style.top = `${Math.round(below) + inset}px`
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(place)
    }
    place()
    const resized = new ResizeObserver(schedule)
    resized.observe(workspace)
    const changed = new MutationObserver(schedule)
    changed.observe(workspace, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-stacked', 'data-comparison-mode'],
    })
    return () => {
      cancelAnimationFrame(frame)
      resized.disconnect()
      changed.disconnect()
    }
  }, [])
  return (
    <div ref={slot} className="phv-stage-notice-slot">
      {children}
    </div>
  )
}

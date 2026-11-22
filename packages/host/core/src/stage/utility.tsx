import {useLayoutEffect, useRef} from 'react'
import type {ReactNode} from 'react'
import {useWholePixels} from './whole-pixels.js'

/** How far the utility area sits from the stage's top, CSS px: as far as from its sides. */
export const utilityInset = 12
/**
 * How far it keeps from the stage's sides, CSS px: where renderers start their content (the kit's stage padding, as the
 * pane chips), so a bar as wide as the stage lines up with the tables and cards under it.
 */
export const utilitySide = 12

/**
 * The stage's utility area (`ProjectionStageProps.utility`): a bar floating over the stage's top edge, inset from its
 * sides (`utilitySide`), as wide as its content needs (at most the stage less its insets), centred on whole pixels. It covers the
 * frames under it (`data-stage-cover`), which the stage tells them, so they keep clear of it; the stage shows around it.
 *
 * In a stage laid out in its page (not filling a fixed height), the bar is sticky: it stays in view while the stage
 * is on screen, below the host's stuck toolbar, which sets `--ph-stage-sticky-top` to the toolbar's height.
 *
 * It draws the toolbar's surface and the divider at its edge, so it reads as the toolbar's own, floating; a host
 * restyles it with `--ph-utility-fg`, `--ph-utility-muted` (its muted text, which the chips' names take), `--ph-utility-bg`, `--ph-utility-border`, `--ph-utility-radius`, `--ph-utility-shadow` and `--ph-utility-backdrop` (a `backdrop-filter`, for a translucent fill).
 */
export function UtilityArea({children}: {children: ReactNode}) {
  const bar = useRef<HTMLDivElement>(null)
  const sticky = useRef<HTMLDivElement>(null)
  // Centred by flex, the bar can land between pixels, and where it rests and where it sticks differ by the scroll.
  useWholePixels(bar)
  useLayoutEffect(() => {
    const area = sticky.current
    if (!area) return undefined
    // The area is as tall as its inset and the bar, so it sticks only while all of it fits in the stage and never
    // overhangs the stage's end (sticky keeps its margin box in the stage). It takes none of that from the stage: what
    // follows it (the frame, or a view that scrolls) starts that much higher.
    let next: HTMLElement | null = null
    const size = () => {
      const after = area.nextElementSibling instanceof HTMLElement ? area.nextElementSibling : null
      if (next && next !== after) next.style.marginTop = ''
      next = after
      if (next) next.style.marginTop = `${-area.offsetHeight}px`
    }
    size()
    const observer = new ResizeObserver(size)
    observer.observe(area)
    if (area.parentElement) observer.observe(area.parentElement)
    return () => {
      if (next) next.style.marginTop = ''
      observer.disconnect()
    }
  }, [])
  return (
    // Sticky, so in a stage that scrolls with its page the bar stays in view while the stage is, below the host's stuck
    // toolbar (`--ph-stage-sticky-top`). It sits in the frame's section, ahead of the frame.
    <div
      ref={sticky}
      className="ph-utility-sticky ph-utility-area"
      data-stage-sticky=""
      style={{
        position: 'sticky',
        top: 'var(--ph-stage-sticky-top, 0px)',
        zIndex: 2,
        flex: 'none',
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'center',
        padding: `${utilityInset}px ${utilitySide}px 0`,
        // The stage around the bar stays the stage's: drags and clicks there reach the frame.
        pointerEvents: 'none',
      }}
    >
      <div
        ref={bar}
        className="ph-utility"
        data-stage-cover=""
        role="group"
        aria-label="Stage controls"
        style={{
          boxSizing: 'border-box',
          minWidth: 0,
          maxWidth: '100%',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          color: 'var(--ph-utility-fg, inherit)',
          background: 'var(--ph-utility-bg, var(--projections-color-surface-header, #f6f8fa))',
          border: 'var(--ph-utility-border, 1px solid var(--projections-color-divider, #d1d9e0))',
          borderRadius: 'var(--ph-utility-radius, var(--projections-radius, 8px))',
          boxShadow: 'var(--ph-utility-shadow, none)',
          backdropFilter: 'var(--ph-utility-backdrop, none)',
          WebkitBackdropFilter: 'var(--ph-utility-backdrop, none)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

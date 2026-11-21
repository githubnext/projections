import {LoaderCircle} from 'lucide-react'
import {useLayoutEffect, useRef} from 'react'
import type {CSSProperties} from 'react'
import type {ProjectionController} from '../projection.js'
import {utilityInset, utilitySide} from '../stage/utility.js'
import {useWholePixels} from '../stage/whole-pixels.js'
import {useRunningIndicator} from '../use-running.js'

/** The gap between the chip and an overlay above it at the stage's top right, CSS px. */
const gap = 8

/**
 * "Updating…" over the stage's top right while the host extracts or compares again with the last drawing still shown
 * (`ProjectionViewProps.running`), after the shared delay (`runningIndicator`): the page's only cue then, since the stage keeps the drawing until the new one is
 * ready, and a first load says so in the stage itself. It takes the playback bar's and chips' look (`--ph-utility-*`),
 * 12px from the stage's edges, below anything already floating at that corner (the playback bar, or the pane chip
 * swipe and side by side put there).
 */
export function UpdatingChip({
  projection: p,
  running,
  rendererShown = true,
}: {
  projection: ProjectionController
  running: 'extracting' | 'comparing' | null | undefined
  /** Whether the renderer's stage is the view shown (not a built-in table or text view, which keep the last result). */
  rendererShown?: boolean
}) {
  // A renderer pane still loading says what runs in its own status, where it is shown. The indicator's latch lives
  // only while the chip could show, so time hidden behind that status doesn't count toward the time it stays shown.
  if (rendererShown && p.rendererStatus === 'loading') return null
  return <LatchedChip running={running} reducedMotion={p.reducedMotion} />
}

/** The chip once the job has run a moment, then for at least a moment, as every host's running indicator. */
function LatchedChip({running, reducedMotion}: {running: 'extracting' | 'comparing' | null | undefined; reducedMotion: boolean}) {
  return useRunningIndicator(running) ? <Chip reducedMotion={reducedMotion} /> : null
}

function Chip({reducedMotion}: {reducedMotion: boolean}) {
  const chip = useRef<HTMLDivElement>(null)
  useWholePixels(chip, {width: true})
  useLayoutEffect(() => {
    const element = chip.current
    const parent = element?.offsetParent
    if (!element || !parent) return
    const place = () => {
      element.style.top = `${utilityInset}px`
      const own = element.getBoundingClientRect()
      const origin = parent.getBoundingClientRect().top
      let bottom = own.bottom
      const covers = [...parent.querySelectorAll<HTMLElement>('[data-stage-cover]')]
        .map(cover => cover.getBoundingClientRect())
        .filter(cover => cover.width !== 0 && cover.right > own.left && cover.left < own.right)
        .sort((a, b) => a.top - b.top)
      let top = own.top
      for (const cover of covers) {
        if (cover.top < bottom && cover.bottom > top) {
          top = cover.bottom + gap
          bottom = top + own.height
        }
      }
      element.style.top = `${Math.round(top - origin)}px`
    }
    // Placed again as the workspace resizes, and as the overlays come, go or resize (a mode or view switch mid-update).
    const observer = new ResizeObserver(place)
    const observe = () => {
      observer.disconnect()
      observer.observe(parent)
      for (const cover of parent.querySelectorAll('[data-stage-cover]')) observer.observe(cover)
      place()
    }
    observe()
    const changes = new MutationObserver(records => {
      if (records.some(record => !element.contains(record.target))) observe()
    })
    changes.observe(parent, {subtree: true, childList: true})
    return () => {
      observer.disconnect()
      changes.disconnect()
    }
  }, [])
  return (
    <div
      ref={chip}
      role="status"
      aria-live="polite"
      className="ph-updating"
      style={{
        position: 'absolute',
        top: utilityInset,
        right: utilitySide,
        zIndex: 2,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: '0 10px 0 8px',
        whiteSpace: 'nowrap',
        fontSize: 'var(--projections-font-size-xs, 12px)',
        lineHeight: 1,
        pointerEvents: 'none',
        borderRadius: 'var(--ph-pane-chip-radius, var(--ph-utility-radius, var(--projections-radius, 8px)))',
        background: 'var(--ph-pane-chip-bg, var(--ph-utility-bg, var(--projections-color-surface-header, #f6f8fa)))',
        border: 'var(--ph-pane-chip-border, var(--ph-utility-border, 1px solid var(--projections-color-divider, #d1d9e0)))',
        color: 'var(--ph-pane-chip-name, var(--ph-utility-muted, var(--projections-color-fg-muted, #59636e)))',
        backdropFilter: 'var(--ph-utility-backdrop, none)',
        WebkitBackdropFilter: 'var(--ph-utility-backdrop, none)',
      }}
    >
      <LoaderCircle
        aria-hidden="true"
        className={reducedMotion ? undefined : 'pj:animate-spin pj:motion-reduce:animate-none'}
        style={{width: 12, height: 12, flex: 'none'}}
      />
      <span style={{display: 'block', textBox: 'trim-both cap alphabetic'}}>Updating…</span>
    </div>
  )
}

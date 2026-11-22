import {useEffect, useState} from 'react'
import {usePrefersReducedMotion} from '@githubnext/projections-host'
import type {LoadingStatusProps} from '@githubnext/projections-host'

/** How long a load runs before anything shows, so a fast one doesn't flash. */
export const loadingDelay = 300

/** The loads in progress in this document, newest last: one progress bar stands for all of them. */
const loads: {label: string; still: boolean}[] = []
let bar: HTMLElement | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

/** Since the page started, the first load waits only what is left of the delay (the page's own static bar ran before). */
function delayNow(): number {
  return started ? loadingDelay : Math.max(0, loadingDelay - (typeof performance === 'undefined' ? 0 : performance.now()))
}
function wait(): number {
  const delay = delayNow()
  started = true
  return delay
}

/**
 * VS Code's progress bar: 2px at the top of the document, an indeterminate bit moving across it (a still, faint bar
 * under reduced motion). One per document (one tab), however many panes are loading.
 */
function drawBar(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'phv-progress'
  element.setAttribute('role', 'progressbar')
  element.setAttribute('data-loading-indicator', '')
  Object.assign(element.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: '2px',
    overflow: 'hidden',
    zIndex: '1000',
    pointerEvents: 'none',
  })
  const bit = document.createElement('div')
  Object.assign(bit.style, {position: 'absolute', top: '0', bottom: '0', background: 'var(--vscode-progressBar-background, #0e70c0)'})
  element.append(bit)
  return element
}

function update() {
  const current = loads.at(-1)
  if (!current) {
    clearTimeout(timer)
    timer = undefined
    bar?.remove()
    bar = undefined
    return
  }
  if (!bar) {
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        if (!loads.length) return
        bar = drawBar()
        document.body.append(bar)
        update()
      }, wait())
    }
    return
  }
  bar.setAttribute('aria-label', current.label)
  const bit = bar.firstElementChild as HTMLElement
  const still = loads.some(load => load.still)
  if (bit.dataset.still === String(still)) return
  bit.dataset.still = String(still)
  bit.getAnimations?.().forEach(animation => animation.cancel())
  if (still) Object.assign(bit.style, {left: '0', width: '100%', opacity: '0.5'})
  else {
    Object.assign(bit.style, {width: '30%', opacity: '1'})
    bit.animate?.([{left: '-30%'}, {left: '100%'}], {duration: 1500, iterations: Infinity, easing: 'ease-in-out'})
  }
}

/** Whether the loading delay has passed since mount. */
function useDelayed(): boolean {
  const [delay] = useState(delayNow)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(id)
  }, [delay])
  return shown
}

/**
 * The core's `LoadingStatus` as VS Code shows progress: the document's one thin progress bar at the top (as editors
 * and views show it), after a short delay. It never scales with the box it stands in for, and panes loading side by
 * side share the one bar. The box stays filled, so nothing moves when the content arrives; with a `description` (a
 * page's state with something to say or do, such as Cancel), the label, after the 16px spinning `loading` codicon (still
 * under reduced motion) as a projection tab's skeleton shows it, and the description show in it, small and muted.
 */
export function LoadingStatus({label, description, reducedMotion = false, fill = true, className, style}: LoadingStatusProps) {
  const still = usePrefersReducedMotion() || reducedMotion
  const text = typeof label === 'string' ? label : 'Loading…'
  useEffect(() => {
    const load = {label: text, still}
    loads.push(load)
    update()
    return () => {
      loads.splice(loads.indexOf(load), 1)
      update()
    }
  }, [text, still])
  const delayed = useDelayed()
  const shown = delayed && Boolean(description)
  return (
    <div
      className={`ph-loading phv-loading ${className ?? ''}`}
      data-fill={fill || undefined}
      data-motion={still ? 'reduced' : 'full'}
      {...(style ? {style} : {})}
    >
      {shown && (
        <span className="ph-loading-content phv-loading-content" role="status" aria-live="polite">
          <span className="ph-loading-label phv-loading-label">
            <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            {label}
          </span>
          <span className="ph-loading-description">{description}</span>
        </span>
      )}
    </div>
  )
}

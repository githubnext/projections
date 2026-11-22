import {useEffect, useRef, useState} from 'react'
import type {CSSProperties, ReactNode} from 'react'

/** The height a renderer frame starts at before the renderer requests its own (`RendererFrame`). */
export const loadingStageHeight = 480

/** Whether the user asks for reduced motion (`prefers-reduced-motion: reduce`). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/** The props of `LoadingStatus`; `className` and `style` apply to its outer box. */
export interface LoadingStatusProps {
  /** Short visible text in sentence case, for example "Loading the Graph renderer…". */
  label: ReactNode
  /** An optional second line under the label, for example what appears when loading completes. */
  description?: ReactNode
  /**
   * Shows a static indicator instead of the spinner, for example the controller's `reducedMotion`.
   * `prefers-reduced-motion: reduce` always does.
   */
  reducedMotion?: boolean
  /**
   * Fill the box the loading content will occupy (default), so nothing moves when it arrives; the container gives the
   * box its size (a flex column or a definite height). `false` reserves a renderer frame's starting height instead.
   */
  fill?: boolean
  className?: string
  style?: CSSProperties
}

function Spinner() {
  return (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

function Hourglass() {
  return (
    <path
      d="M6 3h12M6 21h12M7.5 3 12 12l-4.5 9M16.5 3 12 12l4.5 9"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

/**
 * A loading state centered in the box it stands in for: a renderer pane, the stage before a comparison is computed,
 * or a page before its engine starts. It fills that box, so the content that replaces it doesn't move anything. An
 * accessible status (`role="status"`, polite) with a short visible label; the spinner is static under reduced motion.
 * Styled inline with the theme tokens (`--projections-*`), so it needs no stylesheet; `--pj-loading-color` and
 * `--pj-loading-font-size` restyle it.
 */
export function LoadingStatus({label, description, reducedMotion = false, fill = true, className, style}: LoadingStatusProps) {
  const prefersReduced = usePrefersReducedMotion()
  const still = reducedMotion || prefersReduced
  const indicator = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const element = indicator.current
    if (still || !element?.animate) return
    const spin = element.animate([{transform: 'rotate(0turn)'}, {transform: 'rotate(1turn)'}], {duration: 900, iterations: Infinity})
    return () => spin.cancel()
  }, [still])
  return (
    <div
      role="status"
      aria-live="polite"
      className={`ph-loading ${className ?? ''}`}
      data-fill={fill || undefined}
      data-motion={still ? 'reduced' : 'full'}
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        margin: 0,
        padding: 16,
        color: 'var(--pj-loading-color, var(--projections-color-fg-muted, currentColor))',
        fontSize: 'var(--pj-loading-font-size, var(--projections-font-size-sm, 0.875rem))',
        lineHeight: 1.5,
        textAlign: 'center',
        ...(fill ? {flex: '1 1 auto', height: '100%', minHeight: 0} : {minHeight: loadingStageHeight}),
        ...style,
      }}
    >
      <span
        className="ph-loading-content"
        style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, maxWidth: '40ch'}}
      >
        <svg
          ref={indicator}
          className="ph-loading-indicator"
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          style={{flex: 'none'}}
        >
          {still ? <Hourglass /> : <Spinner />}
        </svg>
        <span className="ph-loading-label">{label}</span>
        {Boolean(description) && (
          <span className="ph-loading-description" style={{fontSize: '0.875em'}}>
            {description}
          </span>
        )}
      </span>
    </div>
  )
}

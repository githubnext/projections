import {useLayoutEffect, useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {utilitySide} from '../../stage/utility.js'

/** Between the host's content on the stage's edge and the foot floating above it, CSS px. */
const edgeGap = 8

/** How far the foot rises above the stage's bottom edge to clear the edge's inner half: `edgeGap` above it, whole px. */
export const footLift = (edgeHeight: number) => Math.max(utilitySide, Math.ceil(edgeHeight / 2) + edgeGap)

/**
 * The height of `ref`'s element, measured before paint and again whenever it resizes, so what's placed by it never
 * shows first in the wrong place.
 */
function useHeight(ref: {current: HTMLElement | null}): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}

/**
 * The host's own content on the stage's bottom edge (`ProjectionViewProps.edge`): centred on the edge, half over the
 * stage and half below it, so it reads as the page's label for what the stage shows rather than part of the drawing.
 * Its half over the stage covers the frames (`data-stage-cover`); the stage measures only what lies over a frame, so
 * renderers keep clear of that half (`stage-inset-bottom`). `onHeight` hears its height, for the foot to float above.
 * Give the content an even height to keep it on whole pixels.
 */
export function StageEdge({children, onHeight}: {children: ReactNode; onHeight: (height: number) => void}) {
  const content = useRef<HTMLDivElement>(null)
  const height = useHeight(content)
  useLayoutEffect(() => onHeight(height), [height, onHeight])
  return (
    <div
      className="ph-stage-edge"
      style={{
        position: 'absolute',
        insetInline: utilitySide,
        bottom: 0,
        height: 0,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div ref={content} className="ph-stage-edge-content" data-stage-cover="" style={{maxWidth: '100%', pointerEvents: 'auto'}}>
        {children}
      </div>
    </div>
  )
}

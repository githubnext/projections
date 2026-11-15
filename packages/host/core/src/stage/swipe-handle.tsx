import type {PointerEvent, ReactNode, RefObject} from 'react'
import {accent} from './layout.js'

/** The swipe divider's line and thumb outline: one color, the accent unless a host sets `--ph-swipe-edge`. */
const swipeEdge = `var(--ph-swipe-edge, ${accent})`

export interface SwipeHandleProps {
  /** The stage body the divider spans. */
  container: RefObject<HTMLElement | null>
  /** The divider's position across the stage, 0 to 1. */
  position: number
  onChange: (position: number) => void
  beforeLabel: ReactNode
  focused: boolean
  onFocusedChange: (focused: boolean) => void
  dragging: boolean
  onDraggingChange: (dragging: boolean) => void
}

/** Where a key moves the swipe divider: arrows step it, Shift steps further, Home and End go to the ends. */
function keyedPosition(key: string, shift: boolean, position: number): number | undefined {
  const step = shift ? 0.1 : 0.01
  return key === 'ArrowLeft' || key === 'ArrowDown'
    ? position - step
    : key === 'ArrowRight' || key === 'ArrowUp'
      ? position + step
      : key === 'Home'
        ? 0
        : key === 'End'
          ? 1
          : undefined
}

/** Swipe's divider: a slider whose line and thumb follow the pointer and the keyboard. */
export function SwipeHandle({
  container,
  position,
  onChange: set,
  beforeLabel,
  focused,
  onFocusedChange: setFocused,
  dragging,
  onDraggingChange: setDragging,
}: SwipeHandleProps) {
  const percent = `${Math.round(position * 1000) / 10}%`
  function fromPointer(event: PointerEvent<HTMLElement>) {
    const bounds = container.current?.getBoundingClientRect()
    if (bounds?.width) set((event.clientX - bounds.left) / bounds.width)
  }
  return (
    <div
      className="ph-swipe-handle"
      role="slider"
      tabIndex={0}
      aria-label="Comparison divider"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      aria-valuetext={`${Math.round(position * 100)}% ${typeof beforeLabel === 'string' ? beforeLabel : 'before revision'} visible`}
      // The line and the thumb are one control: both take `--ph-swipe-edge` (the accent unless a host restyles it), the
      // thumb is filled with `--ph-swipe-fill`, and `data-dragging` and `data-focus-visible` let a host change both.
      data-dragging={dragging || undefined}
      data-focus-visible={focused || undefined}
      style={{position: 'absolute', zIndex: 2, inset: 0, pointerEvents: 'none', outline: 'none'}}
      onFocus={event => setFocused(event.currentTarget.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        fromPointer(event)
      }}
      onLostPointerCapture={() => setDragging(false)}
      onPointerMove={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event)
      }}
      onKeyDown={event => {
        const next = keyedPosition(event.key, event.shiftKey, position)
        if (next === undefined) return
        event.preventDefault()
        setFocused(true)
        set(Math.round(next * 100) / 100)
      }}
    >
      <span
        className="ph-swipe-line"
        aria-hidden="true"
        style={{position: 'absolute', top: 0, bottom: 0, left: percent, width: 1, transform: 'translateX(-50%)', background: swipeEdge}}
      />
      <span
        className="ph-swipe-grab"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `clamp(22px, ${percent}, calc(100% - 22px))`,
          width: 44,
          transform: 'translateX(-50%)',
          cursor: 'ew-resize',
          touchAction: 'none',
          pointerEvents: 'auto',
        }}
      />
      <span
        className="ph-swipe-thumb"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 'min(50%, 200px)',
          left: percent,
          display: 'grid',
          placeItems: 'center',
          width: 38,
          height: 38,
          transform: 'translate(-50%, -50%)',
          border: `1px solid ${swipeEdge}`,
          borderRadius: '50%',
          background: 'var(--ph-swipe-fill, var(--projections-color-bg, #ffffff))',
          color: swipeEdge,
          fontWeight: 700,
          pointerEvents: 'none',
          ...(focused ? {outline: `2px solid var(--projections-color-focus, #0969da)`, outlineOffset: 3} : {}),
        }}
      >
        ‹ ›
      </span>
    </div>
  )
}

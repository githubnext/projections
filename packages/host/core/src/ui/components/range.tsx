import type {ComponentProps, CSSProperties} from 'react'
import {cn} from '../lib/utils.js'

/** The props of `Range`: a native `input`'s, without `type`. */
export type RangeProps = Omit<ComponentProps<'input'>, 'type'>

/**
 * A native `input[type=range]` styled like shadcn/ui's Slider (track, filled range, thumb; see `.pj-range` in
 * theme.css). Native, so it keeps keyboard, form and `fill()` behavior; use `Slider` for multi-thumb ranges.
 */
export function Range({className, style, ref, ...props}: RangeProps) {
  const min = Number(props.min ?? 0)
  const max = Number(props.max ?? 100)
  const value = Number(props.value ?? props.defaultValue ?? min)
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  return (
    <input
      ref={ref}
      type="range"
      className={cn('pj-range', className)}
      style={{'--pj-range-fill': `${fill}%`, ...style} as CSSProperties}
      {...props}
    />
  )
}

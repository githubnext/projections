'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'
import * as SliderPrimitive from '@radix-ui/react-slider'

function Slider({className, defaultValue, value, min = 0, max = 100, ...props}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        'pj:relative pj:flex pj:w-full pj:touch-none pj:items-center pj:select-none pj:data-disabled:opacity-50 pj:data-vertical:h-full pj:data-vertical:min-h-40 pj:data-vertical:w-auto pj:data-vertical:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="pj:relative pj:grow pj:overflow-hidden pj:rounded-full pj:bg-muted pj:data-horizontal:h-1.5 pj:data-horizontal:w-full pj:data-vertical:h-full pj:data-vertical:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="pj:absolute pj:bg-primary pj:select-none pj:data-horizontal:h-full pj:data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({length: _values.length}, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="pj:block pj:size-4 pj:shrink-0 pj:rounded-full pj:border pj:border-primary pj:bg-white pj:shadow-sm pj:ring-ring/50 pj:transition-[color,box-shadow] pj:select-none pj:hover:ring-4 pj:focus-visible:ring-4 pj:focus-visible:outline-hidden pj:disabled:pointer-events-none pj:disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export {Slider}

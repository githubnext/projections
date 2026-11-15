'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

function ScrollArea({className, children, ...props}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('pj:relative', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="pj:size-full pj:rounded-[inherit] pj:transition-[color,box-shadow] pj:outline-none pj:focus-visible:ring-[3px] pj:focus-visible:ring-ring/50 pj:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({className, orientation = 'vertical', ...props}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'pj:flex pj:touch-none pj:p-px pj:transition-colors pj:select-none pj:data-horizontal:h-2.5 pj:data-horizontal:flex-col pj:data-horizontal:border-t pj:data-horizontal:border-t-transparent pj:data-vertical:h-full pj:data-vertical:w-2.5 pj:data-vertical:border-l pj:data-vertical:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="pj:relative pj:flex-1 pj:rounded-full pj:bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export {ScrollArea, ScrollBar}

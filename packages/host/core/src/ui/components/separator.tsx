'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'
import * as SeparatorPrimitive from '@radix-ui/react-separator'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'pj:shrink-0 pj:bg-border pj:data-horizontal:h-px pj:data-horizontal:w-full pj:data-vertical:w-px pj:data-vertical:self-stretch',
        className,
      )}
      {...props}
    />
  )
}

export {Separator}

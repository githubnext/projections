'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'
import * as TogglePrimitive from '@radix-ui/react-toggle'

const toggleVariants = cva(
  "pj:group/toggle pj:inline-flex pj:items-center pj:justify-center pj:gap-1 pj:rounded-md pj:text-sm pj:font-medium pj:whitespace-nowrap pj:transition-[color,box-shadow] pj:outline-none pj:hover:bg-muted pj:hover:text-foreground pj:focus-visible:border-ring pj:focus-visible:ring-[3px] pj:focus-visible:ring-ring/50 pj:disabled:pointer-events-none pj:disabled:opacity-50 pj:aria-invalid:border-destructive pj:aria-invalid:ring-destructive/20 pj:aria-pressed:bg-muted pj:dark:aria-invalid:ring-destructive/40 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'pj:bg-transparent',
        outline: 'pj:border pj:border-input pj:bg-transparent pj:shadow-xs pj:hover:bg-muted',
      },
      size: {
        default: 'pj:h-9 pj:min-w-9 pj:px-2.5 pj:has-data-[icon=inline-end]:pr-2 pj:has-data-[icon=inline-start]:pl-2',
        sm: 'pj:h-8 pj:min-w-8 pj:px-2.5 pj:has-data-[icon=inline-end]:pr-1.5 pj:has-data-[icon=inline-start]:pl-1.5',
        lg: 'pj:h-10 pj:min-w-10 pj:px-2.5 pj:has-data-[icon=inline-end]:pr-2 pj:has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({variant, size, className}))} {...props} />
}

export {Toggle, toggleVariants}

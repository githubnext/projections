// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react; no `active:translate-y-px` on the button (the press moves its content, see `../theme.css`).

import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'
import * as Slot from '@radix-ui/react-slot'

const buttonVariants = cva(
  "pj:group/button pj:inline-flex pj:shrink-0 pj:items-center pj:justify-center pj:rounded-md pj:border pj:border-transparent pj:bg-clip-padding pj:text-sm pj:font-medium pj:whitespace-nowrap pj:transition-all pj:outline-none pj:select-none pj:focus-visible:border-ring pj:focus-visible:ring-3 pj:focus-visible:ring-ring/50 pj:disabled:pointer-events-none pj:disabled:opacity-50 pj:aria-invalid:border-destructive pj:aria-invalid:ring-3 pj:aria-invalid:ring-destructive/20 pj:dark:aria-invalid:border-destructive/50 pj:dark:aria-invalid:ring-destructive/40 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'pj:bg-primary pj:text-primary-foreground pj:hover:bg-primary/80',
        outline:
          'pj:border-border pj:bg-background pj:shadow-xs pj:hover:bg-muted pj:hover:text-foreground pj:aria-expanded:bg-muted pj:aria-expanded:text-foreground pj:dark:border-input pj:dark:bg-input/30 pj:dark:hover:bg-input/50',
        secondary:
          'pj:bg-secondary pj:text-secondary-foreground pj:hover:bg-[color-mix(in_oklch,var(--pj-secondary),var(--pj-foreground)_5%)] pj:aria-expanded:bg-secondary pj:aria-expanded:text-secondary-foreground',
        ghost:
          'pj:hover:bg-muted pj:hover:text-foreground pj:aria-expanded:bg-muted pj:aria-expanded:text-foreground pj:dark:hover:bg-muted/50',
        destructive:
          'pj:bg-destructive/10 pj:text-destructive pj:hover:bg-destructive/20 pj:focus-visible:border-destructive/40 pj:focus-visible:ring-destructive/20 pj:dark:bg-destructive/20 pj:dark:hover:bg-destructive/30 pj:dark:focus-visible:ring-destructive/40',
        link: 'pj:text-primary pj:underline-offset-4 pj:hover:underline',
      },
      size: {
        default:
          'pj:h-9 pj:gap-1.5 pj:px-2.5 pj:in-data-[slot=button-group]:rounded-md pj:has-data-[icon=inline-end]:pr-2 pj:has-data-[icon=inline-start]:pl-2',
        xs: "pj:h-6 pj:gap-1 pj:rounded-[min(var(--pj-radius-md),8px)] pj:px-2 pj:text-xs pj:in-data-[slot=button-group]:rounded-md pj:has-data-[icon=inline-end]:pr-1.5 pj:has-data-[icon=inline-start]:pl-1.5 pj:[&_svg:not([class*='size-'])]:size-3",
        sm: 'pj:h-8 pj:gap-1 pj:rounded-[min(var(--pj-radius-md),10px)] pj:px-2.5 pj:in-data-[slot=button-group]:rounded-md pj:has-data-[icon=inline-end]:pr-1.5 pj:has-data-[icon=inline-start]:pl-1.5',
        lg: 'pj:h-10 pj:gap-1.5 pj:px-2.5 pj:has-data-[icon=inline-end]:pr-2 pj:has-data-[icon=inline-start]:pl-2',
        icon: 'pj:size-9',
        'icon-xs':
          "pj:size-6 pj:rounded-[min(var(--pj-radius-md),8px)] pj:in-data-[slot=button-group]:rounded-md pj:[&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'pj:size-8 pj:rounded-[min(var(--pj-radius-md),10px)] pj:in-data-[slot=button-group]:rounded-md',
        'icon-lg': 'pj:size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({variant, size, className}))}
      {...props}
    />
  )
}

export {Button, buttonVariants}

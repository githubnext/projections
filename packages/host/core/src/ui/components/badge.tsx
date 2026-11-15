// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'
import * as Slot from '@radix-ui/react-slot'

const badgeVariants = cva(
  'pj:group/badge pj:inline-flex pj:h-5 pj:w-fit pj:shrink-0 pj:items-center pj:justify-center pj:gap-1 pj:overflow-hidden pj:rounded-4xl pj:border pj:border-transparent pj:px-2 pj:py-0.5 pj:text-xs pj:font-medium pj:whitespace-nowrap pj:transition-all pj:focus-visible:border-ring pj:focus-visible:ring-[3px] pj:focus-visible:ring-ring/50 pj:has-data-[icon=inline-end]:pr-1.5 pj:has-data-[icon=inline-start]:pl-1.5 pj:aria-invalid:border-destructive pj:aria-invalid:ring-destructive/20 pj:dark:aria-invalid:ring-destructive/40 pj:[&>svg]:pointer-events-none pj:[&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'pj:bg-primary pj:text-primary-foreground pj:[a]:hover:bg-primary/80',
        secondary: 'pj:bg-secondary pj:text-secondary-foreground pj:[a]:hover:bg-secondary/80',
        destructive:
          'pj:bg-destructive/10 pj:text-destructive pj:focus-visible:ring-destructive/20 pj:dark:bg-destructive/20 pj:dark:focus-visible:ring-destructive/40 pj:[a]:hover:bg-destructive/20',
        outline: 'pj:border-border pj:text-foreground pj:[a]:hover:bg-muted pj:[a]:hover:text-muted-foreground',
        ghost: 'pj:hover:bg-muted pj:hover:text-muted-foreground pj:dark:hover:bg-muted/50',
        link: 'pj:text-primary pj:underline-offset-4 pj:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & {asChild?: boolean}) {
  const Comp = asChild ? Slot.Root : 'span'

  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({variant}), className)} {...props} />
}

export {Badge, badgeVariants}

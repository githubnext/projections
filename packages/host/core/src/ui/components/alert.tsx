// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'

const alertVariants = cva(
  "pj:group/alert pj:relative pj:grid pj:w-full pj:gap-0.5 pj:rounded-lg pj:border pj:px-4 pj:py-3 pj:text-left pj:text-sm pj:has-data-[slot=alert-action]:relative pj:has-data-[slot=alert-action]:pr-18 pj:has-[>svg]:grid-cols-[auto_1fr] pj:has-[>svg]:gap-x-2.5 pj:*:[svg]:row-span-2 pj:*:[svg]:translate-y-0.5 pj:*:[svg]:text-current pj:*:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'pj:bg-card pj:text-card-foreground',
        destructive: 'pj:bg-card pj:text-destructive pj:*:data-[slot=alert-description]:text-destructive/90 pj:*:[svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({className, variant, ...props}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({variant}), className)} {...props} />
}

function AlertTitle({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'pj:font-medium pj:group-has-[>svg]/alert:col-start-2 pj:[&_a]:underline pj:[&_a]:underline-offset-3 pj:[&_a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function AlertDescription({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'pj:text-sm pj:text-balance pj:text-muted-foreground pj:md:text-pretty pj:[&_a]:underline pj:[&_a]:underline-offset-3 pj:[&_a]:hover:text-foreground pj:[&_p:not(:last-child)]:mb-4',
        className,
      )}
      {...props}
    />
  )
}

function AlertAction({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="alert-action" className={cn('pj:absolute pj:top-2.5 pj:right-3', className)} {...props} />
}

export {Alert, AlertTitle, AlertDescription, AlertAction}

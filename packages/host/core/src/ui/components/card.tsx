// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'

function Card({className, size = 'default', ...props}: React.ComponentProps<'div'> & {size?: 'default' | 'sm'}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        'pj:group/card pj:flex pj:flex-col pj:gap-(--pj-card-spacing) pj:overflow-hidden pj:rounded-xl pj:bg-card pj:py-(--pj-card-spacing) pj:text-sm pj:text-card-foreground pj:shadow-xs pj:ring-1 pj:ring-foreground/10 pj:[--pj-card-spacing:--spacing(6)] pj:has-[>img:first-child]:pt-0 pj:data-[size=sm]:[--pj-card-spacing:--spacing(4)] pj:*:[img:first-child]:rounded-t-xl pj:*:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'pj:group/card-header pj:@container/card-header pj:grid pj:auto-rows-min pj:items-start pj:gap-1 pj:rounded-t-xl pj:px-(--pj-card-spacing) pj:has-data-[slot=card-action]:grid-cols-[1fr_auto] pj:has-data-[slot=card-description]:grid-rows-[auto_auto] pj:[.border-b]:pb-(--pj-card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('cn-font-heading pj:text-base pj:leading-normal pj:font-medium pj:group-data-[size=sm]/card:text-sm', className)}
      {...props}
    />
  )
}

function CardDescription({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('pj:text-sm pj:text-muted-foreground', className)} {...props} />
}

function CardAction({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('pj:col-start-2 pj:row-span-2 pj:row-start-1 pj:self-start pj:justify-self-end', className)}
      {...props}
    />
  )
}

function CardContent({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('pj:flex pj:flex-col pj:gap-3 pj:px-(--pj-card-spacing)', className)} {...props} />
}

function CardFooter({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('pj:flex pj:items-center pj:rounded-b-xl pj:px-(--pj-card-spacing) pj:[.border-t]:pt-(--pj-card-spacing)', className)}
      {...props}
    />
  )
}

export {Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent}

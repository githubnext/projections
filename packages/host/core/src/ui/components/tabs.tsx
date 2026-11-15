'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'
import * as TabsPrimitive from '@radix-ui/react-tabs'

function Tabs({className, orientation = 'horizontal', ...props}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('pj:group/tabs pj:flex pj:gap-2 pj:data-horizontal:flex-col', className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'pj:group/tabs-list pj:inline-flex pj:w-fit pj:items-center pj:justify-center pj:rounded-lg pj:p-[3px] pj:text-muted-foreground pj:group-data-horizontal/tabs:h-9 pj:group-data-vertical/tabs:h-fit pj:group-data-vertical/tabs:flex-col pj:data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'pj:bg-muted',
        line: 'pj:gap-1 pj:bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(tabsListVariants({variant}), className)} {...props} />
  )
}

function TabsTrigger({className, ...props}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "pj:relative pj:inline-flex pj:h-[calc(100%-1px)] pj:flex-1 pj:items-center pj:justify-center pj:gap-1.5 pj:rounded-md pj:border pj:border-transparent pj:px-2 pj:py-1 pj:text-sm pj:font-medium pj:whitespace-nowrap pj:text-foreground/60 pj:transition-all pj:group-data-vertical/tabs:w-full pj:group-data-vertical/tabs:justify-start pj:hover:text-foreground pj:focus-visible:border-ring pj:focus-visible:ring-[3px] pj:focus-visible:ring-ring/50 pj:focus-visible:outline-1 pj:focus-visible:outline-ring pj:disabled:pointer-events-none pj:disabled:opacity-50 pj:has-data-[icon=inline-end]:pr-1.5 pj:has-data-[icon=inline-start]:pl-1.5 pj:dark:text-muted-foreground pj:dark:hover:text-foreground pj:group-data-[variant=default]/tabs-list:data-active:shadow-sm pj:group-data-[variant=line]/tabs-list:data-active:shadow-none pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
        'pj:group-data-[variant=line]/tabs-list:bg-transparent pj:group-data-[variant=line]/tabs-list:data-active:bg-transparent pj:dark:group-data-[variant=line]/tabs-list:data-active:border-transparent pj:dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
        'pj:data-active:bg-background pj:data-active:text-foreground pj:dark:data-active:border-input pj:dark:data-active:bg-input/30 pj:dark:data-active:text-foreground',
        'pj:after:absolute pj:after:bg-foreground pj:after:opacity-0 pj:after:transition-opacity pj:group-data-horizontal/tabs:after:inset-x-0 pj:group-data-horizontal/tabs:after:bottom-[-5px] pj:group-data-horizontal/tabs:after:h-0.5 pj:group-data-vertical/tabs:after:inset-y-0 pj:group-data-vertical/tabs:after:-right-1 pj:group-data-vertical/tabs:after:w-0.5 pj:group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({className, ...props}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('pj:flex-1 pj:text-sm pj:outline-none', className)} {...props} />
}

export {Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants}

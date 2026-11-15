'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react; portals render into the scoped root (`usePortalContainer`).

import * as React from 'react'
import {cn} from '../lib/utils.js'
import {usePortalContainer} from '../lib/portal.js'
import * as PopoverPrimitive from '@radix-ui/react-popover'

function Popover({...props}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({...props}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({className, align = 'center', sideOffset = 4, ...props}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  // local: portal into ScopedRoot so the content keeps the scoped styles
  return (
    <PopoverPrimitive.Portal container={usePortalContainer()}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'pj:z-50 pj:flex pj:w-72 pj:origin-(--radix-popover-content-transform-origin) pj:flex-col pj:gap-4 pj:rounded-md pj:bg-popover pj:p-4 pj:text-sm pj:text-popover-foreground pj:shadow-md pj:ring-1 pj:ring-foreground/10 pj:outline-hidden pj:duration-100 pj:data-[side=bottom]:slide-in-from-top-2 pj:data-[side=left]:slide-in-from-right-2 pj:data-[side=right]:slide-in-from-left-2 pj:data-[side=top]:slide-in-from-bottom-2 pj:data-open:animate-in pj:data-open:fade-in-0 pj:data-open:zoom-in-95 pj:data-closed:animate-out pj:data-closed:fade-out-0 pj:data-closed:zoom-out-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({...props}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="popover-header" className={cn('pj:flex pj:flex-col pj:gap-1 pj:text-sm', className)} {...props} />
}

function PopoverTitle({className, ...props}: React.ComponentProps<'h2'>) {
  return <div data-slot="popover-title" className={cn('pj:font-medium', className)} {...props} />
}

function PopoverDescription({className, ...props}: React.ComponentProps<'p'>) {
  return <p data-slot="popover-description" className={cn('pj:text-muted-foreground', className)} {...props} />
}

export {Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger}

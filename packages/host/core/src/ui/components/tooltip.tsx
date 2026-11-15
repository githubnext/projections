'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react; portals render into the scoped root (`usePortalContainer`).

import * as React from 'react'
import {cn} from '../lib/utils.js'
import {usePortalContainer} from '../lib/portal.js'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

function TooltipProvider({delayDuration = 0, ...props}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({...props}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({...props}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({className, sideOffset = 0, children, ...props}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  // local: portal into ScopedRoot so the content keeps the scoped styles
  return (
    <TooltipPrimitive.Portal container={usePortalContainer()}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'pj:z-50 pj:inline-flex pj:w-fit pj:max-w-xs pj:origin-(--radix-tooltip-content-transform-origin) pj:items-center pj:gap-1.5 pj:rounded-md pj:bg-foreground pj:px-3 pj:py-1.5 pj:text-xs pj:text-background pj:has-data-[slot=kbd]:pr-1.5 pj:data-[side=bottom]:slide-in-from-top-2 pj:data-[side=left]:slide-in-from-right-2 pj:data-[side=right]:slide-in-from-left-2 pj:data-[side=top]:slide-in-from-bottom-2 pj:**:data-[slot=kbd]:relative pj:**:data-[slot=kbd]:isolate pj:**:data-[slot=kbd]:z-50 pj:**:data-[slot=kbd]:rounded-sm pj:data-[state=delayed-open]:animate-in pj:data-[state=delayed-open]:fade-in-0 pj:data-[state=delayed-open]:zoom-in-95 pj:data-open:animate-in pj:data-open:fade-in-0 pj:data-open:zoom-in-95 pj:data-closed:animate-out pj:data-closed:fade-out-0 pj:data-closed:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="pj:z-50 pj:size-2.5 pj:translate-y-[calc(-50%_-_2px)] pj:rotate-45 pj:rounded-[2px] pj:bg-foreground pj:fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger}

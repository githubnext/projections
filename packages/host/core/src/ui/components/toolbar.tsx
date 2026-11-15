'use client'

// Our own: shadcn/ui has no Toolbar, so this styles the Radix Toolbar primitive (@radix-ui/react-toolbar) with the
// `pj:` classes and `--pj-` tokens the shadcn components use. Radix gives it `role="toolbar"`, one Tab stop and
// roving focus: arrow keys move between items, Home and End jump to the ends.

import * as React from 'react'
import * as ToolbarPrimitive from '@radix-ui/react-toolbar'
import {cn} from '../lib/utils.js'

/** A fixed-height bar of controls, vertically centered with an even inset. Name it with `aria-label`. */
function Toolbar({className, ...props}: React.ComponentProps<typeof ToolbarPrimitive.Root>) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      className={cn('pj:flex pj:h-10 pj:min-w-0 pj:items-center pj:gap-1 pj:px-1.5 pj:py-1 pj:text-sm', className)}
      {...props}
    />
  )
}

/**
 * A toolbar item that joins the roving focus; use `asChild` to make a `Button`, `SelectTrigger` or input one. As a
 * child it adds no `data-slot`, so the child keeps its own (the theme and `ButtonGroup` style by it).
 */
function ToolbarButton({className, asChild, ...props}: React.ComponentProps<typeof ToolbarPrimitive.Button>) {
  return (
    <ToolbarPrimitive.Button {...(asChild ? {asChild} : {'data-slot': 'toolbar-button'})} {...(className ? {className} : {})} {...props} />
  )
}

/** A link that joins the toolbar's roving focus, underlined on hover. */
function ToolbarLink({className, ...props}: React.ComponentProps<typeof ToolbarPrimitive.Link>) {
  return (
    <ToolbarPrimitive.Link
      data-slot="toolbar-link"
      className={cn('pj:rounded-sm pj:underline-offset-4 pj:hover:underline pj:focus-visible:outline-hidden', className)}
      {...props}
    />
  )
}

/** A thin vertical rule between groups of items. */
function ToolbarSeparator({className, ...props}: React.ComponentProps<typeof ToolbarPrimitive.Separator>) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn('pj:mx-0.5 pj:h-5 pj:w-px pj:shrink-0 pj:bg-border', className)}
      {...props}
    />
  )
}

/**
 * A group of `ToolbarToggleItem`s in the toolbar's roving focus: `type="single"` for one choice (which can be
 * cleared), `type="multiple"` for independent toggles.
 */
function ToolbarToggleGroup({className, ...props}: React.ComponentProps<typeof ToolbarPrimitive.ToggleGroup>) {
  return (
    <ToolbarPrimitive.ToggleGroup
      data-slot="toolbar-toggle-group"
      className={cn('pj:flex pj:items-center pj:gap-0.5', className)}
      {...props}
    />
  )
}

/** One item of a `ToolbarToggleGroup`, by `value`: an icon-sized button, accent-filled while on. */
function ToolbarToggleItem({className, ...props}: React.ComponentProps<typeof ToolbarPrimitive.ToggleItem>) {
  return (
    <ToolbarPrimitive.ToggleItem
      data-slot="toolbar-toggle-item"
      className={cn(
        'pj:inline-flex pj:h-8 pj:min-w-8 pj:items-center pj:justify-center pj:rounded-md pj:px-2 pj:text-muted-foreground pj:transition-colors pj:hover:bg-accent pj:hover:text-foreground pj:focus-visible:outline-hidden pj:focus-visible:ring-3 pj:focus-visible:ring-ring/50 pj:data-[state=on]:bg-accent pj:data-[state=on]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {Toolbar, ToolbarButton, ToolbarLink, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem}

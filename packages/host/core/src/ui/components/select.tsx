'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react; portals render into the scoped root (`usePortalContainer`).

import * as React from 'react'
import {CheckIcon, ChevronDownIcon, ChevronUpIcon} from 'lucide-react'
import {cn} from '../lib/utils.js'
import {usePortalContainer} from '../lib/portal.js'
import * as SelectPrimitive from '@radix-ui/react-select'

function Select({...props}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({className, ...props}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" className={cn('pj:scroll-my-1 pj:p-1', className)} {...props} />
}

function SelectValue({...props}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "pj:flex pj:w-fit pj:items-center pj:justify-between pj:gap-1.5 pj:rounded-md pj:border pj:border-input pj:bg-transparent pj:py-2 pj:pr-2 pj:pl-2.5 pj:text-sm pj:whitespace-nowrap pj:shadow-xs pj:transition-[color,box-shadow] pj:outline-none pj:focus-visible:border-ring pj:focus-visible:ring-3 pj:focus-visible:ring-ring/50 pj:disabled:cursor-not-allowed pj:disabled:opacity-50 pj:aria-invalid:border-destructive pj:aria-invalid:ring-3 pj:aria-invalid:ring-destructive/20 pj:data-placeholder:text-muted-foreground pj:data-[size=default]:h-9 pj:data-[size=sm]:h-8 pj:*:data-[slot=select-value]:line-clamp-1 pj:*:data-[slot=select-value]:flex pj:*:data-[slot=select-value]:items-center pj:*:data-[slot=select-value]:gap-1.5 pj:dark:bg-input/30 pj:dark:hover:bg-input/50 pj:dark:aria-invalid:border-destructive/50 pj:dark:aria-invalid:ring-destructive/40 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pj:pointer-events-none pj:size-4 pj:text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'item-aligned',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  // local: portal into ScopedRoot so the content keeps the scoped styles
  return (
    <SelectPrimitive.Portal container={usePortalContainer()}>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === 'item-aligned'}
        className={cn(
          'cn-menu-target cn-menu-translucent pj:relative pj:z-50 pj:max-h-(--radix-select-content-available-height) pj:min-w-36 pj:origin-(--radix-select-content-transform-origin) pj:overflow-x-hidden pj:overflow-y-auto pj:rounded-md pj:bg-popover pj:text-popover-foreground pj:shadow-md pj:ring-1 pj:ring-foreground/10 pj:duration-100 pj:data-[align-trigger=true]:animate-none pj:data-[side=bottom]:slide-in-from-top-2 pj:data-[side=left]:slide-in-from-right-2 pj:data-[side=right]:slide-in-from-left-2 pj:data-[side=top]:slide-in-from-bottom-2 pj:data-open:animate-in pj:data-open:fade-in-0 pj:data-open:zoom-in-95 pj:data-closed:animate-out pj:data-closed:fade-out-0 pj:data-closed:zoom-out-95',
          position === 'popper' &&
            'pj:data-[side=bottom]:translate-y-1 pj:data-[side=left]:-translate-x-1 pj:data-[side=right]:translate-x-1 pj:data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            'pj:data-[position=popper]:h-(--radix-select-trigger-height) pj:data-[position=popper]:w-full pj:data-[position=popper]:min-w-(--radix-select-trigger-width)',
            position === 'popper' && '',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({className, ...props}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('pj:px-2 pj:py-1.5 pj:text-xs pj:text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({className, children, ...props}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "pj:relative pj:flex pj:w-full pj:cursor-default pj:items-center pj:gap-2 pj:rounded-sm pj:py-1.5 pj:pr-8 pj:pl-2 pj:text-sm pj:outline-hidden pj:select-none pj:focus:bg-accent pj:focus:text-accent-foreground pj:not-data-[variant=destructive]:focus:**:text-accent-foreground pj:data-disabled:pointer-events-none pj:data-disabled:opacity-50 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4 pj:*:[span]:last:flex pj:*:[span]:last:items-center pj:*:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pj:pointer-events-none pj:absolute pj:right-2 pj:flex pj:size-4 pj:items-center pj:justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pj:pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({className, ...props}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pj:pointer-events-none pj:-mx-1 pj:my-1 pj:h-px pj:bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({className, ...props}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "pj:z-10 pj:flex pj:cursor-default pj:items-center pj:justify-center pj:bg-popover pj:py-1 pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({className, ...props}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "pj:z-10 pj:flex pj:cursor-default pj:items-center pj:justify-center pj:bg-popover pj:py-1 pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

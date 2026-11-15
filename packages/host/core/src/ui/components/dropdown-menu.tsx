'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react; portals render into the scoped root (`usePortalContainer`).

import * as React from 'react'
import {CheckIcon, ChevronRightIcon} from 'lucide-react'
import {cn} from '../lib/utils.js'
import {usePortalContainer} from '../lib/portal.js'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'

function DropdownMenu({...props}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({...props}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  // local: portal into ScopedRoot so the content keeps the scoped styles
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" container={usePortalContainer()} {...props} />
}

function DropdownMenuTrigger({...props}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  // local: portal into ScopedRoot so the content keeps the scoped styles
  return (
    <DropdownMenuPrimitive.Portal container={usePortalContainer()}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'cn-menu-target cn-menu-translucent pj:z-50 pj:max-h-(--radix-dropdown-menu-content-available-height) pj:w-(--radix-dropdown-menu-trigger-width) pj:min-w-32 pj:origin-(--radix-dropdown-menu-content-transform-origin) pj:overflow-x-hidden pj:overflow-y-auto pj:rounded-md pj:bg-popover pj:p-1 pj:text-popover-foreground pj:shadow-md pj:ring-1 pj:ring-foreground/10 pj:duration-100 pj:data-[side=bottom]:slide-in-from-top-2 pj:data-[side=left]:slide-in-from-right-2 pj:data-[side=right]:slide-in-from-left-2 pj:data-[side=top]:slide-in-from-bottom-2 pj:data-[state=closed]:overflow-hidden pj:data-open:animate-in pj:data-open:fade-in-0 pj:data-open:zoom-in-95 pj:data-closed:animate-out pj:data-closed:fade-out-0 pj:data-closed:zoom-out-95',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({...props}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "pj:group/dropdown-menu-item pj:relative pj:flex pj:cursor-default pj:items-center pj:gap-2 pj:rounded-sm pj:px-2 pj:py-1.5 pj:text-sm pj:outline-hidden pj:select-none pj:focus:bg-accent pj:focus:text-accent-foreground pj:not-data-[variant=destructive]:focus:**:text-accent-foreground pj:data-inset:pl-8 pj:data-[variant=destructive]:text-destructive pj:data-[variant=destructive]:focus:bg-destructive/10 pj:data-[variant=destructive]:focus:text-destructive pj:dark:data-[variant=destructive]:focus:bg-destructive/20 pj:data-disabled:pointer-events-none pj:data-disabled:opacity-50 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4 pj:data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "pj:relative pj:flex pj:cursor-default pj:items-center pj:gap-2 pj:rounded-sm pj:py-1.5 pj:pr-8 pj:pl-2 pj:text-sm pj:outline-hidden pj:select-none pj:focus:bg-accent pj:focus:text-accent-foreground pj:focus:**:text-accent-foreground pj:data-inset:pl-8 pj:data-disabled:pointer-events-none pj:data-disabled:opacity-50 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pj:pointer-events-none pj:absolute pj:right-2 pj:flex pj:items-center pj:justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({...props}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "pj:relative pj:flex pj:cursor-default pj:items-center pj:gap-2 pj:rounded-sm pj:py-1.5 pj:pr-8 pj:pl-2 pj:text-sm pj:outline-hidden pj:select-none pj:focus:bg-accent pj:focus:text-accent-foreground pj:focus:**:text-accent-foreground pj:data-inset:pl-8 pj:data-disabled:pointer-events-none pj:data-disabled:opacity-50 pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span
        className="pj:pointer-events-none pj:absolute pj:right-2 pj:flex pj:items-center pj:justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('pj:px-2 pj:py-1.5 pj:text-xs pj:font-medium pj:text-muted-foreground pj:data-inset:pl-8', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({className, ...props}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('pj:-mx-1 pj:my-1 pj:h-px pj:bg-border', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({className, ...props}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'pj:ml-auto pj:text-xs pj:tracking-widest pj:text-muted-foreground pj:group-focus/dropdown-menu-item:text-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({...props}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "pj:flex pj:cursor-default pj:items-center pj:gap-2 pj:rounded-sm pj:px-2 pj:py-1.5 pj:text-sm pj:outline-hidden pj:select-none pj:focus:bg-accent pj:focus:text-accent-foreground pj:not-data-[variant=destructive]:focus:**:text-accent-foreground pj:data-inset:pl-8 pj:data-open:bg-accent pj:data-open:text-accent-foreground pj:[&_svg]:pointer-events-none pj:[&_svg]:shrink-0 pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="cn-rtl-flip pj:ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({className, ...props}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        'cn-menu-target cn-menu-translucent pj:z-50 pj:min-w-[96px] pj:origin-(--radix-dropdown-menu-content-transform-origin) pj:overflow-hidden pj:rounded-md pj:bg-popover pj:p-1 pj:text-popover-foreground pj:shadow-lg pj:ring-1 pj:ring-foreground/10 pj:duration-100 pj:data-[side=bottom]:slide-in-from-top-2 pj:data-[side=left]:slide-in-from-right-2 pj:data-[side=right]:slide-in-from-left-2 pj:data-[side=top]:slide-in-from-bottom-2 pj:data-open:animate-in pj:data-open:fade-in-0 pj:data-open:zoom-in-95 pj:data-closed:animate-out pj:data-closed:fade-out-0 pj:data-closed:zoom-out-95',
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}

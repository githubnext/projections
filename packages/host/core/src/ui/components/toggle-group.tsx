'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import {toggleVariants} from './toggle.js'

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: 'horizontal' | 'vertical'
  }
>({
  size: 'default',
  variant: 'default',
  spacing: 2,
  orientation: 'horizontal',
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = 'horizontal',
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: 'horizontal' | 'vertical'
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{'--pj-gap': spacing} as React.CSSProperties}
      className={cn(
        'pj:group/toggle-group pj:flex pj:w-fit pj:flex-row pj:items-center pj:gap-[--spacing(var(--pj-gap))] pj:rounded-md pj:data-[spacing=0]:data-[variant=outline]:shadow-xs pj:data-vertical:flex-col pj:data-vertical:items-stretch',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{variant, size, spacing, orientation}}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        'pj:shrink-0 pj:group-data-[spacing=0]/toggle-group:rounded-none pj:group-data-[spacing=0]/toggle-group:px-2 pj:group-data-[spacing=0]/toggle-group:shadow-none pj:focus:z-10 pj:focus-visible:z-10 pj:group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 pj:group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 pj:group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-md pj:group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-md pj:group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-md pj:group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-md pj:data-[state=on]:bg-muted pj:group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 pj:group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 pj:group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l pj:group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export {ToggleGroup, ToggleGroupItem}

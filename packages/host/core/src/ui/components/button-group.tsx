// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '../lib/utils.js'
import * as Slot from '@radix-ui/react-slot'
import {Separator} from './separator.js'

const buttonGroupVariants = cva(
  "pj:group/button-group pj:flex pj:w-fit pj:items-stretch pj:*:focus-visible:relative pj:*:focus-visible:z-10 pj:has-[>[data-slot=button-group]]:gap-2 pj:has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md pj:[&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit pj:[&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          'pj:[&>*:not(:first-child)]:rounded-l-none pj:[&>*:not(:first-child)]:border-l-0 pj:[&>*:not(:last-child)]:rounded-r-none pj:[&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-md!',
        vertical:
          'pj:flex-col pj:[&>*:not(:first-child)]:rounded-t-none pj:[&>*:not(:first-child)]:border-t-0 pj:[&>*:not(:last-child)]:rounded-b-none pj:[&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md!',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  },
)

function ButtonGroup({className, orientation, ...props}: React.ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({orientation}), className)}
      {...props}
    />
  )
}

function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : 'div'

  return (
    <Comp
      className={cn(
        "pj:flex pj:items-center pj:gap-2 pj:rounded-md pj:border pj:bg-muted pj:px-2.5 pj:text-sm pj:font-medium pj:shadow-xs pj:[&_svg]:pointer-events-none pj:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({className, orientation = 'vertical', ...props}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        'pj:relative pj:self-stretch pj:bg-input pj:data-horizontal:mx-px pj:data-horizontal:w-auto pj:data-vertical:my-px pj:data-vertical:h-auto',
        className,
      )}
      {...props}
    />
  )
}

export {ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants}

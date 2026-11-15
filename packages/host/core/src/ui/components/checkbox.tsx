'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {CheckIcon} from 'lucide-react'
import {cn} from '../lib/utils.js'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'

function Checkbox({className, ...props}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'pj:peer pj:relative pj:flex pj:size-4 pj:shrink-0 pj:items-center pj:justify-center pj:rounded-[4px] pj:border pj:border-input pj:shadow-xs pj:transition-shadow pj:outline-none pj:group-has-disabled/field:opacity-50 pj:group-has-[:focus-visible]/field-label:ring-0 pj:group-has-[:focus-visible]/field-label:not-data-checked:border-input pj:after:absolute pj:after:-inset-x-3 pj:after:-inset-y-2 pj:focus-visible:border-ring pj:focus-visible:ring-3 pj:focus-visible:ring-ring/50 pj:disabled:cursor-not-allowed pj:disabled:opacity-50 pj:aria-invalid:border-destructive pj:aria-invalid:ring-3 pj:aria-invalid:ring-destructive/20 pj:aria-invalid:aria-checked:border-primary pj:dark:bg-input/30 pj:dark:aria-invalid:border-destructive/50 pj:dark:aria-invalid:ring-destructive/40 pj:data-checked:border-primary pj:data-checked:bg-primary pj:data-checked:text-primary-foreground pj:group-has-[:focus-visible]/field-label:data-checked:border-primary pj:dark:data-checked:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="pj:grid pj:place-content-center pj:text-current pj:transition-none pj:[&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export {Checkbox}

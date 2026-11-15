// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'

function Input({className, type, ...props}: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'pj:h-9 pj:w-full pj:min-w-0 pj:rounded-md pj:border pj:border-input pj:bg-transparent pj:px-2.5 pj:py-1 pj:text-base pj:shadow-xs pj:transition-[color,box-shadow] pj:outline-none pj:file:inline-flex pj:file:h-7 pj:file:border-0 pj:file:bg-transparent pj:file:text-sm pj:file:font-medium pj:file:text-foreground pj:placeholder:text-muted-foreground pj:focus-visible:border-ring pj:focus-visible:ring-3 pj:focus-visible:ring-ring/50 pj:disabled:pointer-events-none pj:disabled:cursor-not-allowed pj:disabled:opacity-50 pj:aria-invalid:border-destructive pj:aria-invalid:ring-3 pj:aria-invalid:ring-destructive/20 pj:md:text-sm pj:dark:bg-input/30 pj:dark:aria-invalid:border-destructive/50 pj:dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export {Input}

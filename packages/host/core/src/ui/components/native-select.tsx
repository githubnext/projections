// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {ChevronDownIcon} from 'lucide-react'
import {cn} from '../lib/utils.js'

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
}

function NativeSelect({className, size = 'default', ...props}: NativeSelectProps) {
  return (
    <div
      className={cn('pj:group/native-select pj:relative pj:w-fit pj:has-[select:disabled]:opacity-50', className)}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="pj:h-9 pj:w-full pj:min-w-0 pj:appearance-none pj:rounded-md pj:border pj:border-input pj:bg-transparent pj:py-1 pj:pr-8 pj:pl-2.5 pj:text-sm pj:shadow-xs pj:transition-[color,box-shadow] pj:outline-none pj:select-none pj:selection:bg-primary pj:selection:text-primary-foreground pj:placeholder:text-muted-foreground pj:focus-visible:border-ring pj:focus-visible:ring-3 pj:focus-visible:ring-ring/50 pj:disabled:pointer-events-none pj:disabled:cursor-not-allowed pj:aria-invalid:border-destructive pj:aria-invalid:ring-3 pj:aria-invalid:ring-destructive/20 pj:data-[size=sm]:h-8 pj:dark:bg-input/30 pj:dark:hover:bg-input/50 pj:dark:aria-invalid:border-destructive/50 pj:dark:aria-invalid:ring-destructive/40"
        {...props}
      />
      <ChevronDownIcon
        className="pj:pointer-events-none pj:absolute pj:top-1/2 pj:right-2.5 pj:size-4 pj:-translate-y-1/2 pj:text-muted-foreground pj:select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({className, ...props}: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className={cn('pj:bg-[Canvas] pj:text-[CanvasText]', className)} {...props} />
}

function NativeSelectOptGroup({className, ...props}: React.ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" className={cn('pj:bg-[Canvas] pj:text-[CanvasText]', className)} {...props} />
}

export {NativeSelect, NativeSelectOptGroup, NativeSelectOption}

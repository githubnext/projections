'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'
import * as LabelPrimitive from '@radix-ui/react-label'

function Label({className, ...props}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'pj:flex pj:items-center pj:gap-2 pj:text-sm pj:leading-none pj:font-medium pj:select-none pj:group-data-[disabled=true]:pointer-events-none pj:group-data-[disabled=true]:opacity-50 pj:peer-disabled:cursor-not-allowed pj:peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export {Label}

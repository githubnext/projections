'use client'

// Adapted from shadcn/ui (https://ui.shadcn.com), style radix-vega, shadcn@4.23.0. MIT License, Copyright (c) 2023
// shadcn; see LICENSE.shadcn.txt. Local changes: `pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react.

import * as React from 'react'
import {cn} from '../lib/utils.js'

function Table({className, ...props}: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="pj:relative pj:w-full pj:overflow-x-auto">
      <table data-slot="table" className={cn('pj:w-full pj:caption-bottom pj:text-sm', className)} {...props} />
    </div>
  )
}

function TableHeader({className, ...props}: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('pj:[&_tr]:border-b', className)} {...props} />
}

function TableBody({className, ...props}: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('pj:[&_tr:last-child]:border-0', className)} {...props} />
}

function TableFooter({className, ...props}: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('pj:border-t pj:bg-muted/50 pj:font-medium pj:[&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({className, ...props}: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'pj:border-b pj:transition-colors pj:hover:bg-muted/50 pj:has-aria-expanded:bg-muted/50 pj:data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({className, ...props}: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'pj:h-10 pj:px-2 pj:text-left pj:align-middle pj:font-medium pj:whitespace-nowrap pj:text-foreground pj:[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({className, ...props}: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('pj:p-2 pj:align-middle pj:whitespace-nowrap pj:[&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  )
}

function TableCaption({className, ...props}: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('pj:mt-4 pj:text-sm pj:text-muted-foreground', className)} {...props} />
}

export {Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption}

import type {ReactNode} from 'react'
import {cn} from '@githubnext/projections-host/ui/components'

/** The status bar along the bottom of the workbench, on the gutter. */
export function StatusBar({children}: {children: ReactNode}) {
  return (
    <footer className="pi-statusbar pj:flex pj:h-[22px] pj:shrink-0 pj:items-center pj:gap-3 pj:overflow-hidden pj:whitespace-nowrap pj:px-3 pj:text-[11px] pj:leading-none pj:text-muted-foreground">
      {children}
    </footer>
  )
}

/** One item of the status bar. */
export function StatusItem({
  children,
  title,
  className,
  ...data
}: {children: ReactNode; title?: string | undefined; className?: string} & Record<`data-${string}`, string | undefined>) {
  return (
    <span className={cn('pj:inline-flex pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-1 pj:truncate', className)} title={title} {...data}>
      {children}
    </span>
  )
}

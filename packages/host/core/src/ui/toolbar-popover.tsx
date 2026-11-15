import {useId} from 'react'
import type {ReactNode} from 'react'
import {Button} from './components/button.js'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover.js'
import {cn} from './lib/utils.js'

/**
 * An icon button that opens a non-modal popover (shadcn's Radix Popover, inside the scoped root): focus moves into
 * it, and Escape or a click outside closes it and returns focus to the button. `trigger` replaces the icon button,
 * for example with a labeled one; `open` and `onOpenChange` control it.
 */
export function ToolbarPopover({
  icon,
  label,
  title,
  children,
  className,
  contentClassName,
  active = false,
  activeLabel = 'Needs attention',
  trigger,
  open,
  onOpenChange,
}: {
  icon?: ReactNode
  /** The button's accessible name and tooltip. */
  label: string
  /** The popover's accessible name. */
  title: string
  children: ReactNode
  className: string
  contentClassName?: string
  /** Shows a dot on the button, for example for error diagnostics. */
  active?: boolean
  /** What the dot means, for assistive technology. */
  activeLabel?: string
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const id = useId()
  return (
    <Popover {...(open !== undefined ? {open} : {})} {...(onOpenChange ? {onOpenChange} : {})}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              'pj:relative pj:shrink-0 pj:text-muted-foreground pj:hover:text-foreground pj:data-[state=open]:bg-accent pj:data-[state=open]:text-foreground',
              className,
            )}
            aria-label={label}
            title={label}
            {...(active ? {'aria-describedby': `${id}-active`} : {})}
          >
            {icon}
            {active && (
              <>
                <span aria-hidden="true" className="pj:absolute pj:right-1.5 pj:top-1.5 pj:size-1.5 pj:rounded-full pj:bg-destructive" />
                <span id={`${id}-active`} className="pj:sr-only">
                  {activeLabel}
                </span>
              </>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label={title}
        className={cn(
          // Never taller than the room on its side of the button: its content scrolls inside it.
          'pj:max-h-(--radix-popover-content-available-height) pj:w-80 pj:max-w-[calc(100vw-1rem)] pj:gap-3 pj:overflow-y-auto pj:p-3',
          `${className}-popover`,
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

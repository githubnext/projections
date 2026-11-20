import {forwardRef, type ComponentPropsWithoutRef, type ElementRef} from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import {cn} from '../lib/utils.js'

/**
 * A single-choice segmented control: a Radix radio group (`role=radiogroup`, items `role=radio`), so arrow keys
 * move and select like native radios and the choice can never be cleared. Styled as the Projector theme's
 * segments: a bordered muted well whose checked item is a raised, bevelled card-colored segment.
 */
export const SegmentedControl = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function SegmentedControl({className, ...props}, ref) {
  // No orientation: every arrow key moves, as with native radios.
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      loop
      className={cn(
        'pj:inline-flex pj:h-8 pj:items-center pj:gap-0.5 pj:rounded-md pj:border pj:border-input pj:bg-muted pj:p-0.5',
        className,
      )}
      {...props}
    />
  )
})

/**
 * One segment of a `SegmentedControl`, a Radix radio item with a `value`. Moving focus to it with the keyboard selects
 * it, as arrow keys do in a native radio group.
 */
export const SegmentedControlItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function SegmentedControlItem({className, children, onFocus, ...props}, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      // Radix selects on arrow-key focus only while the key is still down; select whenever the keyboard moves focus within the group.
      onFocus={event => {
        onFocus?.(event)
        const from = event.relatedTarget
        const item = event.currentTarget
        if (
          from instanceof HTMLElement &&
          from !== item &&
          item.parentElement?.contains(from) &&
          item.matches(':focus-visible') &&
          item.getAttribute('aria-checked') !== 'true'
        )
          item.click()
      }}
      className={cn(
        'pj:inline-flex pj:h-full pj:items-center pj:justify-center pj:whitespace-nowrap pj:rounded-sm pj:px-2.5 pj:text-sm pj:font-medium pj:text-muted-foreground pj:transition-colors pj:hover:text-foreground pj:focus-visible:relative pj:focus-visible:z-10 pj:disabled:pointer-events-none pj:disabled:opacity-50 pj:data-[state=checked]:bg-card pj:data-[state=checked]:text-foreground pj:data-[state=checked]:shadow-[var(--pj-bevel),0_1px_2px_oklch(0_0_0/0.12)]',
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  )
})

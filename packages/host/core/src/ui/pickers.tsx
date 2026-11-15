import {useEffect, useId, useRef} from 'react'
import type {ComponentProps} from 'react'
import {ArrowLeftRight, ChevronDown} from 'lucide-react'
import type {ComparisonPair} from '../pair.js'
import {Button} from './components/button.js'
import {Label} from './components/label.js'
import {NativeSelect} from './components/native-select.js'
import {cn} from './lib/utils.js'
import {ToolbarPopover} from './toolbar-popover.js'

// Choosing another pair remounts the picker (the view is recomputed), so the control the person used gets focus back.
let pendingFocus: {slot: 'before' | 'after' | 'swap'; until: number} | undefined

const remember = (slot: 'before' | 'after' | 'swap') => {
  pendingFocus = {slot, until: Date.now() + 2000}
}

/** The short part of a revision label: "v1 · base" → "v1". */
const shortLabel = (label: string) => label.split(' · ')[0] ?? label

/**
 * A revision select. `short` draws a compact trigger: the short revision name (truncated, with the full one as its
 * title) over the native select, which stays the focusable, labeled control and opens the full list.
 */
function RevisionSelect({
  short,
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<'select'>, 'size'> & {short: boolean; label: string}) {
  if (!short)
    return (
      <NativeSelect size="sm" className={className} {...props}>
        {children}
      </NativeSelect>
    )
  return (
    <span
      data-slot="revision-trigger"
      title={props.title}
      className="ph-revision pj:relative pj:inline-flex pj:h-8 pj:min-w-14 pj:max-w-32 pj:shrink-0 pj:items-center pj:gap-1 pj:rounded-md pj:border pj:border-input pj:bg-background pj:pr-1.5 pj:pl-2.5 pj:text-sm pj:shadow-xs pj:transition-[color,box-shadow] pj:hover:bg-accent pj:has-[select:focus-visible]:border-ring pj:has-[select:focus-visible]:ring-3 pj:has-[select:focus-visible]:ring-ring/50 pj:has-[select:disabled]:opacity-50 pj:dark:bg-input/30"
    >
      <span aria-hidden="true" className="pj:min-w-0 pj:truncate">
        {label}
      </span>
      <ChevronDown aria-hidden="true" className="pj:size-3.5 pj:shrink-0 pj:text-muted-foreground" />
      <select
        data-slot="native-select"
        className="pj:absolute pj:inset-0 pj:size-full pj:cursor-pointer pj:appearance-none pj:rounded-md pj:opacity-0 pj:outline-none"
        {...props}
      >
        {children}
      </select>
    </span>
  )
}

/** How a `PairPicker` draws: two selects, two compact triggers with short revision names, or one compare button. */
export type PairForm = 'full' | 'short' | 'merged'

/**
 * Compact before → after picker over `useComparisonPair`: "Compare from", Swap, and "To" ("Show" with no base).
 * `form` `short` draws each select as a compact trigger with the short revision name ("v1"); `merged` (or
 * `compact`) draws one compare button ("v1 → v3", named "Revisions: …") whose popover holds the same selects and Swap.
 */
export function PairPicker({
  pair,
  form,
  compact = false,
  className,
}: {
  pair: ComparisonPair
  form?: PairForm | undefined
  compact?: boolean
  className?: string
}) {
  const id = useId()
  const before = useRef<HTMLSelectElement>(null)
  const after = useRef<HTMLSelectElement>(null)
  const swap = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!pendingFocus || pendingFocus.until < Date.now()) return
    const active = document.activeElement
    if (active && active !== document.body) return
    ;({before, after, swap})[pendingFocus.slot].current?.focus({preventScroll: true})
  }, [])
  if (!pair.after) return null
  const shape = form ?? (compact ? 'merged' : 'full')
  const merged = shape === 'merged'
  const short = shape === 'short'
  const comparing = Boolean(pair.before && pair.before.key !== pair.after.key)
  const select = merged ? 'pj:w-full pj:rounded-md pj:bg-background' : 'pj:min-w-0 pj:w-36 pj:shrink-0 pj:rounded-md pj:bg-background'
  const fields = (
    <>
      <Label htmlFor={`${id}-before`} className={merged ? 'pj:text-xs pj:text-muted-foreground' : 'pj:sr-only'}>
        Compare from
      </Label>
      <RevisionSelect
        short={short}
        label={pair.before ? shortLabel(pair.before.label) : 'None'}
        ref={before}
        id={`${id}-before`}
        className={select}
        title={`Compare from: ${pair.before?.label ?? 'nothing'}`}
        value={pair.before?.key ?? ''}
        onChange={event => {
          remember('before')
          pair.setBefore(event.target.value)
        }}
      >
        <option value="">Nothing (show one revision)</option>
        {pair.extractions.map(item => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </RevisionSelect>
      <Button
        ref={swap}
        type="button"
        variant="ghost"
        size={merged ? 'sm' : 'icon-sm'}
        className={cn('pj:shrink-0 pj:text-muted-foreground pj:hover:text-foreground', merged && 'pj:self-start')}
        aria-label="Swap"
        title="Swap"
        disabled={!pair.comparing}
        onClick={() => {
          remember('swap')
          pair.swap()
        }}
      >
        <ArrowLeftRight data-icon="swap" />
        {merged && <span>Swap</span>}
      </Button>
      <Label htmlFor={`${id}-after`} className={merged ? 'pj:text-xs pj:text-muted-foreground' : 'pj:sr-only'}>
        {comparing ? 'To' : 'Show'}
      </Label>
      <RevisionSelect
        short={short}
        label={shortLabel(pair.after.label)}
        ref={after}
        id={`${id}-after`}
        className={select}
        title={`${comparing ? 'To' : 'Show'}: ${pair.after.label}`}
        value={pair.after.key}
        onChange={event => {
          remember('after')
          pair.setAfter(event.target.value)
        }}
      >
        {pair.extractions.map(item => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </RevisionSelect>
    </>
  )
  if (merged) {
    const name = comparing ? `Revisions: ${pair.before!.label} → ${pair.after.label}` : `Revision: ${pair.after.label}`
    return (
      <ToolbarPopover
        label={name}
        title="Revisions"
        className={cn('ph-pair', className)}
        contentClassName="pj:w-72"
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={name}
            title={name}
            className="ph-pair-button pj:h-8 pj:min-w-16 pj:max-w-44 pj:shrink pj:gap-1 pj:border pj:border-input pj:bg-background pj:pr-1.5 pj:pl-2.5 pj:font-normal pj:shadow-xs pj:dark:bg-input/30 pj:data-[state=open]:bg-accent"
          >
            <span className="pj:min-w-0 pj:truncate">
              {comparing ? (
                <>
                  {shortLabel(pair.before!.label)}
                  <span className="pj:px-1 pj:text-muted-foreground">→</span>
                  {shortLabel(pair.after.label)}
                </>
              ) : (
                shortLabel(pair.after.label)
              )}
            </span>
            <ChevronDown className="pj:size-3.5! pj:shrink-0 pj:text-muted-foreground" />
          </Button>
        }
      >
        <fieldset className="pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5">
          <legend className="pj:sr-only">Revisions</legend>
          {fields}
        </fieldset>
      </ToolbarPopover>
    )
  }
  return (
    <fieldset className={cn('ph-pair pj:flex pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-1', className)}>
      <legend className="pj:sr-only">Revisions</legend>
      {fields}
    </fieldset>
  )
}

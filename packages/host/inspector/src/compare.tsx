import {useEffect, useId, useState} from 'react'
import type {ReactNode} from 'react'
import {Input, Label, cn} from '@githubnext/projections-host/ui/components'
import {LoaderCircle} from 'lucide-react'

const workingTree = 'working-tree'
/** A ref as people write it: "Working tree" (any case) is the working tree. */
export const parseRef = (text: string) => (/^working[ -]?tree$/i.test(text.trim()) ? workingTree : text.trim())
const shown = (ref: string) => (ref === workingTree ? 'Working tree' : ref)

/**
 * One side of the Compare pair: a labelled field that takes a branch, tag, commit SHA or "Working tree". Enter
 * applies it once `validate` (the Inspector API) accepts the ref; otherwise the field says why and keeps the pair.
 */
export function RefField({
  label,
  value,
  onApply,
  validate,
  disabled,
}: {
  label: string
  value: string | undefined
  onApply: (ref: string) => void
  validate: (ref: string) => Promise<void>
  disabled?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value ? shown(value) : '')
  const [error, setError] = useState<string>()
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    setText(value ? shown(value) : '')
    setError(undefined)
  }, [value])
  return (
    <form
      className="pi-ref pj:flex pj:min-w-0 pj:flex-1 pj:flex-col pj:gap-0.5"
      data-side={label.toLowerCase()}
      onSubmit={event => {
        event.preventDefault()
        const ref = parseRef(text)
        if (!ref || ref === value) return
        setChecking(true)
        validate(ref)
          .then(() => {
            setError(undefined)
            onApply(ref)
          })
          .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
          .finally(() => setChecking(false))
      }}
    >
      <Label htmlFor={id} className="pj:px-0.5 pj:text-[11px] pj:font-normal pj:text-muted-foreground">
        {label}
      </Label>
      <span className="pj:relative pj:flex">
        <Input
          id={id}
          value={text}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder="Branch, tag, SHA"
          title={`${label}: ${value ? shown(value) : 'none'} (Enter applies a branch, tag, commit SHA or "Working tree")`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={event => setText(event.target.value)}
          className="pj:h-7 pj:min-w-0 pj:pr-6 pj:font-mono pj:text-xs pj:md:text-xs"
        />
        {checking && (
          <LoaderCircle
            aria-label="Checking the ref"
            className="pj:absolute pj:top-1.5 pj:right-1.5 pj:size-4 pj:animate-spin pj:text-muted-foreground pj:motion-reduce:animate-none"
          />
        )}
      </span>
      {error && (
        <p id={`${id}-error`} role="alert" className="pj:px-0.5 pj:text-[11px] pj:break-words pj:text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

/** A choice in an Explorer list (a pair, a scenario): a full-width row that shows whether it is the current one. */
export function ChoiceButton({
  pressed,
  label,
  detail,
  icon,
  disabled,
  title,
  onClick,
  ...data
}: {
  pressed: boolean
  label: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  disabled?: boolean | undefined
  title?: string | undefined
  onClick: () => void
} & {[key: `data-${string}`]: string | undefined} & {'aria-label'?: string}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'pi-x-row pj:w-full pj:min-w-0 pj:text-left pj:text-xs pj:transition-colors pj:hover:bg-muted/60 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring pj:disabled:opacity-50 pj:aria-pressed:bg-accent pj:aria-pressed:text-accent-foreground',
      )}
      {...data}
    >
      <span aria-hidden={icon ? undefined : true} className="pi-x-icon pj:text-muted-foreground pj:[&_svg]:size-3.5">
        {icon}
      </span>
      <span className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col">
        <span className="pi-x-title pj:truncate pj:font-medium">{label}</span>
        {detail && <span className="pi-x-detail pj:truncate pj:text-[11px] pj:text-muted-foreground">{detail}</span>}
      </span>
    </button>
  )
}

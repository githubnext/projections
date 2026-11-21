import {Activity} from 'lucide-react'
import type {VariedField} from '../../details/fields.js'
import {statusTone} from '../views.js'
import {cn} from '../lib/utils.js'

/** Long values are shortened in the card; the whole value is the pill's title. */
export const short = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}…` : text)
const pill = 'pj:inline pj:rounded-sm pj:border pj:px-1 pj:py-px pj:font-mono pj:text-xs pj:[box-decoration-break:clone] pj:break-words'

/**
 * A value that changed, in the renderer kit's `ValueChange` vocabulary: the old value struck through in a removed
 * pill, an arrow, then the new value in an added pill; assistive technology reads "was …, now …". A missing side shows
 * only the other pill; an unchanged value (one extraction) is plain.
 */
export function ValueChange({before, after}: {before?: string | undefined; after?: string | undefined}) {
  if (before !== undefined && before === after) {
    return (
      <span className="ph-value pj:break-words pj:font-mono pj:text-xs" title={after}>
        {short(after)}
      </span>
    )
  }
  return (
    <span className="ph-value-change pj:flex pj:min-w-0 pj:flex-wrap pj:items-baseline pj:gap-x-1 pj:gap-y-0.5">
      {before !== undefined && (
        <del className={cn('ph-value-pill', pill, statusTone.removed)} data-change="removed" title={before}>
          <span className="pj:sr-only">was </span>
          {short(before)}
        </del>
      )}
      {before !== undefined && after !== undefined && (
        <span aria-hidden="true" className="pj:text-xs pj:text-muted-foreground">
          →
        </span>
      )}
      {after !== undefined && (
        <ins className={cn('ph-value-pill pj:no-underline', pill, statusTone.added)} data-change="added" title={after}>
          <span className="pj:sr-only">{before !== undefined ? ', now ' : 'now '}</span>
          {short(after)}
        </ins>
      )}
    </span>
  )
}

/**
 * The volatile values of a change that differ (`RowDetails.varied`), neutrally: each path and its values in the
 * monospace font, old → new, and whether it stayed within tolerance ("durationMs 120 → 135", "within tolerance") or
 * went beyond it ("beyond tolerance (volatile)", with the volatile icon), plus the comparison's reason when it gives
 * one. The parts are set apart by the row's gap, not a separator character, so a wrapped row never starts a line with
 * one; assistive technology hears a comma. No change colors: a value within tolerance is not a change.
 */
export function VariedList({varied, className}: {varied: readonly VariedField[]; className?: string}) {
  if (!varied.length) return null
  return (
    <div className={cn('ph-varied pj:flex pj:min-w-0 pj:flex-col pj:gap-1', className)}>
      <p className="pj:text-xs pj:text-muted-foreground">Volatile values</p>
      <ul
        className="ph-varied-fields pj:-mx-1 pj:flex pj:min-w-0 pj:flex-col pj:overflow-hidden pj:rounded-md pj:border pj:[&>li+li]:border-t"
        aria-label="Volatile values"
      >
        {varied.map(field => (
          <li
            key={field.path}
            className="ph-varied-field pj:flex pj:min-w-0 pj:flex-wrap pj:items-baseline pj:gap-x-1.5 pj:gap-y-0.5 pj:px-2 pj:py-1.5 pj:text-xs"
            data-varied-path={field.path}
            data-within={field.within}
          >
            <code className="ph-field-name pj:break-all pj:font-mono pj:text-muted-foreground">{field.name}</code>
            <span className="ph-varied-values pj:break-all pj:font-mono" title={`${field.before ?? '—'} → ${field.after ?? '—'}`}>
              <span className="pj:sr-only">was </span>
              {short(field.before ?? '—')}
              <span aria-hidden="true" className="pj:text-muted-foreground">
                {' → '}
              </span>
              <span className="pj:sr-only">, now </span>
              {short(field.after ?? '—')}
            </span>
            <span className="ph-varied-words pj:inline-flex pj:items-baseline pj:gap-1 pj:text-muted-foreground">
              <span className="pj:sr-only">, </span>
              {!field.within && <Activity aria-hidden="true" className="pj:size-3 pj:shrink-0 pj:self-center" />}
              {field.words}
            </span>
            {field.reason && <span className="ph-varied-reason pj:basis-full pj:text-muted-foreground">{field.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

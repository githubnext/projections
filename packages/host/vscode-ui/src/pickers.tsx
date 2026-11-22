import {useId, useRef, useState} from 'react'
import {type ComparisonPair, revisionLabelName} from '@githubnext/projections-host'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import {ActionButton, VscBadge, VscOption, VscSingleSelect} from './elements.js'
import {Overlay} from './overlay/overlay.js'
import {QuickPick} from './overlay/quick-pick.js'
import {uiCodicons} from './codicons.js'
import type {ToolbarLayout} from './layout/steps.js'

/** A pair picker's form, named as the default UI names it: two dropdowns, two with short names, or one compare action. */
export type PairForm = 'full' | 'short' | 'merged'

/** A revision's short name: its label up to the first " · ", for example "v1" for "v1 · base". */
/** A revision label's name alone (`revisionLabelName`), for compact pickers. */
export const shortRevisionLabel = revisionLabelName

/** One revision dropdown: VS Code's dropdown (`vscode-single-select`), with the full name in each option's description. */
function RevisionSelect({
  label,
  value,
  pair,
  none,
  compact,
  focusId,
  onChange,
  showLabel,
}: {
  label: string
  value: string
  pair: ComparisonPair
  /** Offer "Nothing (show one revision)". */
  none: boolean
  compact: boolean
  focusId?: string | undefined
  onChange: (value: string) => void
  showLabel: boolean
}) {
  const id = useId()
  const current = pair.extractions.find(item => item.key === value)
  return (
    <div
      className="phv-pair-field"
      data-compact={compact || undefined}
      title={compact ? `${label}: ${current?.label ?? 'nothing'}` : undefined}
    >
      <label id={`${id}-label`} className={showLabel ? 'phv-field-label' : 'phv-visually-hidden'}>
        {label}
      </label>
      <VscSingleSelect
        label={label}
        aria-labelledby={`${id}-label`}
        value={value}
        combobox={false}
        onChange={event => onChange((event.target as HTMLInputElement).value)}
        data-focus-id={focusId}
        className="phv-revision-select"
      >
        {none && (
          <VscOption value="" selected={value === ''}>
            {compact ? 'None' : 'Nothing (show one revision)'}
          </VscOption>
        )}
        {pair.extractions.map(item => (
          <VscOption
            key={item.key}
            value={item.key}
            selected={item.key === value}
            {...(compact && shortRevisionLabel(item.label) !== item.label ? {description: item.label} : {})}
          >
            {compact ? shortRevisionLabel(item.label) : item.label}
          </VscOption>
        ))}
      </VscSingleSelect>
    </div>
  )
}

function PairFields({pair, labels, compact = false}: {pair: ComparisonPair; labels: boolean; compact?: boolean}) {
  const {before, after} = pair
  if (!after) return null
  const comparing = Boolean(before && before.key !== after.key)
  return (
    <fieldset className="phv-pair-picker" data-labels={labels || undefined} data-compact={compact || undefined}>
      <legend className="phv-visually-hidden">Revisions</legend>
      <RevisionSelect
        label="Compare from"
        value={before?.key ?? ''}
        pair={pair}
        none
        compact={compact}
        focusId={labels ? undefined : 'compare-from'}
        onChange={pair.setBefore}
        showLabel={labels}
      />
      <ActionButton
        icon={uiCodicons.swap}
        label="Swap"
        disabled={!pair.comparing}
        onClick={pair.swap}
        className="phv-swap"
        data-focus-id={labels ? undefined : 'swap'}
      />
      <RevisionSelect
        label={comparing ? 'To' : 'Show'}
        value={after.key}
        pair={pair}
        none={false}
        compact={compact}
        focusId={labels ? undefined : 'to'}
        onChange={pair.setAfter}
        showLabel={labels}
      />
    </fieldset>
  )
}

/**
 * Before → after picker over `useComparisonPair`, in one of three forms (`layout`, `ToolbarLayout.pickers`):
 * - `full`: "Compare from" and "To" ("Show" with no base) VS Code dropdowns and Swap;
 * - `compact`: the same dropdowns showing short names ("v1"), each option describing its full name;
 * - `merged` (or `compact` set): one action, for example "v1 → v2" (named "Revisions: v1 · base → v2 · first push"),
 *   that opens the dropdowns in a widget like VS Code's quick input.
 */
export function PairPicker({
  pair,
  compact = false,
  form,
  layout = form === 'short' ? 'compact' : (form ?? (compact ? 'merged' : 'full')),
}: {
  pair: ComparisonPair
  /** One compare action: the same as `layout="merged"`. */
  compact?: boolean
  /** The form as the default UI's `toolbarStart` names it (`short` is `compact`). */
  form?: PairForm
  layout?: ToolbarLayout['pickers']
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<VscodeToolbarButton>(null)
  const {before, after} = pair
  if (!after) return null
  if (layout !== 'merged') return <PairFields pair={pair} labels={false} compact={layout === 'compact'} />
  const comparing = Boolean(before && before.key !== after.key)
  const name = comparing ? `${before!.label} → ${after.label}` : after.label
  return (
    <>
      <ActionButton
        ref={button}
        icon="git-compare"
        label={`Revisions: ${name}`}
        title={name}
        popup="dialog"
        expanded={open}
        className="phv-pair-button"
        onClick={() => setOpen(!open)}
        data-focus-id="revisions"
      >
        <span className="phv-pair-button-text phv-cap" aria-hidden="true">
          {comparing ? `${shortRevisionLabel(before!.label)} → ${shortRevisionLabel(after.label)}` : shortRevisionLabel(after.label)}
        </span>
      </ActionButton>
      <Overlay
        open={open}
        onClose={() => setOpen(false)}
        anchor={button}
        placement="below-start"
        role="dialog"
        label="Revisions"
        className="phv-widget phv-pair-popover"
      >
        <PairFields pair={pair} labels />
      </Overlay>
    </>
  )
}

/** A projection a `ProjectionPicker` offers. */
export interface ProjectionChoice {
  id: string
  title: string
  description?: string
  /** For example the number of changes. */
  count?: number
}

/**
 * Chooses among projections, for example the ones a pull request has: a VS Code dropdown action (the title, a count
 * badge and a chevron) that opens a quick pick of the projections to filter and choose from.
 */
export function ProjectionPicker({
  projections,
  value,
  onChange,
  label = 'Projection',
}: {
  projections: readonly ProjectionChoice[]
  value: string
  onChange: (id: string) => void
  /** The accessible prefix of the action and the quick pick's name. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const current = projections.find(choice => choice.id === value) ?? projections[0]
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="phv-dropdown-action phv-projection-picker"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="phv-visually-hidden">{label}: </span>
        <span className="phv-dropdown-text">{current?.title ?? label}</span>
        {current?.count !== undefined && (
          <VscBadge variant="counter" className="phv-count">
            {current.count}
          </VscBadge>
        )}
        <span className="codicon codicon-chevron-down" aria-hidden="true" />
      </button>
      <QuickPick
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        placement="below-start"
        label={label}
        placeholder={`Select a ${label.toLowerCase()}`}
        value={value}
        onSelect={onChange}
        items={projections.map(choice => ({
          id: choice.id,
          label: choice.title,
          ...(choice.description ? {detail: choice.description} : {}),
          ...(choice.count !== undefined ? {count: choice.count} : {}),
        }))}
      />
    </>
  )
}

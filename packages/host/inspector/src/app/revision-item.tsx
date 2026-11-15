import {cn} from '@githubnext/projections-host/ui/components'
import {CircleAlert, CircleCheck, GitCommitHorizontal, LoaderCircle, Play, RefreshCw} from 'lucide-react'
import {iconButton} from '../shell/controls.js'
import type {RevisionRow, RowState} from './revisions.js'

/** A revision's A/B marks and extraction status. */
export function RevisionItem({
  row,
  state,
  mark,
  onMark,
  onExtract,
  disabled,
  markDisabled,
  selected,
}: {
  row: RevisionRow
  state: RowState | undefined
  mark: 'A' | 'B' | undefined
  onMark: (mark: 'A' | 'B') => void
  onExtract?: (() => void) | undefined
  disabled?: boolean
  /** Marking needs an extraction first (a saved artifact's rows are always extracted). */
  markDisabled?: boolean
  selected: boolean
}) {
  const status = state?.status
  const markButton = (letter: 'A' | 'B') => {
    const side = letter === 'A' ? 'Before' : 'After'
    return (
      <button
        type="button"
        aria-label={`Set ${row.label} as ${side}`}
        aria-pressed={mark === letter}
        onClick={() => onMark(letter)}
        disabled={markDisabled}
        title={mark === letter ? `${row.label} is ${side}` : `Compare ${letter === 'A' ? 'from' : 'to'} this revision`}
        className={cn(
          'pj:inline-flex pj:h-5 pj:shrink-0 pj:items-center pj:justify-center pj:rounded-sm pj:border pj:px-1 pj:text-[10px] pj:font-semibold pj:transition-colors pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring pj:disabled:opacity-30',
          mark === letter
            ? 'pj:border-transparent pj:bg-lens pj:text-lens-foreground'
            : 'pj:border-border pj:text-muted-foreground pj:hover:bg-muted',
        )}
      >
        {side}
      </button>
    )
  }
  return (
    <li
      data-revision={row.ref}
      data-status={status ?? 'idle'}
      className={cn('pi-x-row pj:text-xs', selected ? 'pj:bg-accent' : 'pj:hover:bg-muted/60')}
    >
      <span className="pi-x-icon">
        {status === 'running' || status === 'queued' ? (
          <LoaderCircle
            aria-label={status === 'queued' ? 'Queued' : 'Extracting'}
            className="pj:h-3.5 pj:w-3.5 pj:animate-spin pj:text-muted-foreground pj:motion-reduce:animate-none"
          />
        ) : status === 'done' ? (
          <CircleCheck aria-label="Extracted" className="pj:h-3.5 pj:w-3.5 pj:text-added" />
        ) : status === 'failed' ? (
          <CircleAlert aria-label="Failed" className="pj:h-3.5 pj:w-3.5 pj:text-destructive" />
        ) : (
          <GitCommitHorizontal aria-hidden="true" className="pj:h-3.5 pj:w-3.5 pj:text-muted-foreground" />
        )}
      </span>
      <span className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col">
        <span className="pi-x-title pj:truncate pj:font-medium" title={row.label}>
          {row.label}
        </span>
        <span
          className={cn(
            'pi-revision-status pi-x-detail pj:truncate pj:text-[11px]',
            status === 'failed' ? 'pj:text-destructive' : 'pj:text-muted-foreground',
          )}
          title={state?.error ?? row.detail}
        >
          {status === 'failed'
            ? (state?.error ?? 'Extraction failed')
            : status === 'cancelled'
              ? 'Cancelled'
              : status === 'running'
                ? 'Extracting…'
                : status === 'queued'
                  ? 'Queued'
                  : status === 'done'
                    ? state?.ms
                      ? `Extracted in ${(state.ms / 1000).toFixed(1)} s`
                      : (row.detail ?? 'Loaded')
                    : (row.detail ?? '')}
        </span>
      </span>
      {onExtract && (
        <button
          type="button"
          className={cn(iconButton, 'pj:h-6 pj:w-6')}
          aria-label={`Extract ${row.label}`}
          title={`Extract ${row.label}`}
          disabled={disabled}
          onClick={onExtract}
        >
          {status === 'done' || status === 'failed' ? <RefreshCw className="pj:h-3.5 pj:w-3.5" /> : <Play className="pj:h-3.5 pj:w-3.5" />}
        </button>
      )}
      {markButton('A')}
      {markButton('B')}
    </li>
  )
}

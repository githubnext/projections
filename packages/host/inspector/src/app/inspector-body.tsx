import type {ComponentProps, ComponentType, Dispatch, SetStateAction} from 'react'
import type {ComparisonPair, LoadingStatusProps} from '@githubnext/projections-host'
import type {InspectorInvalidDefinition, InspectorJob} from '../types.js'
import {FailureCard, InvalidDefinitions} from './cards.js'
import {ComparisonFailure, EmptyState, ErrorBanner, PlainMessage, PresentedView} from './page.js'
import {refName} from './revisions.js'
import type {RowState} from './revisions.js'

interface Side {
  side: string
  ref: string
}

/** What the failure cards need: the shown pair's sides, those that failed, and what to do about them. */
export interface FailureCardsProps {
  sides: readonly Side[]
  failedSides: readonly Side[]
  projectionRows: Record<string, RowState>
  jobs: readonly InspectorJob[]
  /** Re-extracts a side, when the projection can run. */
  onRetry: ((ref: string) => void) | undefined
  setPanelRequest: Dispatch<SetStateAction<{tab: string; at: number} | undefined>>
}

/** A card for each side that didn't extract, naming the other side when it is shown alone meanwhile. */
function FailureCards({sides, failedSides, projectionRows, jobs, onRetry, setPanelRequest}: FailureCardsProps) {
  return (
    <>
      {failedSides.map(({side, ref}) => {
        const row = projectionRows[ref]!
        const other = sides.find(item => item.ref !== ref && !!projectionRows[item.ref]?.document)
        return (
          <FailureCard
            key={ref}
            side={side}
            reference={ref}
            job={jobs.find(item => item.id === row.jobId)}
            error={row.error}
            previous={Boolean(row.document)}
            other={other ? `${other.side.toLowerCase()} (${refName(other.ref)})` : undefined}
            onRetry={onRetry ? () => onRetry(ref) : undefined}
            onDiagnostics={() => setPanelRequest({tab: 'diagnostics', at: Date.now()})}
            onRawOutput={() => setPanelRequest({tab: 'raw', at: Date.now()})}
          />
        )
      })}
    </>
  )
}

export interface InspectorBodyProps {
  error: string | null
  onDismissError: () => void
  /** A page an agent drives (`chrome` `viewer`): what failed is said in plain words. */
  viewer: boolean
  /** No workbench around the view (`chrome` `none` or `viewer`). */
  bare: boolean
  invalid: readonly InspectorInvalidDefinition[]
  failures: FailureCardsProps
  pair: ComparisonPair
  /** Whether there is anything to compare. */
  chosen: boolean
  Loading: ComponentType<LoadingStatusProps>
  presented: Omit<ComponentProps<typeof PresentedView>, 'subject' | 'pair' | 'document' | 'bare' | 'banner'>
  empty: ComponentProps<typeof EmptyState>
}

/** What goes wrong before the view: an error, invalid definitions, and (for an agent's page) a side that didn't run. */
function Problems({error, onDismissError, viewer, bare, invalid, failures, pair}: InspectorBodyProps) {
  return (
    <>
      {error && viewer && (
        <p role="status" className="pi-error pj:mx-[var(--pi-gutter)] pj:mt-[var(--pi-gutter)] pj:text-sm pj:text-muted-foreground">
          Something went wrong. The agent has the details.
        </p>
      )}
      {error && !viewer && <ErrorBanner error={error} onDismiss={onDismissError} />}
      {!bare && invalid.length > 0 && <InvalidDefinitions invalid={invalid} />}
      {viewer && failures.failedSides.length > 0 && !(pair.subject && pair.document) && (
        <PlainMessage text="The extractor didn't run. The agent has the details." />
      )}
    </>
  )
}

/** The Inspector's stage: what went wrong, then the presented pair, the comparison computing, or the empty state. */
export function InspectorBody(props: InspectorBodyProps) {
  const {viewer, bare, failures, pair, chosen, Loading, presented, empty} = props
  const document = pair.document
  const status = pair.outcome.status
  const viewShown = Boolean(status !== 'failed' && pair.subject && document)
  // A failed side, with the other side shown, sits in the view under its toolbar; with nothing shown, on its own.
  const failureCards = !viewer && failures.failedSides.length ? <FailureCards {...failures} /> : undefined
  return (
    <>
      <Problems {...props} />
      {!viewer && !viewShown && failureCards}
      {pair.outcome.status === 'failed' && viewer && <PlainMessage text="These can't be compared. The agent has the details." />}
      {pair.outcome.status === 'failed' && !viewer && <ComparisonFailure error={pair.outcome.error} onRetry={pair.retry} />}
      {chosen && status === 'computing' && !pair.subject && (
        <Loading className="ph-computing" label="Computing the comparison in this browser…" />
      )}
      {status !== 'failed' && pair.subject && document ? (
        <PresentedView {...presented} subject={pair.subject} pair={pair} document={document} bare={bare} banner={failureCards} />
      ) : (
        (!chosen || (status !== 'computing' && status !== 'failed')) && <EmptyState {...empty} />
      )}
    </>
  )
}

import {rendererProtocolVersion, type ComparisonPair} from '@githubnext/projections-host'
import {StatusItem} from '../shell/status-bar.js'

/** The status bar's items: the presented revisions, the comparator, the last extraction's time, the protocol and trust. */
export function InspectorStatus({
  pair,
  before,
  after,
  labelOf,
  lastTiming,
  api,
  trustState,
}: {
  pair: ComparisonPair
  before: string
  after: string | undefined
  labelOf: (key: string | undefined) => string | undefined
  lastTiming: number | undefined
  /** Whether a runner is connected. */
  api: boolean
  trustState: 'offline' | 'unknown' | 'not-needed' | 'granted' | 'unauthorized'
}) {
  return (
    <>
      <StatusItem data-pair="" title="The presented revisions">
        {pair.outcome.status === 'compared' ? (
          <>
            <b className="pj:font-semibold">A</b>&nbsp;{labelOf(before)} → <b className="pj:font-semibold">B</b>&nbsp;{labelOf(after)}
          </>
        ) : after ? (
          labelOf(after)
        ) : (
          'No extraction'
        )}
      </StatusItem>
      {pair.comparator && (
        <StatusItem data-comparator={pair.comparator.id} title={`Digest ${pair.comparator.digest}`}>
          {pair.comparator.id === 'default' ? 'Default comparator' : `Comparator ${pair.comparator.id}`}
        </StatusItem>
      )}
      {lastTiming !== undefined && (
        <StatusItem title="Time of the last extraction">Extracted in {(lastTiming / 1000).toFixed(1)} s</StatusItem>
      )}
      <span className="pj:flex-1" />
      <StatusItem title="Renderer frame protocol version">Protocol v{rendererProtocolVersion}</StatusItem>
      {api && (
        <StatusItem className="pi-trust-state" data-trust={trustState}>
          {trustState === 'granted'
            ? 'Trusted'
            : trustState === 'not-needed'
              ? 'No trust needed'
              : trustState === 'unauthorized'
                ? 'Execution off'
                : ''}
        </StatusItem>
      )}
    </>
  )
}

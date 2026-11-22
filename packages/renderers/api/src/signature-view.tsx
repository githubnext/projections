import {useMemo, type ReactNode} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {identifier, keyed, type EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {signatureLayout, signatureOf, signatureSegments, signatureTokens, type Segment, type Side, type Token} from './signature.js'

type Tone = 'added' | 'removed'
const toneMarks: Record<Tone, string> = {added: '+', removed: '−'}

/** One signature line; a toned line carries a `+` or `−` marker in its gutter. */
function Line({tone, children}: {tone?: Tone | undefined; children: ReactNode}) {
  return (
    <pre className={`api-signature${tone ? ` ${tone}` : ''}`} {...identifier}>
      {tone && (
        <span className="api-line-mark" aria-hidden="true">
          {toneMarks[tone]}
        </span>
      )}
      {children}
    </pre>
  )
}

/** A revision's runs, marking the ones the other revision lacks. */
function Marked({tokens}: {tokens: Token[]}) {
  return keyed(tokens, token => `${token.changed ? 'changed' : 'same'}:${token.text}`).map(([key, token]) =>
    token.changed ? <mark key={key}>{token.text}</mark> : <span key={key}>{token.text}</span>,
  )
}

const segmentElement = (segment: Segment, index: number) =>
  segment.kind === 'removed' ? (
    <del key={index}>{segment.text}</del>
  ) : segment.kind === 'added' ? (
    <ins key={index}>{segment.text}</ins>
  ) : (
    <span key={index}>{segment.text}</span>
  )

/**
 * A declaration's signature in the diff: a whole added or removed line, the
 * unchanged line, or the changed line: inline with its removed and added
 * runs when most of it survives, otherwise a removed line above an added one
 * (marking scattered runs of a rewrite would only add noise).
 */
export function DiffSignature({row}: {row: EntityChange<Entity>}) {
  const before = row.before && signatureOf(row.before),
    after = row.after && signatureOf(row.after)
  const segments = useMemo(
    () => (before !== undefined && after !== undefined && before !== after ? signatureSegments(before, after) : undefined),
    [before, after],
  )
  if (after === undefined) return <Line tone="removed">{before}</Line>
  if (before === undefined) return <Line tone="added">{after}</Line>
  if (!segments) return <Line>{after}</Line>
  return (
    <div className="api-signature-change">
      <p className="sr-only">
        Signature changed from “{before}” to “{after}”.
      </p>
      <div aria-hidden="true">
        {signatureLayout(segments) === 'inline' ? (
          <Line>{segments.map(segmentElement)}</Line>
        ) : (
          <>
            <Line tone="removed">{before}</Line>
            <Line tone="added">{after}</Line>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One revision's signature, as a side-by-side pane or an extraction shows it.
 * With emphasis, a changed signature is this side's line of a split diff,
 * marking what the other revision lacks when most of it survives.
 */
export function RevisionSignature({row, side, emphasized}: {row: EntityChange<Entity>; side: Side; emphasized: boolean}) {
  const own = signatureOf(row[side]!)
  const other = side === 'before' ? row.after : row.before
  const otherSignature = other && signatureOf(other)
  const tokens = useMemo(() => {
    if (!emphasized || otherSignature === undefined || otherSignature === own) return undefined
    const segments = side === 'before' ? signatureSegments(own, otherSignature) : signatureSegments(otherSignature, own)
    return signatureLayout(segments) === 'inline' ? signatureTokens(segments, side) : undefined
  }, [emphasized, own, otherSignature, side])
  const tone: Tone = side === 'before' ? 'removed' : 'added'
  if (!emphasized || otherSignature === own) return <Line>{own}</Line>
  return <Line tone={tone}>{tokens ? <Marked tokens={tokens} /> : own}</Line>
}

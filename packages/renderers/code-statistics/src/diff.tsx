import {signed} from './timeline.js'

/** A count's signed change in diff mode, in the added or removed hue as far as the host's highlighting goes. */
export function DiffDelta({delta, noun, format}: {delta: number; noun: string; format: (value: number) => string}) {
  if (!delta) return null
  return (
    <span className={`stat-delta-label stat-diff-delta ${delta > 0 ? 'added' : 'removed'}`} data-change={delta > 0 ? 'added' : 'removed'}>
      {signed(delta, format)}
      <span className="sr-only"> {noun}</span>
    </span>
  )
}

/**
 * A row's counts in diff mode, in three fixed columns: the Before count struck
 * through when it differs, the After count (absent for a removed language),
 * and the signed change. Columns without a value draw nothing, so an
 * unchanged row is exactly its plain count.
 */
export function DiffValue({
  before,
  after,
  removed,
  noun,
  count,
  format,
}: {
  before: number
  after: number
  removed: boolean
  noun: string
  count: (value: number) => string
  format: (value: number) => string
}) {
  const was = removed || (before !== after && before !== 0)
  return (
    <span className="stat-value stat-diff-value">
      {was && (
        <del className="stat-was">
          <span className="sr-only">was </span>
          {count(before)}
        </del>
      )}
      {!removed && (
        <span className="stat-now">
          {was && <span className="sr-only">, now </span>}
          {count(after)}
        </span>
      )}
      {before !== after && (
        <span className="stat-delta">
          <DiffDelta delta={after - before} noun={noun} format={format} />
        </span>
      )}
    </span>
  )
}

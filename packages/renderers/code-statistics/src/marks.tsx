import {signed} from './timeline.js'

export function Delta({delta, emphasis, noun, format}: {delta: number; emphasis: number; noun: string; format: (value: number) => string}) {
  if (!delta || emphasis === 0) return null
  return (
    <span
      className={`stat-delta-label ${delta > 0 ? 'added' : 'removed'}`}
      data-change={delta > 0 ? 'added' : 'removed'}
      style={{opacity: emphasis}}
      aria-hidden={emphasis < 0.05}
    >
      {signed(delta, format)}
      <span className="sr-only"> {noun}</span>
    </span>
  )
}

/**
 * One continuous bar on the track: the language's colour from 0 to the current
 * count, rounded only at its outer ends. While its change is emphasized, the
 * part the language gained so far is the same colour under a light hatch, and
 * the part it lost is a neutral hatched ghost with a dashed edge, flush with
 * the bar; both fade with emphasis, so at Before and After the bar is plain.
 */
export function Bar({
  value,
  before,
  after,
  scale,
  color,
  category,
  emphasis,
  diff = false,
}: {
  value: number
  before: number
  after: number
  scale: number
  color: string
  category: string
  emphasis: number
  /** Diff mode edges the gained part in the added hue and draws the lost part in the removed hue. */
  diff?: boolean
}) {
  const percent = (amount: number) => `${(Math.max(0, amount) / scale) * 100}%`
  const delta = after - before
  const shown = emphasis > 0.01 && delta !== 0
  // The part gained so far runs from the before count to the bar's end; the part lost so far, from the bar's end to the before count.
  const gained = shown && delta > 0 ? Math.max(0, value - before) : 0
  const lost = shown && delta < 0 ? Math.max(0, before - value) : 0
  return (
    <>
      <span
        className={`stat-bar${lost > 0 ? ' joined' : ''}`}
        data-projections-category={category}
        style={{width: percent(value), background: color}}
      >
        {gained > 0 && (
          <span
            className={`stat-gain${diff ? ' diff' : ''}`}
            data-change="added"
            style={{left: `${((value - gained) / (value || 1)) * 100}%`, opacity: emphasis}}
          />
        )}
      </span>
      {lost > 0 && (
        <span
          className={`stat-loss${diff ? ' diff' : ''}`}
          data-change="removed"
          style={{left: percent(value), width: percent(lost), opacity: emphasis}}
        />
      )}
    </>
  )
}

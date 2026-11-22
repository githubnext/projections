const short = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}…` : text)

/**
 * A value that changed, in the renderer kit's `ValueChange` vocabulary: the old value struck through in a removed
 * pill, an arrow, then the new value in an added pill; assistive technology reads "was …, now …". A missing side shows
 * only the other pill; an unchanged value (one extraction) is plain.
 */
export function ValueChange({before, after}: {before?: string | undefined; after?: string | undefined}) {
  if (before !== undefined && before === after) {
    return (
      <span className="phv-value" title={after}>
        {short(after)}
      </span>
    )
  }
  return (
    <span className="phv-value-change">
      {before !== undefined && (
        <del className="phv-value-pill" data-change="removed" title={before}>
          <span className="phv-visually-hidden">was </span>
          {short(before)}
        </del>
      )}
      {before !== undefined && after !== undefined && (
        <span aria-hidden="true" className="phv-value-arrow">
          →
        </span>
      )}
      {after !== undefined && (
        <ins className="phv-value-pill" data-change="added" title={after}>
          <span className="phv-visually-hidden">{before !== undefined ? ', now ' : 'now '}</span>
          {short(after)}
        </ins>
      )}
    </span>
  )
}

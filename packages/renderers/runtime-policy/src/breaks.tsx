import {Fragment} from 'react'
import {proseSpans} from '@githubnext/projections-renderer-kit'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Where a long code value may wrap: after a path separator or punctuation (`/`, `.`, `-`, `=`, `,`, `:`) that ends a
 * part, so a leading `/` (`/home`) or a run like `/.` stays with what follows.
 */
const separator = /(?<=[^/.\-=,:][/.\-=,:])(?=.)/u

/**
 * Code, with a break opportunity after each separator, so a path or label selector wraps at its parts
 * (`/var/run/secrets/` then `kubernetes.io/…`) and never inside a word; `overflow-wrap: anywhere` stays the last resort.
 */
export function BreakableCode({children}: {children: string}) {
  const parts = children.split(separator)
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  )
}

/** The kit's `Prose`, its code spans wrapping only at their separators. */
export function Prose({children}: {children: string}) {
  return (
    <>
      {proseSpans(children).map((span, index) =>
        span.code ? (
          <code key={index} className="pk-code" {...identifier}>
            <BreakableCode>{span.text}</BreakableCode>
          </code>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

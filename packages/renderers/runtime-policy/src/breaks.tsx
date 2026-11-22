import {Fragment} from 'react'
import {proseSpans} from '@githubnext/projections-renderer-kit'
import {identifier, keyed} from '@githubnext/projections-renderer-sdk/presentation'

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
      {keyed(parts, part => part).map(([key, part], index) => (
        <Fragment key={key}>
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
      {keyed(proseSpans(children), span => `${span.code ? 'code' : 'text'}:${span.text}`).map(([key, span]) =>
        span.code ? (
          <code key={key} className="pk-code" {...identifier}>
            <BreakableCode>{span.text}</BreakableCode>
          </code>
        ) : (
          <Fragment key={key}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

import {Fragment} from 'react'
import {proseSpans} from '@githubnext/projections-schemas'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Protocol prose (a change or step summary, a notice) with its backtick-delimited
 * inline code drawn in the code font, as the contracts define. Never HTML.
 */
export function Prose({children, codeClassName = 'pj:font-mono pj:text-[0.92em]'}: {children: string; codeClassName?: string}) {
  return (
    <>
      {keyed(proseSpans(children), span => `${span.code ? 'code' : 'text'}:${span.text}`).map(([key, span]) =>
        span.code ? (
          <code key={key} className={`ph-code ${codeClassName}`}>
            {span.text}
          </code>
        ) : (
          <Fragment key={key}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

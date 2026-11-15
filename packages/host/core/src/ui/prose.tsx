import {Fragment} from 'react'
import {proseSpans} from '@githubnext/projections-schemas'

/**
 * Protocol prose (a change or step summary, a notice) with its backtick-delimited
 * inline code drawn in the code font, as the contracts define. Never HTML.
 */
export function Prose({children, codeClassName = 'pj:font-mono pj:text-[0.92em]'}: {children: string; codeClassName?: string}) {
  return (
    <>
      {proseSpans(children).map((span, index) =>
        span.code ? (
          <code key={index} className={`ph-code ${codeClassName}`}>
            {span.text}
          </code>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

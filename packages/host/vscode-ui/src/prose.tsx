import {Fragment} from 'react'
import {proseSpans} from '@githubnext/projections-schemas'

/**
 * Protocol prose (a change or step summary, a notice, a diagnostic) with its backtick-delimited inline code drawn as
 * VS Code draws inline code (`--vscode-textPreformat-*`), as the contracts define. Never HTML.
 */
export function Prose({children}: {children: string}) {
  return (
    <>
      {proseSpans(children).map((span, index) =>
        span.code ? (
          <code key={index} className="phv-code">
            {span.text}
          </code>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

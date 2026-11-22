import {Fragment} from 'react'
import {proseSpans} from '@githubnext/projections-schemas'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Protocol prose (a change or step summary, a notice, a diagnostic) with its backtick-delimited inline code drawn as
 * VS Code draws inline code (`--vscode-textPreformat-*`), as the contracts define. Never HTML.
 */
export function Prose({children}: {children: string}) {
  return (
    <>
      {keyed(proseSpans(children), span => `${span.code ? 'code' : 'text'}:${span.text}`).map(([key, span]) =>
        span.code ? (
          <code key={key} className="phv-code">
            {span.text}
          </code>
        ) : (
          <Fragment key={key}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

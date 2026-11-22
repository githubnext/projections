import {identifierParts} from '../identifiers.js'
import {Identifier} from './components.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'
import {Fragment} from 'react'

/** A human label whose identifiers (`GET /api/cart`, `main.js`, `Client.request`) draw in mono while its prose stays sans. */
export function IdentifierText({text}: {text: string}) {
  return (
    <>
      {keyed(identifierParts(text), part => `${part.code ? 'code' : 'text'}:${part.text}`).map(([key, part]) =>
        part.code ? <Identifier key={key}>{part.text}</Identifier> : <Fragment key={key}>{part.text}</Fragment>,
      )}
    </>
  )
}

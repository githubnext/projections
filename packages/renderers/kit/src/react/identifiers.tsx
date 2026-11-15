import {identifierParts} from '../identifiers.js'
import {Identifier} from './components.js'

/** A human label whose identifiers (`GET /api/cart`, `main.js`, `Client.request`) draw in mono while its prose stays sans. */
export function IdentifierText({text}: {text: string}) {
  return <>{identifierParts(text).map((part, index) => (part.code ? <Identifier key={index}>{part.text}</Identifier> : part.text))}</>
}

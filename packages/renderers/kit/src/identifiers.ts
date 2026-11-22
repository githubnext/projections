/** A run of a label: prose, or a code identifier inside it. */
export interface LabelPart {
  /** The run's text, verbatim, whitespace included; adjacent runs of the same kind are merged. */
  text: string
  /** Whether the run is a code identifier, drawn in the monospace font. */
  code: boolean
}

const requestMethod = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/u
/** File names, dotted members and IDs: `main.js`, `Client.request`, `checkout.latency.p50`. */
const dotted = /^[\w@$-]+(?:\.[\w$-]+)*\.[A-Za-z_$][\w$-]*$/u
const word = /^[A-Za-z$][\w$]*$/u
const call = /^[A-Za-z_$][\w$.]*\(\)$/u
const pathLike = /^[\w@~.:{}[\]*$-]*\/[\w@~.:{}[\]*$/-]*$/u

function isCode(token: string): boolean {
  if (!/[A-Za-z]/u.test(token)) return false
  // snake_case: an underscore after the first character and before the last.
  const snake = word.test(token) && token.slice(1, -1).includes('_')
  if (dotted.test(token) || snake || call.test(token)) return true
  // A path, but not prose such as `and/or`: rooted, nested, or ending in a file name.
  return (
    pathLike.test(token) && (/^[/.~@]/u.test(token) || token.split('/').length > 2 || dotted.test(token.slice(token.lastIndexOf('/') + 1)))
  )
}

const opening = new Set('("\'[')
const closing = new Set(')"\'],;:!?.')

/** A token's opening punctuation, its middle and its closing punctuation, found in one pass from each end. */
function punctuated(token: string): [string, string, string] {
  let start = 0
  while (start < token.length && opening.has(token[start]!)) start++
  let end = token.length
  while (end > start && closing.has(token[end - 1]!)) end--
  return [token.slice(0, start), token.slice(start, end), token.slice(end)]
}

/**
 * Splits a label into prose and the code identifiers inside it, so only the
 * identifiers draw in the monospace font: `GET /api/cart`, `app.js` and the
 * `Inter.woff2` of `Inter.woff2 (preloaded)` are code; `Install dependencies` is prose.
 */
export function identifierParts(text: string): LabelPart[] {
  const parts: LabelPart[] = []
  const push = (value: string, code: boolean) => {
    if (!value) return
    const last = parts.at(-1)
    if (last?.code === code) last.text += value
    else parts.push({text: value, code})
  }
  const tokens = text.split(/(\s+)/u).map(token => {
    const [lead, bare, rest] = punctuated(token)
    // A call keeps its closing parenthesis: `fetchJson()`.
    const closes = bare.endsWith('(') && rest.startsWith(')')
    const core = closes ? `${bare})` : bare,
      trail = closes ? rest.slice(1) : rest
    return {token, lead, core, trail, code: !/^\s*$/u.test(token) && isCode(core)}
  })
  tokens.forEach((item, index) => {
    const next = tokens[index + 2]
    // A request method joins the path it requests: `GET /checkout` is one request line.
    if (requestMethod.test(item.token) && next?.code && !next.lead && next.core.startsWith('/')) {
      push(item.token + tokens[index + 1]!.token, true)
      tokens[index + 1]!.token = ''
      return
    }
    if (!item.code) return push(item.token, false)
    push(item.lead, false)
    push(item.core, true)
    push(item.trail, false)
  })
  return parts
}

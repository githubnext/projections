// Where each value of a JSON text is, for evidence: the schema files are pretty-printed, so a field's line finds it.

/** The line of every JSON Pointer in a JSON text: an object member's is its key's line. */
export function pointerLines(text) {
  const lines = new Map()
  let at = 0
  let line = 1
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) {
      if (text[at] === '\n') line++
      at++
    }
  }
  const string = () => {
    let end = at + 1
    while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1
    const value = JSON.parse(text.slice(at, end + 1))
    at = end + 1
    return value
  }
  const value = pointer => {
    space()
    if (text[at] === '{') {
      at++
      for (space(); text[at] !== '}'; space()) {
        if (text[at] === ',') {
          at++
          continue
        }
        const memberLine = line
        const key = string()
        const child = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
        lines.set(child, memberLine)
        space()
        at++ // :
        value(child)
      }
      at++
    } else if (text[at] === '[') {
      at++
      let index = 0
      for (space(); text[at] !== ']'; space()) {
        if (text[at] === ',') {
          at++
          continue
        }
        lines.set(`${pointer}/${index}`, line)
        value(`${pointer}/${index++}`)
      }
      at++
    } else if (text[at] === '"') string()
    else while (at < text.length && !/[\s,\]}]/.test(text[at])) at++
  }
  value('')
  return lines
}

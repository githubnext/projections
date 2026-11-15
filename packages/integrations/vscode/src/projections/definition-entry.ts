/**
 * Where a definition file's top-level `key` is: from its opening quote to the end of its value (offsets), or, when the
 * file has no such key, where one would go (after the last top-level value, `insert`). Strings and nesting are
 * skipped, so a nested key of the same name is never chosen. Undefined when the text isn't an object.
 */
export function definitionEntry(text: string, key: string): {start: number; end: number} | {insert: number; comma: boolean} | undefined {
  let index = text.indexOf('{')
  if (index < 0) return undefined
  let depth = 0
  let lastValueEnd = -1
  let found: {start: number; valueStart?: number} | undefined
  const stringEnd = (from: number) => {
    let at = from + 1
    while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1
    return at + 1
  }
  for (; index < text.length; index++) {
    const char = text[index]!
    if (char === '"') {
      const end = stringEnd(index)
      // A top-level key: a string at depth 1 followed by a colon.
      if (depth === 1 && /^\s*:/.test(text.slice(end, end + 32)) && !found) {
        if (JSON.parse(text.slice(index, end)) === key) found = {start: index}
      } else if (depth === 1) lastValueEnd = end
      index = end - 1
      continue
    }
    if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') {
      depth--
      if (depth === 1) lastValueEnd = index + 1
      if (depth === 0) break
    } else if (depth === 1 && /[\w.+-]/.test(char)) {
      // A number, `true`, `false` or `null` value.
      while (index + 1 < text.length && /[\w.+-]/.test(text[index + 1]!)) index++
      lastValueEnd = index + 1
    }
    if (found && found.valueStart === undefined && char === ':' && depth === 1) found.valueStart = index
    if (found?.valueStart !== undefined && depth === 1 && lastValueEnd > found.valueStart) return {start: found.start, end: lastValueEnd}
  }
  if (found) return undefined
  return lastValueEnd < 0 ? undefined : {insert: lastValueEnd, comma: true}
}

/** Parameter names of a constructor or function, from its source, by position. */
export function parameterNames(fn: unknown, constructor: boolean): string[] {
  let text: string
  try {
    text = Function.prototype.toString.call(fn)
  } catch {
    return []
  }
  let start: number
  if (constructor) {
    const match = /\bconstructor\s*\(/u.exec(text)
    if (!match) return []
    start = match.index + match[0].length
  } else {
    const open = text.indexOf('(')
    const arrow = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/u.exec(text)
    if (arrow && (open < 0 || arrow.index + arrow[0].length < open)) return [arrow[1]!]
    if (open < 0) return []
    start = open + 1
  }
  const names: string[] = []
  let depth = 0,
    current = ''
  for (let index = start; index < text.length; index++) {
    const character = text[index]!
    if ('([{'.includes(character)) depth++
    if (')]}'.includes(character)) {
      if (depth === 0) {
        names.push(current)
        break
      }
      depth--
    }
    if (character === ',' && depth === 0) {
      names.push(current)
      current = ''
      continue
    }
    current += character
  }
  return names.map(name => /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/u.exec(name)?.[1] ?? '')
}

// The worker request must not erase duplicate keys before validation.
export function parseJson(source: string): unknown {
  let cursor = 0
  const whitespace = (): void => {
    while (/[ \r\n\t]/u.test(source[cursor] ?? '\0')) cursor++
  }
  const string = (): string => {
    const start = cursor++
    while (cursor < source.length) {
      const character = source[cursor++]
      if (character === '\\') cursor++
      else if (character === '"') {
        const value: unknown = JSON.parse(source.slice(start, cursor))
        if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid Unicode string')
        return value
      }
    }
    throw new Error('Unterminated JSON string')
  }
  const value = (depth: number): void => {
    if (depth > 64) throw new Error('JSON nesting exceeds 64 levels')
    whitespace()
    const character = source[cursor]
    if (character === '"') {
      string()
      return
    }
    if (character === '{' || character === '[') {
      const isObject = character === '{'
      const end = isObject ? '}' : ']'
      const names = new Set<string>()
      cursor++
      whitespace()
      if (source[cursor] === end) {
        cursor++
        return
      }
      while (cursor < source.length) {
        if (isObject) {
          if (source[cursor] !== '"') throw new Error('Expected JSON object key')
          const name = string()
          if (names.has(name)) throw new Error(`Duplicate JSON object key: ${name}`)
          names.add(name)
          whitespace()
          if (source[cursor++] !== ':') throw new Error('Expected JSON colon')
        }
        value(depth + 1)
        whitespace()
        if (source[cursor] === end) {
          cursor++
          return
        }
        if (source[cursor++] !== ',') throw new Error('Expected JSON comma')
        whitespace()
      }
      throw new Error('Unterminated JSON container')
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(source.slice(cursor))?.[0]
    if (!token) throw new Error('Invalid JSON value')
    if (token !== 'true' && token !== 'false' && token !== 'null') {
      const number = Number(token)
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) {
        throw new RangeError('JSON number is nonfinite or outside the safe integer range')
      }
    }
    cursor += token.length
  }
  value(0)
  whitespace()
  if (cursor !== source.length) throw new Error('Trailing JSON content')
  return JSON.parse(source) as unknown
}

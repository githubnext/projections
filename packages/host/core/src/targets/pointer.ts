/** Reads an RFC 6901 pointer from a value; `undefined` when it doesn't resolve. */
export function readPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value
  let current = value
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(token)) return undefined
      current = current[Number(token)]
    } else if (typeof current === 'object' && current !== null && Object.hasOwn(current, token)) {
      current = (current as Record<string, unknown>)[token]
    } else {
      return undefined
    }
    if (current === undefined) return undefined
  }
  return current
}

/** Builds an RFC 6901 pointer from property names and array indexes. */
export function propertyPath(...segments: (string | number)[]): string {
  return segments.map(segment => `/${String(segment).replace(/~/gu, '~0').replace(/\//gu, '~1')}`).join('')
}

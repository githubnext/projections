/**
 * A refused request's message, for people: the runner's diagnostics as sentences with where they are
 * (`message (path:line:column)`), never the raw JSON body.
 */
export function requestErrorMessage(status: number, body: unknown): string {
  let value = body
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body)
    } catch {
      value = body
    }
  }
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  const diagnostics = Array.isArray(record?.diagnostics) ? (record.diagnostics as unknown[]) : []
  const lines = diagnostics.flatMap(item => {
    const diagnostic = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    if (typeof diagnostic.message !== 'string' || !diagnostic.message) return []
    const location =
      typeof diagnostic.location === 'object' && diagnostic.location !== null ? (diagnostic.location as Record<string, unknown>) : {}
    const path = typeof location.path === 'string' ? location.path : typeof diagnostic.path === 'string' ? diagnostic.path : ''
    const where = path
      ? typeof location.line === 'number'
        ? `${path}:${location.line}${typeof location.column === 'number' ? `:${location.column}` : ''}`
        : path
      : ''
    return [where ? `${diagnostic.message} (${where})` : diagnostic.message]
  })
  if (lines.length) return lines.join('\n')
  for (const key of ['message', 'error'] as const) if (typeof record?.[key] === 'string' && record[key]) return String(record[key])
  // Text that isn't JSON (a proxy's page, a plain message): at most a line of it.
  if (typeof value === 'string' && value.trim() && !/^[[{]/u.test(value.trim())) {
    return `The Projections runner refused the request (${status}): ${value.trim().split('\n')[0]!.slice(0, 300)}`
  }
  return `The Projections runner refused the request (${status})`
}

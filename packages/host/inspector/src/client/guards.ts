export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function keys(value: Record<string, unknown>): string {
  return Object.keys(value).sort().join(',')
}
export function optionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}
/** A renderer development server: an `http:` loopback origin (localhost or 127.0.0.1), as the runner reports one. */
export function isDevServerUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 200) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/' && !url.search && !url.hash
  } catch {
    return false
  }
}

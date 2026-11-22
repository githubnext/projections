export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
    throw new Error(`${label} must be a nonempty Unicode string without NUL`)
  }
  return value
}

export function identifier(value: unknown, label: string): string {
  const id = text(value, label)
  if (!/^[a-zA-Z0-9][\w.-]{0,99}$/u.test(id)) throw new Error(`${label} must be 1-100 filename-safe ASCII characters`)
  return id
}

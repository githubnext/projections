// React keys for lists whose items have no id of their own.

/**
 * Each item with a React key: its occurrence among the items with the same `keyOf`, then that (`1:a`, `1:b`, `2:a`).
 * For lists whose items have no id of their own (text runs, lines, diagnostics): a key stays with its item when others
 * are added or removed before it, as an index wouldn't, and no two items share one, whatever their text.
 */
export function keyed<T>(items: readonly T[], keyOf: (item: T) => string): [key: string, item: T][] {
  const seen = new Map<string, number>()
  return items.map(item => {
    const key = keyOf(item)
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return [`${count}:${key}`, item]
  })
}

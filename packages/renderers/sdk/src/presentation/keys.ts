// React keys for lists whose items have no id of their own.

/**
 * Each item with a React key: `keyOf(item)`, and for an item that isn't the first with that key, its occurrence
 * (`a`, `b`, `a#2`). For lists whose items have no id of their own (text runs, lines, diagnostics): a key stays with
 * its item when others are added or removed before it, as an index wouldn't.
 */
export function keyed<T>(items: readonly T[], keyOf: (item: T) => string): [key: string, item: T][] {
  const seen = new Map<string, number>()
  return items.map(item => {
    const key = keyOf(item)
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return [count === 1 ? key : `${key}#${count}`, item]
  })
}

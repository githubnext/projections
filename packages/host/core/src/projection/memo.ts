// One-slot memoization without a framework: a derived value keeps its identity while its inputs do, as React's memos
// keep it, so the store's snapshot changes only where something changed.

/** `compute`, recomputed only when an argument differs (by `Object.is`) from the last call's. */
export function memo<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: {args: A; result: R} | undefined
  return (...args) => {
    if (last && last.args.length === args.length && last.args.every((arg, index) => Object.is(arg, args[index]))) return last.result
    const result = compute(...args)
    last = {args, result}
    return result
  }
}

/** A value parsed from its JSON key, kept while the key is the same: for inputs compared by value. */
export function byValue<T>(): (value: T) => T {
  let last: {key: string; value: T} | undefined
  return value => {
    const key = JSON.stringify(value ?? null)
    if (last?.key === key) return last.value
    last = {key, value}
    return value
  }
}

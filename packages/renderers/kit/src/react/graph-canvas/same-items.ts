// Comparing the inputs a render keeps, item by item.

/** Whether two lists hold the same items, in order. */
export function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
}

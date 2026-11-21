/**
 * A definition's or scenario's comparator names a custom comparator when it is a string (the comparator
 * file's path) or an object with `file`; an object without `file` is the default comparator.
 */
export function customComparator(comparator: unknown): {file: string; options?: unknown; sources?: string[]} | undefined {
  if (typeof comparator === 'string') return {file: comparator}
  if (typeof comparator === 'object' && comparator !== null && 'file' in comparator && typeof comparator.file === 'string') {
    return comparator as {file: string; options?: unknown; sources?: string[]}
  }
  return undefined
}

/** Whether a path names a comparator file: `<name>.comparator.yaml` or `<name>.comparator.yml`. */
export function isComparatorFile(path: string): boolean {
  return path.endsWith('.comparator.yaml') || path.endsWith('.comparator.yml')
}

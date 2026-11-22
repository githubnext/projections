// Counts and kinds in words.

/** `count` and its noun, in the locale's digits: `1 package`, `3 packages`. */
export function countText(count: number, singular: string, plural = `${singular}s`, locale?: string): string {
  return `${count.toLocaleString(locale)} ${count === 1 ? singular : plural}`
}

/** A kind's plural, as English forms it: `services`, `classes`, `dependencies`. Kinds are shown verbatim otherwise. */
export function pluralKind(kind: string): string {
  if (/[^aeiou]y$/u.test(kind)) return `${kind.slice(0, -1)}ies`
  if (/(?:[sxz]|ch|sh)$/u.test(kind)) return `${kind}es`
  return `${kind}s`
}
